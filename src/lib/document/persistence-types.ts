export type DeckActionFailureCode =
  | "document_not_found"
  | "invalid_deck"
  | "deck_too_large"
  | "storage_unavailable";

export type DeckActionFailure = {
  code: DeckActionFailureCode;
  retryable: boolean;
};

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
  | { ok: true; deckJson: unknown; revisionToken: string | null }
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
