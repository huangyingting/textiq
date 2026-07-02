/**
 * Boundary helper for opening a deck from raw persisted JSON.
 *
 * `openDeckFromJson` is the single entry point for loading deck JSON at editor,
 * present-mode, and public-render boundaries. It accepts valid Deck payloads
 * directly and rejects superseded payload shapes before the editor runtime sees
 * the deck.
 */

import type { PresentationDiagnostic } from "./diagnostics";
import { safeParseDeck } from "./validation";
import { DECK_SCHEMA_VERSION, type Deck } from "./schema";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type OpenDeckResult =
  | {
      ok: true;
      deck: Deck;
      source: "presentation";
      diagnostics: PresentationDiagnostic[];
    }
  | {
      ok: false;
      /** Human-readable error describing why the deck could not be opened. */
      error: string;
      /** Validation errors returned when attempting presentation parse (if applicable). */
      errors?: string[];
      diagnostics: PresentationDiagnostic[];
    };

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Opens current Deck JSON.
 *
 * Returns `{ ok: false }` for superseded, malformed, or unknown payload shapes.
 */
export function openDeckFromJson(raw: unknown): OpenDeckResult {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: "Deck JSON must be a plain object.",
      diagnostics: [],
    };
  }

  const version = raw.schemaVersion;

  if (version === DECK_SCHEMA_VERSION) {
    const result = safeParseDeck(raw);
    if (result.success) {
      return {
        ok: true,
        deck: result.data,
        source: "presentation",
        diagnostics: [],
      };
    }
    return {
      ok: false,
      error: `presentation deck validation failed: ${result.errors.join("; ")}`,
      errors: result.errors,
      diagnostics: [],
    };
  }

  return {
    ok: false,
    error: `Unrecognised deck schema (version=${String(version)}). Expected schemaVersion ${DECK_SCHEMA_VERSION}.`,
    diagnostics: [],
  };
}

/**
 * Detects whether raw JSON appears to be a presentation deck without full validation.
 *
 * Useful for routing decisions before a full parse. Does not guarantee the
 * deck is structurally valid.
 */
export function looksLikeDeck(raw: unknown): boolean {
  return isPlainObject(raw) && raw.schemaVersion === DECK_SCHEMA_VERSION;
}

/**
 * Routes an AI-generated deck through the same validating open boundary.
 *
 * The AI deck-generation pipeline parses model output with `safeParseDeck`
 * before it reaches the editor, but the apply path must still pass through the
 * single open boundary so a malformed proposal produces structured diagnostics
 * (and a recovery surface) instead of silently replacing the editor with a
 * blank deck. This thin wrapper exists so the AI-apply call site is explicit
 * about going through {@link openDeckFromJson}; it adds no AI-specific parsing.
 */
export function openAiGeneratedDeck(raw: unknown): OpenDeckResult {
  return openDeckFromJson(raw);
}

/**
 * The three ways the editor can start, decided from a raw persisted candidate.
 *
 * - `blank`: there is genuinely no deck to open (null/undefined input), so the
 *   editor starts from an explicit, guarded blank deck.
 * - `open`: the candidate is a valid Deck payload.
 * - `recovery`: the candidate is non-empty but could not be opened, so the
 *   editor must show a recovery surface with diagnostics — never a blank deck.
 */
export type DeckOpenDecision =
  | { mode: "blank" }
  | {
      mode: "open";
      deck: Deck;
      source: "presentation";
      diagnostics: PresentationDiagnostic[];
    }
  | {
      mode: "recovery";
      error: string;
      errors?: string[];
      diagnostics: PresentationDiagnostic[];
    };

/**
 * Decides how the editor should start from a raw persisted deck candidate.
 *
 * This is the guarded boundary that prevents invalid-but-non-empty deck JSON
 * from silently becoming a blank editor: only a genuinely absent candidate
 * (`null`/`undefined`) yields `blank`; any non-empty candidate that fails to
 * open yields `recovery` so the caller can surface diagnostics and let the user
 * choose a safe path (rather than overwriting their data with a blank deck).
 */
export function decideDeckOpen(raw: unknown): DeckOpenDecision {
  if (raw === null || raw === undefined) {
    return { mode: "blank" };
  }
  const result = openDeckFromJson(raw);
  if (result.ok) {
    return {
      mode: "open",
      deck: result.deck,
      source: result.source,
      diagnostics: result.diagnostics,
    };
  }
  return {
    mode: "recovery",
    error: result.error,
    errors: result.errors,
    diagnostics: result.diagnostics,
  };
}
