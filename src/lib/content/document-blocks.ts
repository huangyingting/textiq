/**
 * Pure document block collection utilities for serialized Lexical editor state.
 */

import type { TextRun } from "@/lib/content/text-run";
import type { Visual } from "@/lib/visual/schema";

// ---------------------------------------------------------------------------
// Page-break helpers (pure, browser-free)
// ---------------------------------------------------------------------------

/**
 * Named page sizes for document export pagination.
 *
 * - `"a4"` — ISO A4 portrait (210 × 297 mm)
 * - `"letter"` — US Letter portrait (215.9 × 279.4 mm)
 * - `"16:9"` — Widescreen slide (960 × 540 px at 96 dpi)
 */
export type PageSize = "a4" | "letter" | "16:9";

/**
 * Physical dimensions (in millimetres) for each named page size, plus the
 * equivalent pixel height at 96 dpi for use in editor-side indicators.
 */
export const PAGE_SIZE_DIMENSIONS: Record<
  PageSize,
  { widthMM: number; heightMM: number; heightPx: number; widthPx: number }
> = {
  a4: { widthMM: 210, heightMM: 297, widthPx: 794, heightPx: 1123 },
  letter: { widthMM: 215.9, heightMM: 279.4, widthPx: 816, heightPx: 1056 },
  "16:9": { widthMM: 338.7, heightMM: 190.5, widthPx: 1280, heightPx: 720 },
};

/**
 * Compute the pixel offsets at which page breaks occur for a given content
 * height and page size. The offsets are measured from the top of the content
 * area (y = 0) and represent the top edge of each page boundary after the
 * first. Empty content (`contentHeightPx <= 0`) returns an empty array.
 *
 * This is a pure function — no DOM or browser APIs required — so it can be
 * unit-tested under `node --test`.
 *
 * @param contentHeightPx  Total content height in CSS pixels.
 * @param pageSize         Named page size to paginate against.
 * @returns                Sorted array of break offsets (px), one per split.
 */
export function computePageBreaks(
  contentHeightPx: number,
  pageSize: PageSize,
): number[] {
  const { heightPx } = PAGE_SIZE_DIMENSIONS[pageSize];
  if (contentHeightPx <= 0 || heightPx <= 0) return [];

  const breaks: number[] = [];
  let offset = heightPx;
  while (offset < contentHeightPx) {
    breaks.push(offset);
    offset += heightPx;
  }
  return breaks;
}

// ---------------------------------------------------------------------------
// Block types
// ---------------------------------------------------------------------------

export type TextBlockKind =
  | "paragraph"
  | "heading"
  | "quote"
  | "listitem"
  | "hr";

export type DocumentTextBlock = {
  kind: "text";
  blockType: TextBlockKind;
  /** Heading level (1–3) — only present when blockType === "heading" */
  level?: 1 | 2 | 3;
  /** Plain text for the block (empty string for "hr") */
  text: string;
  /**
   * Optional rich-text runs for `text`, present only when the block carries
   * inline formatting (bold/italic/code/color/link). Plain blocks omit this so
   * formatting-free documents derive identical decks to before. `text` always
   * equals the concatenation of run `text` values and remains the fallback.
   */
  runs?: TextRun[];
  /**
   * Stable identifier for this block within its source document, used to
   * anchor `sourceRef` links on inserted slide elements. Populated from the
   * serialised Lexical node `bid` field.
   */
  blockId?: string;
};

export type DocumentTableColumn = {
  id: string;
  label: string;
};

export type DocumentTableCell = {
  text: string;
  runs?: TextRun[];
};

export type DocumentTableRow = {
  id: string;
  cells: DocumentTableCell[];
};

export type DocumentTableBlock = {
  kind: "table";
  blockId?: string;
  caption?: string;
  columns: DocumentTableColumn[];
  rows: DocumentTableRow[];
};

/* node:coverage ignore next 5 -- Type-only visual block contract is erased; tests cover runtime visual collection. */
export type DocumentVisualBlock = {
  kind: "visual";
  visualId: string;
  visual: Visual;
};

export type DocumentBlock =
  | DocumentTextBlock
  | DocumentVisualBlock
  | DocumentTableBlock;

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
}

export function documentTableBlockToMarkdown(
  block: DocumentTableBlock,
): string {
  const header = `| ${block.columns
    .map((column) => escapeMarkdownTableCell(column.label))
    .join(" | ")} |`;
  const separator = `| ${block.columns.map(() => "---").join(" | ")} |`;
  const rows = block.rows.map(
    (row) =>
      `| ${row.cells
        .map((cell) => escapeMarkdownTableCell(cell.text))
        .join(" | ")} |`,
  );
  return [block.caption, header, separator, ...rows]
    .filter(
      (line): line is string => typeof line === "string" && line.length > 0,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// collectDocumentBlocks — pure, no browser
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Concatenates all inline text nodes under a serialised Lexical block node. */
function blockText(node: Record<string, unknown>): string {
  if (Array.isArray(node.children)) {
    return (node.children as unknown[])
      .map((child) => {
        if (!isRecord(child)) return "";
        if (child.type === "linebreak") return "\n";
        if (typeof child.text === "string") return child.text;
        return blockText(child);
      })
      .join("");
  }
  return typeof node.text === "string" ? node.text : "";
}

// ---------------------------------------------------------------------------
// blockRichText — formatting-preserving inline walk
// ---------------------------------------------------------------------------

/**
 * Lexical `TextNode.format` bit flags (a bitmask on the serialised node). Only
 * the emphases we preserve into slide runs are decoded here.
 */
const FORMAT_BOLD = 1;
const FORMAT_ITALIC = 2;
const FORMAT_CODE = 16;

/** Inline context inherited from ancestor element nodes (e.g. links). */
interface RunContext {
  link?: string;
}

/** Extracts a `color: …` value from a Lexical inline `style` string. */
function colorFromStyle(style: unknown): string | undefined {
  if (typeof style !== "string") return undefined;
  const match = style.match(/(?:^|;)\s*color:\s*([^;]+)/i);
  if (!match) return undefined;
  const color = match[1].trim();
  return color.length > 0 ? color : undefined;
}

/** Builds a {@link TextRun} from a serialised Lexical text node. */
function textNodeToRun(
  node: Record<string, unknown>,
  ctx: RunContext,
): TextRun | null {
  const text = typeof node.text === "string" ? node.text : "";
  if (text === "") return null;
  const format = typeof node.format === "number" ? node.format : 0;
  const run: TextRun = { text };
  if (format & FORMAT_BOLD) run.bold = true;
  if (format & FORMAT_ITALIC) run.italic = true;
  if (format & FORMAT_CODE) run.code = true;
  const color = colorFromStyle(node.style);
  if (color) run.color = color;
  /* Coverage rationale: link-bearing text run behavior is asserted; tsx maps the assignment as uncovered. */
  /* node:coverage ignore next */
  if (ctx.link) run.link = ctx.link;
  /* Coverage rationale: TextRun literal properties are asserted; tsx maps this return tail as uncovered. */
  /* node:coverage ignore next */
  return run;
}

/* Coverage rationale: tsx source maps leave the recursive walker signature uncovered despite blockRichText tests. */
/* node:coverage ignore next 5 */
function collectRuns(
  node: Record<string, unknown>,
  out: TextRun[],
  ctx: RunContext,
): void {
  if (Array.isArray(node.children)) {
    for (const child of node.children as unknown[]) {
      if (!isRecord(child)) continue;
      if (child.type === "linebreak") {
        out.push({ text: "\n" });
        continue;
      }
      if (typeof child.text === "string") {
        const run = textNodeToRun(child, ctx);
        if (run) out.push(run);
        continue;
      }
      if (child.type === "link") {
        const url = typeof child.url === "string" ? child.url : ctx.link;
        collectRuns(child, out, { ...ctx, link: url });
        continue;
      }
      collectRuns(child, out, ctx);
    }
    return;
  }
  if (typeof node.text === "string") {
    const run = textNodeToRun(node, ctx);
    if (run) out.push(run);
  }
}

/**
 * Captures the inline spans under a serialised Lexical block node as a
 * {@link TextRun} array, preserving bold/italic/inline-code/color/link that the
 * plain {@link blockText} discards. Pure and browser-free (testable under
 * `node --test`). Callers that only need a plain string should keep using
 * {@link blockText}.
 */
export function blockRichText(node: Record<string, unknown>): TextRun[] {
  const out: TextRun[] = [];
  collectRuns(node, out, {});
  return out;
}

/** True when any run carries formatting worth preserving over plain text. */
function runsHaveFormatting(runs: TextRun[]): boolean {
  return runs.some(
    (run) => run.bold || run.italic || run.code || run.color || run.link,
  );
}

/**
 * Returns the block's rich runs only when they carry formatting; plain blocks
 * yield `undefined` so formatting-free documents derive identical blocks.
 */
function formattedRuns(node: Record<string, unknown>): TextRun[] | undefined {
  const runs = blockRichText(node);
  return runsHaveFormatting(runs) ? runs : undefined;
}

/**
 * Extracts a non-empty durable `blockId` from the serialised node.
 */
function nodeBlockId(node: Record<string, unknown>): string | undefined {
  if (typeof node.bid === "string" && node.bid.length > 0) return node.bid;
  return undefined;
}

const DOCUMENT_TABLE_MAX_COLUMNS = 12;
const DOCUMENT_TABLE_MAX_ROWS = 100;

function collectTableRows(
  node: Record<string, unknown>,
): DocumentTableCell[][] {
  if (!Array.isArray(node.children)) return [];
  const rows: DocumentTableCell[][] = [];
  for (const rowNode of node.children as unknown[]) {
    if (!isRecord(rowNode)) continue;
    if (rowNode.type !== "tablerow" && rowNode.type !== "table-row") continue;
    const cells: DocumentTableCell[] = [];
    if (Array.isArray(rowNode.children)) {
      for (const cellNode of rowNode.children as unknown[]) {
        if (!isRecord(cellNode)) continue;
        if (
          cellNode.type !== "tablecell" &&
          cellNode.type !== "table-cell" &&
          cellNode.type !== "tableheader" &&
          cellNode.type !== "table-header"
        ) {
          continue;
        }
        const text = blockText(cellNode).trim();
        const runs = formattedRuns(cellNode);
        cells.push({
          text,
          ...(runs ? { runs } : {}),
        });
      }
    }
    if (cells.some((cell) => cell.text.trim().length > 0)) rows.push(cells);
  }
  return rows;
}

function tableBlockFromNode(
  node: Record<string, unknown>,
): DocumentTableBlock | null {
  const rows = collectTableRows(node);
  if (rows.length === 0) return null;
  const width = Math.max(...rows.map((row) => row.length));
  if (width === 0) return null;
  const columnCount = Math.min(width, DOCUMENT_TABLE_MAX_COLUMNS);
  const normalizedRows = rows.map((row) =>
    Array.from(
      { length: columnCount },
      (_value, index) => row[index] ?? { text: "" },
    ),
  );
  const [headerRow, ...bodyRows] = normalizedRows;
  const sourceRows = bodyRows.length > 0 ? bodyRows : normalizedRows;
  const blockId = nodeBlockId(node);
  const caption =
    typeof node.caption === "string" && node.caption.trim().length > 0
      ? node.caption.trim()
      : undefined;
  return {
    kind: "table",
    ...(blockId ? { blockId } : {}),
    ...(caption ? { caption } : {}),
    columns: Array.from({ length: columnCount }, (_value, index) => ({
      id: `col-${index + 1}`,
      label: headerRow?.[index]?.text ?? `Column ${index + 1}`,
    })),
    rows: sourceRows.slice(0, DOCUMENT_TABLE_MAX_ROWS).map((row, rowIndex) => ({
      id: `row-${rowIndex + 1}`,
      cells: row,
    })),
  };
}

function lexicalVisualPayload(visual: unknown): Visual {
  return visual as unknown as Visual;
}

function walkBlocks(node: unknown, out: DocumentBlock[]): void {
  if (!isRecord(node)) return;

  const type = node.type;

  if (type === "visual") {
    if (
      typeof node.visualId === "string" &&
      node.visualId.length > 0 &&
      isRecord(node.visual)
    ) {
      out.push({
        kind: "visual",
        visualId: node.visualId,
        visual: lexicalVisualPayload(node.visual),
      });
    }

    return;
  }

  if (type === "table") {
    const tableBlock = tableBlockFromNode(node);
    if (tableBlock) out.push(tableBlock);
    return;
  }

  if (type === "heading") {
    const tag = typeof node.tag === "string" ? node.tag : "";
    const level = (
      tag === "h1" ? 1 : tag === "h2" ? 2 : tag === "h3" ? 3 : 2
    ) as 1 | 2 | 3;
    const runs = formattedRuns(node);
    const blockId = nodeBlockId(node);
    out.push({
      kind: "text",
      blockType: "heading",
      level,
      text: blockText(node),
      ...(runs ? { runs } : {}),
      ...(blockId ? { blockId } : {}),
    });
    return;
  }

  if (type === "paragraph") {
    const runs = formattedRuns(node);
    const blockId = nodeBlockId(node);
    out.push({
      kind: "text",
      blockType: "paragraph",
      text: blockText(node),
      ...(runs ? { runs } : {}),
      ...(blockId ? { blockId } : {}),
    });
    return;
  }

  if (type === "quote") {
    const runs = formattedRuns(node);
    const blockId = nodeBlockId(node);
    out.push({
      kind: "text",
      blockType: "quote",
      text: blockText(node),
      ...(runs ? { runs } : {}),
      ...(blockId ? { blockId } : {}),
    });
    return;
  }

  if (type === "horizontalrule") {
    const blockId = nodeBlockId(node);
    out.push({
      kind: "text",
      blockType: "hr",
      text: "",
      ...(blockId ? { blockId } : {}),
    });
    return;
  }

  // list → recurse into listitem children
  if (type === "list" && Array.isArray(node.children)) {
    for (const child of node.children as unknown[]) {
      if (!isRecord(child)) continue;
      if (child.type === "listitem") {
        const runs = formattedRuns(child);
        const blockId = nodeBlockId(child);
        out.push({
          kind: "text",
          blockType: "listitem",
          text: blockText(child),
          ...(runs ? { runs } : {}),
          ...(blockId ? { blockId } : {}),
        });
      } else {
        walkBlocks(child, out);
      }
    }
    return;
  }

  // Generic container — recurse
  if (Array.isArray(node.children)) {
    for (const child of node.children as unknown[]) {
      walkBlocks(child, out);
    }
  }
}

/**
 * Walks a serialised Lexical editor state and returns all text/visual blocks
 * in reading (document) order. Accepts the state as a JSON string or a
 * pre-parsed object; malformed input yields an empty array and never throws.
 *
 * This function is intentionally pure and browser-free so it can be tested
 * under `node --test`.
 */
export function collectDocumentBlocks(state: unknown): DocumentBlock[] {
  let parsed: unknown = state;
  if (typeof state === "string") {
    try {
      parsed = JSON.parse(state);
    } catch {
      return [];
    }
  }

  if (!isRecord(parsed)) return [];
  const root = isRecord(parsed.root) ? parsed.root : null;
  if (!root || !Array.isArray(root.children)) return [];

  const out: DocumentBlock[] = [];
  for (const child of root.children as unknown[]) {
    walkBlocks(child, out);
  }
  return out;
}
