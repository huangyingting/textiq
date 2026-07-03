#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import process from "node:process";
import { toPosix } from "./source-scan-utils.mjs";

function walkMarkdown(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdown(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

export function extractMarkdownLinks(markdown) {
  const links = [];
  for (const match of markdown.matchAll(
    /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
  )) {
    links.push(match[1]);
  }
  return links;
}

function isExternalLink(link) {
  return /^(?:https?:|mailto:|tel:)/i.test(link);
}

function stripAnchor(link) {
  const index = link.indexOf("#");
  return index === -1
    ? { pathPart: link, anchor: "" }
    : { pathPart: link.slice(0, index), anchor: link.slice(index + 1) };
}

function resolveLinkTarget(fromFile, link) {
  const { pathPart } = stripAnchor(decodeURI(link));
  const base =
    pathPart === "" ? fromFile : resolve(dirname(fromFile), pathPart);
  if (existsSync(base) && statSync(base).isDirectory()) {
    return join(base, "README.md");
  }
  if (extname(base) === "") {
    const asMarkdown = `${base}.md`;
    if (existsSync(asMarkdown)) {
      return asMarkdown;
    }
  }
  return base;
}

function slugifyHeading(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`]/g, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

function markdownAnchors(markdown) {
  const anchors = new Set();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    anchors.add(slugifyHeading(match[1]));
  }
  return anchors;
}

export function validateMarkdownLinks(repoRoot = process.cwd()) {
  const docsRoot = join(repoRoot, "docs");
  const resolvedDocsRoot = resolve(docsRoot);
  const findings = [];
  for (const file of walkMarkdown(docsRoot)) {
    const markdown = readFileSync(file, "utf8");
    for (const link of extractMarkdownLinks(markdown)) {
      if (isExternalLink(link)) {
        continue;
      }
      const { anchor } = stripAnchor(link);
      const target = resolveLinkTarget(file, link);
      const resolvedTarget = resolve(target);
      if (!resolvedTarget.startsWith(resolvedDocsRoot)) {
        continue;
      }
      const targetPath = stripAnchor(decodeURI(link)).pathPart;
      if (
        targetPath !== "" &&
        !targetPath.endsWith("/") &&
        extname(targetPath) !== "" &&
        extname(targetPath) !== ".md"
      ) {
        continue;
      }
      if (!existsSync(target)) {
        findings.push({
          filePath: toPosix(relative(repoRoot, file)),
          link,
          reason: "target file does not exist",
        });
        continue;
      }
      if (anchor) {
        const anchors = markdownAnchors(readFileSync(target, "utf8"));
        if (!anchors.has(anchor)) {
          findings.push({
            filePath: toPosix(relative(repoRoot, file)),
            link,
            reason: `target anchor #${anchor} does not exist`,
          });
        }
      }
    }
  }
  return findings;
}

function linkedMarkdownFiles(repoRoot) {
  const docsRoot = join(repoRoot, "docs");
  const start = join(docsRoot, "README.md");
  const seen = new Set();
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.shift();
    const normalized = resolve(file);
    if (seen.has(normalized) || !normalized.startsWith(resolve(docsRoot))) {
      continue;
    }
    seen.add(normalized);
    const markdown = readFileSync(normalized, "utf8");
    for (const link of extractMarkdownLinks(markdown)) {
      if (isExternalLink(link)) {
        continue;
      }
      const target = resolveLinkTarget(normalized, link);
      if (existsSync(target) && target.endsWith(".md")) {
        queue.push(target);
      }
    }
  }
  return seen;
}

export function validateDocsIndex(repoRoot = process.cwd()) {
  const docsRoot = join(repoRoot, "docs");
  const findings = [];
  const docs = walkMarkdown(docsRoot).map((file) => resolve(file));
  const reachable = linkedMarkdownFiles(repoRoot);

  for (const file of docs) {
    if (!reachable.has(file)) {
      findings.push({
        filePath: toPosix(relative(repoRoot, file)),
        reason: "not reachable from docs/README.md local links",
      });
    }
  }

  const directories = new Set(docs.map((file) => dirname(file)));
  for (const directory of directories) {
    const readme = join(directory, "README.md");
    if (!existsSync(readme)) {
      findings.push({
        filePath: toPosix(relative(repoRoot, directory)),
        reason: "directory contains markdown files but has no README.md index",
      });
    }
  }

  return findings;
}

function main() {
  const linkFindings = validateMarkdownLinks();
  const indexFindings = validateDocsIndex();
  if (linkFindings.length === 0 && indexFindings.length === 0) {
    console.log("Docs link and index checks passed.");
    return;
  }

  if (linkFindings.length > 0) {
    console.error("Markdown link check failed:");
    for (const finding of linkFindings) {
      console.error(
        `  - ${finding.filePath}: ${finding.link} — ${finding.reason}`,
      );
    }
  }

  if (indexFindings.length > 0) {
    console.error("Docs index check failed:");
    for (const finding of indexFindings) {
      console.error(`  - ${finding.filePath} — ${finding.reason}`);
    }
  }

  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
