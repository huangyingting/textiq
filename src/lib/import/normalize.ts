/**
 * Normalizes raw extracted text before it is returned to the caller.
 *
 * - Collapses runs of more than two consecutive blank lines into two.
 * - Removes null bytes and other control characters (except newlines/tabs).
 * - Trims leading/trailing whitespace.
 * - Truncates to AI_GENERATION_INPUT_MAX_CHARS so the content can immediately
 *   drive the AI generation flow without hitting the generate-route's own guard.
 */

import { AI_GENERATION_INPUT_MAX_CHARS } from "@/lib/limits/ai";

/**
 * Cleans and truncates extracted document text.
 *
 * Returns the normalized string (never throws). If the input is empty after
 * normalization an empty string is returned.
 */
export function normalizeImportedText(raw: string): string {
  // Strip null bytes and non-printable control characters (keep \t \n \r).
  let text = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Collapse runs of 3+ blank lines to a single blank line.
  text = text.replace(/\n{3,}/g, "\n\n");

  text = text.trim();

  if (text.length > AI_GENERATION_INPUT_MAX_CHARS) {
    // Truncate at the last newline before the limit to avoid cutting mid-word.
    const cutoff = text.lastIndexOf("\n", AI_GENERATION_INPUT_MAX_CHARS);
    text = text.slice(0, cutoff > 0 ? cutoff : AI_GENERATION_INPUT_MAX_CHARS);
  }

  return text;
}
