/**
 * Deck-source extraction (issue #263).
 *
 * Turns a serialised Lexical document (`contentJson`) plus the document's
 * visuals into the `{ outline, visualInventory }` compatibility shape consumed
 * by the presentation deck generator for input limits, logging, and fallback prompt
 * context.
 *
 * Responsibilities:
 *   - reuse the pure {@link collectDocumentBlocks} walk (and the rich-text runs
 *     it already attaches) rather than re-walking Lexical,
 *   - fold the blocks into a compact, deterministic OUTLINE string that keeps
 *     heading levels, bullet lists, quotes, hr boundaries, inline emphasis and
 *     inline `[visual: <id>]` reference markers,
 *   - build a VISUAL INVENTORY of `{ id, title, type, summary }` entries for the
 *     real document visual ids (in reading order, deduplicated),
 *   - truncate the serialised outline to {@link AI_GENERATION_INPUT_MAX_CHARS} deterministically
 *     while always keeping the heading skeleton.
 *
 * Like its siblings under `@/lib/ai`, this module is intentionally free of any
 * network, DOM, or React dependencies so it can be unit tested under
 * `node --test`. It never throws on malformed/empty input — the empty-outline
 * concern belongs to the deck generation route.
 */

import type { DeckVisualInventoryItem } from "@/lib/ai/deck-generation-options";
import {
  AI_GENERATION_INPUT_MAX_CHARS,
  AI_VISUAL_INVENTORY_MAX_ITEMS,
} from "@/lib/limits";
import type { TextRun } from "@/lib/content/text-run";
import {
  collectDocumentBlocks,
  documentTableBlockToMarkdown,
  type DocumentBlock,
} from "@/lib/content";
import type { Visual } from "@/lib/visual/schema";

/**
 * The compatibility outline source plus truncation metadata so callers (the
 * route, the UI) can notify the user when the document outline was
 * deterministically trimmed to fit {@link AI_GENERATION_INPUT_MAX_CHARS}.
 */
export interface DeckGenerationSource {
  outline: string;
  visualInventory: DeckVisualInventoryItem[];
  /** True when the outline was trimmed to fit the input budget. */
  truncated: boolean;
  /** Length (chars) of the full serialised outline before truncation. */
  originalChars: number;
  /** Length (chars) of the outline actually kept (`outline.length`). */
  keptChars: number;
}

/** Upper bound on a visual inventory `summary` (ids/titles are never cut). */
const MAX_SUMMARY_CHARS = 120;

// ---------------------------------------------------------------------------
// Inline / block serialisation
// ---------------------------------------------------------------------------

/**
 * Renders inline rich-text runs to terse markdown-ish text, preserving the
 * cheap emphases (`**bold**`, `*italic*`, `` `code` ``). Linebreak runs and
 * empty spans pass through untouched.
 */
function renderRuns(runs: ReadonlyArray<TextRun>): string {
  return runs
    .map((run) => {
      let text = run.text;
      if (text === "" || text === "\n") return text;
      if (run.code) text = `\`${text}\``;
      if (run.bold) text = `**${text}**`;
      if (run.italic) text = `*${text}*`;
      return text;
    })
    .join("");
}

/** Plain or emphasis-preserving text for a text block. */
function blockContent(block: Extract<DocumentBlock, { kind: "text" }>): string {
  if (block.runs && block.runs.length > 0) {
    return renderRuns(block.runs);
  }
  return block.text;
}

/**
 * Serialises one document block into a single terse outline line, or `null`
 * when it carries no content worth emitting. Headings keep their level via a
 * `#` prefix; bullets use `- `; quotes use `> `; hr is `---`; visuals appear
 * inline as `[visual: <id>]` reference markers.
 */
function serializeBlock(block: DocumentBlock): string | null {
  if (block.kind === "visual") {
    return `[visual: ${block.visualId}]`;
  }

  if (block.kind === "table") {
    return documentTableBlockToMarkdown(block);
  }

  if (block.blockType === "hr") {
    return "---";
  }

  const content = blockContent(block).trim();

  switch (block.blockType) {
    case "heading": {
      const level = block.level ?? 2;
      return `${"#".repeat(level)} ${content}`.trimEnd();
    }
    case "listitem":
      return content === "" ? null : `- ${content}`;
    case "quote":
      return content === "" ? null : `> ${content}`;
    case "paragraph":
      return content === "" ? null : content;
    default:
      return content === "" ? null : content;
  }
}

function isHeadingBlock(block: DocumentBlock): boolean {
  return block.kind === "text" && block.blockType === "heading";
}

// ---------------------------------------------------------------------------
// Outline assembly + deterministic truncation
// ---------------------------------------------------------------------------

interface OutlineItem {
  line: string;
  heading: boolean;
}

/** Upper-bound cost of a line once joined with `\n` (over-counts by one total). */
function lineCost(line: string): number {
  return line.length + 1;
}

interface BuiltOutline {
  outline: string;
  truncated: boolean;
  originalChars: number;
  keptChars: number;
}

/**
 * Folds the blocks into a single outline string no longer than
 * {@link AI_GENERATION_INPUT_MAX_CHARS}. The heading skeleton is treated as mandatory
 * structure and reserved first; the remaining budget is then filled with DETAIL
 * blocks in reading order, so trailing detail is dropped first while every
 * heading survives (until headings alone would blow the budget, an extreme case
 * in which trailing headings are dropped too). Output is fully deterministic.
 *
 * Returns the kept outline alongside truncation metadata: `originalChars` is the
 * length the outline would have had with every block retained, `keptChars` is
 * the length actually emitted, and `truncated` is true whenever any block line
 * was dropped to honour the budget.
 */
function buildOutline(blocks: ReadonlyArray<DocumentBlock>): BuiltOutline {
  const items: OutlineItem[] = [];
  for (const block of blocks) {
    const line = serializeBlock(block);
    if (line === null) continue;
    items.push({ line, heading: isHeadingBlock(block) });
  }
  if (items.length === 0) {
    return { outline: "", truncated: false, originalChars: 0, keptChars: 0 };
  }

  const originalChars = items.map((item) => item.line).join("\n").length;

  let headingBudget = 0;
  for (const item of items) {
    if (item.heading) headingBudget += lineCost(item.line);
  }
  const detailCap = Math.max(0, AI_GENERATION_INPUT_MAX_CHARS - headingBudget);

  const lines: string[] = [];
  let used = 0;
  let detailUsed = 0;
  let dropped = false;

  for (const item of items) {
    const cost = lineCost(item.line);
    if (item.heading) {
      if (used + cost <= AI_GENERATION_INPUT_MAX_CHARS) {
        lines.push(item.line);
        used += cost;
      } else {
        dropped = true;
      }
      continue;
    }
    if (
      detailUsed + cost <= detailCap &&
      used + cost <= AI_GENERATION_INPUT_MAX_CHARS
    ) {
      lines.push(item.line);
      used += cost;
      detailUsed += cost;
    } else {
      dropped = true;
    }
  }

  const outline = lines.join("\n");
  return {
    outline,
    truncated: dropped,
    originalChars,
    keptChars: outline.length,
  };
}

// ---------------------------------------------------------------------------
// Visual inventory
// ---------------------------------------------------------------------------

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Human-readable fallback title derived from the visual kind. */
function titleFromType(type: string): string {
  if (type.length === 0) return "Untitled visual";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** Short, ≤{@link MAX_SUMMARY_CHARS} description from the visual's node labels. */
function summarizeVisual(visual: Visual): string {
  const labels = Array.isArray(visual.nodes)
    ? visual.nodes
        .map((node) =>
          typeof node?.label === "string" ? node.label.trim() : "",
        )
        .filter((label) => label.length > 0)
    : [];
  return truncate(labels.join(", "), MAX_SUMMARY_CHARS);
}

function toInventoryItem(
  visualId: string,
  visual: Visual,
): DeckVisualInventoryItem {
  const title =
    typeof visual.title === "string" && visual.title.trim().length > 0
      ? visual.title.trim()
      : titleFromType(String(visual.type ?? ""));
  return {
    id: visualId,
    title,
    type: String(visual.type ?? ""),
    summary: summarizeVisual(visual),
  };
}

/**
 * Builds the inventory for the REAL document visual ids, in reading order and
 * deduplicated. The authoritative {@link Visual} is taken from the `visuals`
 * map when present, otherwise the copy embedded in the document block. Visuals
 * present only in the map (not referenced by the document) are excluded.
 */
function buildInventory(
  blocks: ReadonlyArray<DocumentBlock>,
  visuals: ReadonlyMap<string, Visual>,
): DeckVisualInventoryItem[] {
  const inventory: DeckVisualInventoryItem[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    if (inventory.length >= AI_VISUAL_INVENTORY_MAX_ITEMS) break;
    if (block.kind !== "visual") continue;
    if (seen.has(block.visualId)) continue;
    seen.add(block.visualId);

    const visual = visuals.get(block.visualId) ?? block.visual;
    inventory.push(toInventoryItem(block.visualId, visual));
  }

  return inventory;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extracts the structured `{ outline, visualInventory }` deck source from a
 * serialised Lexical document and its visuals, plus truncation metadata
 * (`truncated`, `originalChars`, `keptChars`). Pure and headless. Never throws:
 * an empty/malformed document yields `{ outline: "", visualInventory: [],
 * truncated: false, originalChars: 0, keptChars: 0 }`.
 *
 * @param contentJson  Serialised Lexical editor state (string or pre-parsed).
 * @param visuals      The document's visuals, keyed by visual id.
 */
export function buildDeckSource(
  contentJson: unknown,
  visuals: ReadonlyMap<string, Visual>,
): DeckGenerationSource {
  const blocks = collectDocumentBlocks(contentJson);
  const outline = buildOutline(blocks);
  return {
    outline: outline.outline,
    visualInventory: buildInventory(blocks, visuals),
    truncated: outline.truncated,
    originalChars: outline.originalChars,
    keptChars: outline.keptChars,
  };
}

export { buildDeckSource as buildDeckGenerationSource };
export type { DeckGenerationSource as DeckSource };
