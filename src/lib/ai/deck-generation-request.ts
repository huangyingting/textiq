/**
 * DOM-free request-shaping, response-parsing, and error-classification helpers
 * for the AI "document → presentation Deck" generation request (issue #268).
 *
 * Kept React-/DOM-free (no `"use client"`, no `react` import) so it can be
 * exercised headlessly under `node --test`, mirroring how
 * `@/lib/visual/generate` separates its pure helpers + `requestVisualCandidates`
 * with an injectable `fetch`. The React hook layer lives in
 * `@/lib/ai/use-deck-generation`.
 */

import type { DeckGenerationOptions } from "@/lib/ai/deck-generation-options";
import { apiErrorMessageFromPayload } from "@/lib/api/error-message";
import {
  isThemePackageId,
  type ThemePackageId,
} from "@/lib/presentation/theme-package-ids";
import {
  DIAGNOSTIC_CATEGORIES,
  DIAGNOSTIC_TARGET_SCOPES,
  type DiagnosticCategory,
  type DiagnosticSeverity,
  type DiagnosticTarget,
  type DiagnosticTargetScope,
  type PresentationDiagnostic,
} from "@/lib/presentation/diagnostics";
import { safeParseDeck } from "@/lib/presentation/validation";
import type { Deck } from "@/lib/presentation/schema";

export type { DeckGenerationOptions } from "@/lib/ai/deck-generation-options";

/**
 * Classifies a failed deck-generation request:
 * - `network`  — the request never reached the server (fetch threw).
 * - `timeout`  — the request was aborted or the server returned 504.
 * - `credit`   — insufficient credits / quota (402).
 * - `unavailable` — the feature flag is OFF server-side (404): the caller
 *   should silently fall back to the deterministic derive path.
 * - `empty`    — the document has no usable outline content (400): the caller
 *   should show a friendly "add some content first" message rather than a
 *   generic error (issue #280).
 * - `other`    — any other non-OK status or an unparseable response.
 */
export type DeckGenerateErrorKind =
  | "network"
  | "timeout"
  | "credit"
  | "unavailable"
  | "empty"
  | "other";

/** A user-facing error plus its classification. */
export interface DeckGenerateError {
  message: string;
  kind: DeckGenerateErrorKind;
}

/** Result of a deck-generation request: a usable deck or a classified error. */
export interface DeckGenerationResponseMetadata {
  planner?: "ai";
  mode?: NonNullable<DeckGenerationOptions["mode"]>;
  tableSlideCount?: number;
  schemaValid?: boolean;
  themePackageId?: ThemePackageId;
  selectedKindCounts?: Record<string, number>;
}

export type DeckGenerateResult =
  | {
      ok: true;
      deck: Deck;
      truncated: boolean;
      diagnostics: PresentationDiagnostic[];
      metadata?: DeckGenerationResponseMetadata;
    }
  | { ok: false; error: string; errorKind: DeckGenerateErrorKind };

const FALLBACK_REQUEST_ERROR =
  "We couldn't generate a deck from that document. Please try again.";
const UNAVAILABLE_ERROR = "AI deck generation isn't available right now.";
const TIMEOUT_ERROR = "The AI took too long to respond. Please try again.";
const NETWORK_ERROR =
  "Couldn't reach the generator. Check your connection and try again.";
const BAD_PAYLOAD_ERROR =
  "The generator returned an unexpected response. Please try again.";
/** Shown when the document has no usable outline content yet (issue #280). */
export const EMPTY_CONTENT_ERROR =
  "Add some content to your document first, then generate slides.";

/**
 * Marker substring of the route's empty-outline 400 message
 * ("`contentJson` does not contain any usable outline content."). Matched
 * loosely so the empty-document case is classified distinctly from generic
 * 400s (issue #280).
 */
const EMPTY_OUTLINE_MARKER = "does not contain any usable outline content";
const DIAGNOSTIC_CATEGORIES_SET = new Set<DiagnosticCategory>(
  DIAGNOSTIC_CATEGORIES,
);
const DIAGNOSTIC_TARGET_SCOPES_SET = new Set<DiagnosticTargetScope>(
  DIAGNOSTIC_TARGET_SCOPES,
);
const DIAGNOSTIC_SEVERITY_SET = new Set<DiagnosticSeverity>([
  "info",
  "warning",
  "error",
  "fatal",
]);

/** True when a 400 payload is the route's empty-outline rejection. */
function isEmptyOutline400(payload: unknown): boolean {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error: unknown }).error;
    return typeof error === "string" && error.includes(EMPTY_OUTLINE_MARKER);
  }
  return false;
}

/**
 * Build the `/api/generate-deck` request body from the live document content and
 * the optional length/tone/audience tuning. Blank/whitespace-only tone and
 * audience values are omitted, and the `options` object is only included when at
 * least one knob is set — mirroring how `buildGenerateBody` omits unset knobs.
 */
export function buildDeckGenerationBody(
  contentJson: unknown,
  options: DeckGenerationOptions = {},
  request?: {
    themePackageId?: ThemePackageId;
  },
): Record<string, unknown> {
  const opts: Record<string, unknown> = {};
  if (options.length) opts.length = options.length;
  if (typeof options.tone === "string" && options.tone.trim().length > 0) {
    opts.tone = options.tone.trim();
  }
  if (
    typeof options.audience === "string" &&
    options.audience.trim().length > 0
  ) {
    opts.audience = options.audience.trim();
  }
  if (options.mode) opts.mode = options.mode;
  const body: Record<string, unknown> = { contentJson };
  if (Object.keys(opts).length > 0) {
    body.options = opts;
  }
  if (request?.themePackageId !== undefined) {
    body.themePackageId = request.themePackageId;
  }
  return body;
}

/* node:coverage ignore start */
/* Coverage rationale: response parser JSDoc is documentation-only; parser branches are asserted. */
/**
 * Validate a `{ deck, truncated }` response payload. Returns the parsed Deck
 * and the `truncated` flag, or `null` when the payload is missing/invalid.
 */
/* node:coverage ignore stop */
function parseKindCounts(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
      counts[key] = count;
    }
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
}

function parseDeckResponseMetadata(
  value: unknown,
): DeckGenerationResponseMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const metadata: DeckGenerationResponseMetadata = {};
  if (raw.planner === "ai") {
    metadata.planner = raw.planner;
  }
  if (raw.mode === "faithful" || raw.mode === "presentationRewrite") {
    metadata.mode = raw.mode;
  }
  if (typeof raw.tableSlideCount === "number" && raw.tableSlideCount >= 0) {
    metadata.tableSlideCount = raw.tableSlideCount;
  }
  if (typeof raw.schemaValid === "boolean") {
    metadata.schemaValid = raw.schemaValid;
  }
  if (isThemePackageId(raw.themePackageId)) {
    metadata.themePackageId = raw.themePackageId;
  }
  const selectedKindCounts = parseKindCounts(raw.selectedKindCounts);
  if (selectedKindCounts) {
    metadata.selectedKindCounts = selectedKindCounts;
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function getStringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof record[key] === "string" ? (record[key] as string) : undefined;
}

function parseDiagnosticTarget(value: unknown): DiagnosticTarget | undefined {
  const raw = getRecord(value);
  if (!raw) return undefined;
  const scope = getStringField(raw, "scope");
  if (
    !scope ||
    !DIAGNOSTIC_TARGET_SCOPES_SET.has(scope as DiagnosticTargetScope)
  )
    return undefined;

  const path = getStringField(raw, "path");
  const label = getStringField(raw, "label");

  switch (scope) {
    case "deck":
      return {
        scope,
        ...(path ? { path } : {}),
        ...(label ? { label } : {}),
      };
    case "slide": {
      const slideId = getStringField(raw, "slideId");
      if (!slideId) return undefined;
      return {
        scope,
        slideId,
        ...(path ? { path } : {}),
        ...(label ? { label } : {}),
      };
    }
    case "node": {
      const nodeId = getStringField(raw, "nodeId");
      if (!nodeId) return undefined;
      const slideId = getStringField(raw, "slideId");
      return {
        scope,
        nodeId,
        ...(slideId ? { slideId } : {}),
        ...(path ? { path } : {}),
        ...(label ? { label } : {}),
      };
    }
    case "asset": {
      const assetId = getStringField(raw, "assetId");
      const slideId = getStringField(raw, "slideId");
      const nodeId = getStringField(raw, "nodeId");
      return {
        scope,
        ...(assetId ? { assetId } : {}),
        ...(slideId ? { slideId } : {}),
        ...(nodeId ? { nodeId } : {}),
        ...(path ? { path } : {}),
        ...(label ? { label } : {}),
      };
    }
    case "source": {
      const documentId = getStringField(raw, "documentId");
      const blockId = getStringField(raw, "blockId");
      const slideId = getStringField(raw, "slideId");
      const nodeId = getStringField(raw, "nodeId");
      return {
        scope,
        ...(documentId ? { documentId } : {}),
        ...(blockId ? { blockId } : {}),
        ...(slideId ? { slideId } : {}),
        ...(nodeId ? { nodeId } : {}),
        ...(path ? { path } : {}),
        ...(label ? { label } : {}),
      };
    }
    case "style": {
      const styleRef = getStringField(raw, "styleRef");
      const slideId = getStringField(raw, "slideId");
      const nodeId = getStringField(raw, "nodeId");
      return {
        scope,
        ...(styleRef ? { styleRef } : {}),
        ...(slideId ? { slideId } : {}),
        ...(nodeId ? { nodeId } : {}),
        ...(path ? { path } : {}),
        ...(label ? { label } : {}),
      };
    }
    case "theme": {
      const themePackageId = getStringField(raw, "themePackageId");
      const slideId = getStringField(raw, "slideId");
      return {
        scope,
        ...(themePackageId ? { themePackageId } : {}),
        ...(slideId ? { slideId } : {}),
        ...(path ? { path } : {}),
        ...(label ? { label } : {}),
      };
    }
    case "export": {
      const exportFeature = getStringField(raw, "exportFeature");
      const slideId = getStringField(raw, "slideId");
      const nodeId = getStringField(raw, "nodeId");
      return {
        scope,
        ...(exportFeature ? { exportFeature } : {}),
        ...(slideId ? { slideId } : {}),
        ...(nodeId ? { nodeId } : {}),
        ...(path ? { path } : {}),
        ...(label ? { label } : {}),
      };
    }
  }
}

function parsePresentationDiagnostic(
  value: unknown,
): PresentationDiagnostic | null {
  const raw = getRecord(value);
  if (!raw) return null;

  const code = getStringField(raw, "code");
  const category = getStringField(raw, "category");
  const severity = getStringField(raw, "severity");
  const message = getStringField(raw, "message");
  const target = parseDiagnosticTarget(raw.target);
  if (
    !code ||
    !category ||
    !DIAGNOSTIC_CATEGORIES_SET.has(category as DiagnosticCategory) ||
    !severity ||
    !DIAGNOSTIC_SEVERITY_SET.has(severity as DiagnosticSeverity) ||
    !message ||
    !target
  ) {
    return null;
  }

  const diagnostic: PresentationDiagnostic = {
    code: code as PresentationDiagnostic["code"],
    category: category as DiagnosticCategory,
    severity: severity as DiagnosticSeverity,
    target,
    message,
  };

  const path = getStringField(raw, "path");
  if (path) diagnostic.path = path;

  const nodeId = getStringField(raw, "nodeId");
  if (nodeId) diagnostic.nodeId = nodeId;

  const slideId = getStringField(raw, "slideId");
  if (slideId) diagnostic.slideId = slideId;

  const action = getRecord(raw.action);
  if (action && typeof action.type === "string") {
    diagnostic.action = action as PresentationDiagnostic["action"];
  }

  const details = getRecord(raw.details);
  if (details) {
    diagnostic.details = details as PresentationDiagnostic["details"];
  }

  return diagnostic;
}

function parseDeckResponseDiagnostics(
  value: unknown,
): PresentationDiagnostic[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const diagnostics: PresentationDiagnostic[] = [];
  for (const entry of value) {
    const parsed = parsePresentationDiagnostic(entry);
    if (parsed) diagnostics.push(parsed);
  }
  return diagnostics;
}

export function parseDeckResponse(payload: unknown): {
  deck: Deck;
  truncated: boolean;
  diagnostics: PresentationDiagnostic[];
  metadata?: DeckGenerationResponseMetadata;
} | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const rawDeck = (payload as { deck?: unknown }).deck;
  const truncated = (payload as { truncated?: unknown }).truncated === true;
  const diagnostics = parseDeckResponseDiagnostics(
    (payload as { diagnostics?: unknown }).diagnostics,
  );
  const metadata = parseDeckResponseMetadata(
    (payload as { metadata?: unknown }).metadata,
  );
  const metaField = metadata ? { metadata } : {};

  if (
    rawDeck !== null &&
    typeof rawDeck === "object" &&
    !Array.isArray(rawDeck) &&
    (rawDeck as Record<string, unknown>).schemaVersion === 7
  ) {
    const presentationResult = safeParseDeck(rawDeck);
    if (!presentationResult.success) return null;
    return {
      deck: presentationResult.data,
      truncated,
      diagnostics,
      ...metaField,
    };
  }

  return null;
}

/** True when a thrown fetch error is an abort (client cancel or timeout). */
function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/**
 * POST the document `contentJson` + tuning options to `/api/generate-deck` and
 * return a parsed deck or a classified error. This is the ONE place the fetch +
 * status/error handling lives. `fetchImpl` is injectable for tests, and an
 * optional `signal` supports cancellation/timeout.
 */
export async function requestDeckGeneration(
  contentJson: unknown,
  options: DeckGenerationOptions = {},
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  request?: {
    themePackageId?: ThemePackageId;
  },
): Promise<DeckGenerateResult> {
  let response: Response;
  try {
    response = await fetchImpl("/api/generate-deck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        buildDeckGenerationBody(contentJson, options, request),
      ),
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      return { ok: false, error: TIMEOUT_ERROR, errorKind: "timeout" };
    }
    return { ok: false, error: NETWORK_ERROR, errorKind: "network" };
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 404) {
      return {
        ok: false,
        error: apiErrorMessageFromPayload(payload, UNAVAILABLE_ERROR),
        errorKind: "unavailable",
      };
    }
    if (response.status === 402) {
      return {
        ok: false,
        error: apiErrorMessageFromPayload(payload, FALLBACK_REQUEST_ERROR),
        errorKind: "credit",
      };
    }
    if (response.status === 504) {
      return {
        ok: false,
        error: apiErrorMessageFromPayload(payload, TIMEOUT_ERROR),
        errorKind: "timeout",
      };
    }
    if (response.status === 400 && isEmptyOutline400(payload)) {
      return {
        ok: false,
        error: EMPTY_CONTENT_ERROR,
        errorKind: "empty",
      };
    }
    return {
      ok: false,
      error: apiErrorMessageFromPayload(payload, FALLBACK_REQUEST_ERROR),
      errorKind: "other",
    };
  }

  const parsed = parseDeckResponse(payload);
  if (!parsed) {
    return { ok: false, error: BAD_PAYLOAD_ERROR, errorKind: "other" };
  }
  return {
    ok: true,
    deck: parsed.deck,
    truncated: parsed.truncated,
    diagnostics: parsed.diagnostics,
    ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
  };
}
