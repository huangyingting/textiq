/**
 * Pure presentation paragraph/run serialization helpers for the slide inline editor.
 *
 * No DOM, no React — safe in Node test runner and server contexts.
 *
 * The inline editor commit path is:
 *   contenteditable → serializeRichText (legacy, DOM) → TextRun[]
 *   → mergeRuns   → store in Paragraph.runs
 *   → updateNodeContent(deck, slideId, nodeId, { paragraphs })
 *
 * The helpers here operate on the presentation schema types (`Paragraph`, `TextRun`,
 * `FramePct`) and are the headless counterpart to the inline editor DOM path.
 */

import type { Paragraph, TextRun } from "./schema";
import type { FramePct } from "./types";

// ---------------------------------------------------------------------------
// Plain-text extraction
// ---------------------------------------------------------------------------

/** Joins all paragraph `text` fields with a newline separator. */
export function paragraphsToPlainText(paragraphs: Paragraph[]): string {
  return paragraphs.map((p) => p.text).join("\n");
}

/** Concatenates run `text` fields into a single plain string. */
export function runsToPlainText(runs: readonly TextRun[]): string {
  return runs.map((r) => r.text).join("");
}

// ---------------------------------------------------------------------------
// Run predicate
// ---------------------------------------------------------------------------

/**
 * Returns `true` when any run carries non-plain formatting that should be
 * persisted in `Paragraph.runs`.  Plain runs (text-only, no style) need not
 * be stored; storing only when necessary keeps the payload compact.
 */
export function shouldStoreRuns(runs: readonly TextRun[]): boolean {
  return runs.some(
    (run) =>
      run.bold ||
      run.italic ||
      run.underline ||
      run.strikethrough ||
      run.code ||
      run.link !== undefined ||
      run.localStyle !== undefined,
  );
}

// ---------------------------------------------------------------------------
// Run merging
// ---------------------------------------------------------------------------

function sameRunStyle(a: TextRun, b: TextRun): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.code === b.code &&
    a.link === b.link &&
    a.localStyle?.color === b.localStyle?.color &&
    a.localStyle?.fontSizePt === b.localStyle?.fontSizePt &&
    a.localStyle?.fontFamily === b.localStyle?.fontFamily
  );
}

/**
 * Merges adjacent runs that share identical formatting into a single run.
 * Empty-text runs are discarded.
 */
export function mergeRuns(runs: TextRun[]): TextRun[] {
  const merged: TextRun[] = [];
  for (const run of runs) {
    if (run.text.length === 0) continue;
    const last = merged[merged.length - 1];
    if (last && sameRunStyle(last, run)) {
      last.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Paragraph parsing
// ---------------------------------------------------------------------------

let _idCounter = 0;

/** Resets the internal paragraph ID counter (test helper). */
export function resetParagraphIdCounter(): void {
  _idCounter = 0;
}

/** Default sequential ID generator for `parseParagraphsFromPlainText`. */
function defaultParagraphId(): string {
  return `p-${(++_idCounter).toString(36)}`;
}

/**
 * Splits a plain-text string on newlines and returns one `Paragraph` per line.
 * An empty `text` string produces a single paragraph with an empty `text` field.
 */
export function parseParagraphsFromPlainText(
  text: string,
  generateId: () => string = defaultParagraphId,
): Paragraph[] {
  const lines = text.split("\n");
  return lines.map((line) => ({ id: generateId(), text: line }));
}

// ---------------------------------------------------------------------------
// Inline editor overlay geometry
// ---------------------------------------------------------------------------

/**
 * Converts a canvas-relative percent frame to CSS pixel values for the
 * `InlineTextEditorPresentation` overlay.
 *
 * Matching the spec formula:
 *   left   = frame.x / 100 * canvasWidth
 *   top    = frame.y / 100 * canvasHeight
 *   width  = frame.w / 100 * canvasWidth
 *   height = frame.h / 100 * canvasHeight
 */
export function framePctToCssPx(
  frame: FramePct,
  canvasW: number,
  canvasH: number,
): { left: number; top: number; width: number; height: number } {
  return {
    left: (frame.x / 100) * canvasW,
    top: (frame.y / 100) * canvasH,
    width: (frame.w / 100) * canvasW,
    height: (frame.h / 100) * canvasH,
  };
}
