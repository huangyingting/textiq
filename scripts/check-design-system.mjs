#!/usr/bin/env node

import process from "node:process";
import {
  makeShouldScanFile,
  scanRepositoryRoots,
  toPosix,
} from "./source-scan-utils.mjs";

const SCAN_ROOTS = ["src/app", "src/components"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);
const RAW_Z_CLASS = /\bz-(?:\[(?:\d+)\]|\d+)\b/g;
const RAW_HEX_ARBITRARY_CLASS =
  /\b(?:bg|text|border|ring|shadow|fill|stroke|from|via|to)-\[#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\]/g;
const RAW_RADIUS_ARBITRARY_CLASS =
  /\brounded(?:-[trbl]{1,2})?-\[(?!var\()[^\]]+\]/g;
const RAW_SHADOW_ARBITRARY_CLASS = /\bshadow-\[(?!var\()[^\]]+\]/g;
const NON_DS_NEUTRAL_CLASS =
  /\b(?:bg|text|border|ring)-(?:slate|gray|zinc|neutral|stone)-\d{2,3}(?:\/\d{1,3})?\b/g;

const shouldScanFile = makeShouldScanFile({
  sourceExtensions: SOURCE_EXTENSIONS,
});

function shouldScanRawHex(filePath) {
  const normalized = toPosix(filePath);
  if (normalized === "src/app/globals.css") {
    return false;
  }
  if (normalized.startsWith("src/components/ui/")) {
    return false;
  }
  return true;
}

function shouldScanRawChrome(filePath) {
  const normalized = toPosix(filePath);
  if (normalized === "src/app/globals.css") {
    return false;
  }
  if (normalized.startsWith("src/components/ui/")) {
    return false;
  }
  return true;
}

function finding(filePath, lineNumber, columnNumber, rule, match) {
  return { filePath, lineNumber, columnNumber, rule, match };
}

export function scanText(filePath, text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  const scanHex = shouldScanRawHex(filePath);
  const scanChrome = shouldScanRawChrome(filePath);

  lines.forEach((line, lineIndex) => {
    for (const match of line.matchAll(RAW_Z_CLASS)) {
      findings.push(
        finding(
          filePath,
          lineIndex + 1,
          (match.index ?? 0) + 1,
          "raw-z-index",
          match[0],
        ),
      );
    }

    if (!scanHex) {
      if (!scanChrome) {
        return;
      }
    }

    if (scanChrome) {
      for (const match of line.matchAll(RAW_RADIUS_ARBITRARY_CLASS)) {
        findings.push(
          finding(
            filePath,
            lineIndex + 1,
            (match.index ?? 0) + 1,
            "raw-radius-class",
            match[0],
          ),
        );
      }

      for (const match of line.matchAll(RAW_SHADOW_ARBITRARY_CLASS)) {
        findings.push(
          finding(
            filePath,
            lineIndex + 1,
            (match.index ?? 0) + 1,
            "raw-shadow-class",
            match[0],
          ),
        );
      }

      for (const match of line.matchAll(NON_DS_NEUTRAL_CLASS)) {
        findings.push(
          finding(
            filePath,
            lineIndex + 1,
            (match.index ?? 0) + 1,
            "non-ds-neutral-class",
            match[0],
          ),
        );
      }
    }

    if (scanHex) {
      for (const match of line.matchAll(RAW_HEX_ARBITRARY_CLASS)) {
        findings.push(
          finding(
            filePath,
            lineIndex + 1,
            (match.index ?? 0) + 1,
            "raw-hex-class",
            match[0],
          ),
        );
      }
    }
  });

  return findings;
}

export function scanDesignSystem(repoRoot = process.cwd()) {
  return scanRepositoryRoots({
    repoRoot,
    roots: SCAN_ROOTS,
    sourceExtensions: SOURCE_EXTENSIONS,
    scanText,
    shouldScanFile,
  });
}

function main() {
  const findings = scanDesignSystem();
  if (findings.length === 0) {
    console.log("Design-system guardrails passed.");
    return;
  }

  console.error("Design-system guardrails failed:");
  for (const item of findings) {
    const guidance =
      item.rule === "raw-z-index"
        ? "Use a named semantic z utility from globals.css (for example z-raised, z-canvas, z-panel, z-modal, z-menu, z-toast)."
        : item.rule === "raw-hex-class"
          ? "Move raw hex colors into the DS token/theme layer; feature class names must use semantic utilities."
          : "Use DS radius, elevation, and neutral utilities instead of raw chrome classes.";
    console.error(
      `${item.filePath}:${item.lineNumber}:${item.columnNumber} ${item.rule} ${item.match} — ${guidance}`,
    );
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
