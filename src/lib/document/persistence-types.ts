import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";

export const DECK_ACTION_FAILURE_CODES = [
  "document_not_found",
  "invalid_deck",
  "invalid_revision_token",
  "deck_too_large",
  "storage_unavailable",
] as const;

export type DeckActionFailureCode = (typeof DECK_ACTION_FAILURE_CODES)[number];

const DECK_ACTION_FAILURE_CODE_SET: ReadonlySet<string> = new Set(
  DECK_ACTION_FAILURE_CODES,
);

export function isDeckActionFailureCode(
  value: unknown,
): value is DeckActionFailureCode {
  return typeof value === "string" && DECK_ACTION_FAILURE_CODE_SET.has(value);
}

export type DeckActionFailure = {
  code: DeckActionFailureCode;
  retryable: boolean;
};

export type DeckActionFailureError = Error & {
  failure: DeckActionFailure;
};

export function isDeckActionFailureError(
  error: unknown,
): error is DeckActionFailureError {
  if (!(error instanceof Error) || !("failure" in error)) return false;
  const failure = error.failure;
  return (
    typeof failure === "object" &&
    failure !== null &&
    "code" in failure &&
    "retryable" in failure &&
    isDeckActionFailureCode(failure.code) &&
    typeof failure.retryable === "boolean"
  );
}

export type SaveDeckFailureResult = {
  ok: false;
  error: string;
  failure: DeckActionFailure;
};

export type SaveDeckResult =
  | { ok: true; revisionToken: string }
  | { ok: "conflict"; serverRevisionToken: string | null }
  | SaveDeckFailureResult;

export type FetchDeckResult =
  | {
      ok: true;
      deckJson: unknown;
      revisionToken: string | null;
      activeCustomThemePackage?: ThemePackageV1;
      themeDiagnostics: PresentationDiagnostic[];
    }
  | {
      ok: false;
      deckJson: null;
      revisionToken: null;
      error: string;
      failure: DeckActionFailure;
    };

export type RestoredDocumentVersion = {
  documentId: string;
  contentJson: unknown;
};

export type DocumentVersionSummary = {
  id: string;
  createdAt: string;
  label: string | null;
  /** Display name of the user who triggered the snapshot, when known. */
  authorName: string | null;
  /** Whether this snapshot carries a presentation deck alongside the document. */
  hasDeck: boolean;
};

export type ShareSettings = {
  isShared: boolean;
  shareId: string | null;
  slug: string | null;
  shareUrl: string | null;
  /** ISO-8601 expiry, or `null` when the link never expires. */
  expiresAt: string | null;
  embedEnabled: boolean;
  presentEnabled: boolean;
  metadataMode: "generic" | "title" | "title-excerpt";
  discoverable: boolean;
  passcodeEnabled: boolean;
};
