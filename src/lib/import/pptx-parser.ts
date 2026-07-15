/**
 * PPTX → plain text extractor.
 *
 * PPTX files are ZIP archives containing XML slide files. We unzip the archive
 * with `jszip`, parse each `ppt/slides/slide*.xml` file, and extract:
 * - shape text (`<p:sp>`)
 * - native table cell text (`<a:tbl>`)
 * - linked speaker notes (`ppt/notesSlides/*.xml` via slide relationships)
 *
 * Slide titles (inside `<p:sp>` elements whose `<p:ph>` attribute carries
 * `type="title"` or `type="ctrTitle"`) are promoted to headings so the result
 * has some structure.
 *
 * Pure PPTX XML/ZIP parsing helpers. Server-only enforcement lives in `pptx.ts`.
 */
import { posix as pathPosix } from "node:path";
import type JSZip from "jszip";

import { disposeZip, loadZipWithinBudget } from "./archive-budget";
import { EncryptedImportError } from "./import-errors";
import { throwIfAborted } from "./timeout";

/** Regex to match all `<a:t>…</a:t>` text runs. */
const TEXT_RE = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;

/** Regex to detect a placeholder shape that is a title. */
const TITLE_PH_RE = /<p:ph\s[^>]*type="(title|ctrTitle)"[^>]*\/?>/i;

/** Regex to split the XML into individual shapes (`<p:sp>…</p:sp>`). */
const SHAPE_RE = /<p:sp[\s\S]*?<\/p:sp>/g;

/** Regex to match native DrawingML tables. */
const TABLE_RE = /<a:tbl[\s\S]*?<\/a:tbl>/g;
const TABLE_ROW_RE = /<a:tr[\s\S]*?<\/a:tr>/g;
const TABLE_CELL_RE = /<a:tc[\s\S]*?<\/a:tc>/g;

/** Regex to match individual relationships in a .rels part. */
const RELATIONSHIP_RE = /<Relationship\b[\s\S]*?\/>/g;

/** Decodes basic XML character entities. */
function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(parseInt(decimal, 10)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Extracts all text runs from an XML snippet into a single line. */
function extractText(xml: string): string {
  const parts: string[] = [];
  let m;
  TEXT_RE.lastIndex = 0;
  while ((m = TEXT_RE.exec(xml)) !== null) {
    const t = decodeXml(m[1]).trim();
    if (t) parts.push(t);
  }
  return parts.join(" ");
}

function extractSlideShapeLines(slideXml: string): string[] {
  const lines: string[] = [];
  let shapeMatch;
  SHAPE_RE.lastIndex = 0;
  while ((shapeMatch = SHAPE_RE.exec(slideXml)) !== null) {
    const shapeXml = shapeMatch[0];
    const text = extractText(shapeXml);
    if (!text) continue;
    if (TITLE_PH_RE.test(shapeXml)) {
      lines.push(`## ${text}`);
    } else {
      lines.push(text);
    }
  }
  return lines;
}

function escapeMarkdownTableCell(cell: string): string {
  return cell.replace(/\|/g, "\\|");
}

function toMarkdownTableRow(cells: string[], width: number): string {
  const padded = [...cells];
  while (padded.length < width) padded.push("");
  return `| ${padded.map(escapeMarkdownTableCell).join(" | ")} |`;
}

function extractTableRows(tableXml: string): string[][] {
  const rows: string[][] = [];
  let rowMatch;
  TABLE_ROW_RE.lastIndex = 0;
  while ((rowMatch = TABLE_ROW_RE.exec(tableXml)) !== null) {
    const rowXml = rowMatch[0];
    const cells: string[] = [];
    let cellMatch;
    TABLE_CELL_RE.lastIndex = 0;
    while ((cellMatch = TABLE_CELL_RE.exec(rowXml)) !== null) {
      cells.push(extractText(cellMatch[0]));
    }
    if (cells.some((cell) => cell.length > 0)) {
      rows.push(cells);
    }
  }
  return rows;
}

function toMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (width === 0) return "";

  const header = toMarkdownTableRow(rows[0] ?? [], width);
  const separator = `| ${Array.from({ length: width }, () => "---").join(" | ")} |`;
  const body = rows.slice(1).map((row) => toMarkdownTableRow(row, width));
  return [header, separator, ...body].join("\n");
}

function extractSlideTableBlocks(slideXml: string): string[] {
  const tables: string[] = [];
  let tableMatch;
  TABLE_RE.lastIndex = 0;
  while ((tableMatch = TABLE_RE.exec(slideXml)) !== null) {
    const table = toMarkdownTable(extractTableRows(tableMatch[0]));
    if (table) tables.push(table);
  }
  return tables;
}

function relationshipAttr(relTag: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`, "i").exec(relTag);
  return match ? decodeXml(match[1]) : null;
}

function resolveSlideRelationshipTarget(
  slideName: string,
  target: string,
): string {
  const normalizedTarget = target.replace(/\\/g, "/");
  if (normalizedTarget.startsWith("/")) {
    return normalizedTarget.slice(1);
  }
  return pathPosix.normalize(
    pathPosix.join(pathPosix.dirname(slideName), normalizedTarget),
  );
}

async function findSlideNotesEntry(
  zip: JSZip,
  slideName: string,
): Promise<string | null> {
  const relsName = `${pathPosix.dirname(slideName)}/_rels/${pathPosix.basename(slideName)}.rels`;
  const relsEntry = zip.files[relsName];
  if (!relsEntry) return null;

  const relsXml = await relsEntry.async("string");
  let relMatch;
  RELATIONSHIP_RE.lastIndex = 0;
  while ((relMatch = RELATIONSHIP_RE.exec(relsXml)) !== null) {
    const relTag = relMatch[0];
    const type = relationshipAttr(relTag, "Type");
    if (!type || !/\/notesSlide$/i.test(type)) continue;

    const targetMode = relationshipAttr(relTag, "TargetMode");
    if (targetMode?.toLowerCase() === "external") continue;

    const target = relationshipAttr(relTag, "Target");
    if (!target) continue;

    const notesEntryName = resolveSlideRelationshipTarget(slideName, target);
    if (zip.files[notesEntryName]) {
      return notesEntryName;
    }
  }

  return null;
}

function extractNotesText(notesXml: string): string {
  const lines: string[] = [];
  let shapeMatch;
  SHAPE_RE.lastIndex = 0;
  while ((shapeMatch = SHAPE_RE.exec(notesXml)) !== null) {
    const text = extractText(shapeMatch[0]);
    if (text) lines.push(text);
  }
  if (lines.length > 0) {
    return lines.join("\n");
  }
  return extractText(notesXml);
}

function slideOrdinal(name: string): number {
  const match = /slide(\d+)\.xml$/i.exec(name);
  return match ? parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
}

/**
 * Extracts slide text from a PPTX `Buffer` and returns a structured plain-text
 * outline (each slide separated by a blank line, titles as `## Heading`).
 */
export async function parsePptx(
  buffer: Buffer,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const zip = await loadZipWithinBudget(buffer, signal);

  try {
    if (zip.files["EncryptionInfo"] && zip.files["EncryptedPackage"]) {
      throw new EncryptedImportError();
    }
    // Collect slide XML files in sorted order so slides appear in sequence.
    const slideEntries = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => slideOrdinal(a) - slideOrdinal(b));

    const slideBlocks: string[] = [];

    for (const slideName of slideEntries) {
      throwIfAborted(signal);
      const slideEntry = zip.files[slideName];
      if (!slideEntry) continue;
      const slideXml = await slideEntry.async("string");
      throwIfAborted(signal);
      const sections: string[] = [];

      const shapeLines = extractSlideShapeLines(slideXml);
      if (shapeLines.length > 0) {
        sections.push(shapeLines.join("\n"));
      }

      const tableBlocks = extractSlideTableBlocks(slideXml);
      if (tableBlocks.length > 0) {
        sections.push(tableBlocks.join("\n\n"));
      }

      const notesEntryName = await findSlideNotesEntry(zip, slideName);
      throwIfAborted(signal);
      if (notesEntryName) {
        const notesEntry = zip.files[notesEntryName];
        if (notesEntry) {
          const notesText = extractNotesText(await notesEntry.async("string"));
          throwIfAborted(signal);
          if (notesText) {
            sections.push(`### Speaker notes\n${notesText}`);
          }
        }
      }

      if (sections.length > 0) {
        slideBlocks.push(sections.join("\n\n"));
      }
    }

    return slideBlocks.join("\n\n");
  } finally {
    disposeZip(zip);
  }
}
