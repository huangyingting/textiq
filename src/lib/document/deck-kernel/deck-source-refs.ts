/** Source reference model and helpers. */

/**
 * Provenance metadata linking an inserted slide element back to a source
 * document block for sync and staleness tracking.
 */
export interface SourceRef {
  documentId: string;
  /**
   * Durable source block id. For `blockKind: "text"` and `"table"` this is
   * the document block `bid` / `blockId`; for `blockKind: "visual"` this is the visual id.
   * It is never a live Lexical NodeKey.
   */
  blockId: string;
  /** Hash of the source content at insertion time, used for staleness checks. */
  /* node:coverage ignore next -- Type-only optional field is erased by tsx and reported as a source-map gap. */
  contentHash?: string;
  /** ISO timestamp describing when the source link was established. */
  linkedAt: string;
  /** True when the user explicitly broke the source link. */
  unlinked?: boolean;
  /** Kind of source block this ref points to. */
  blockKind: "text" | "visual" | "table";
}

type SourceRefCarrier = { source?: SourceRef };

export interface SourceRefFromDurableBlockIdInput {
  documentId: string;
  blockId: string;
  blockKind: SourceRef["blockKind"];
  linkedAt: string;
  contentHash?: string;
}

function cloneSourceRef(ref: SourceRef): SourceRef {
  return {
    documentId: ref.documentId,
    blockId: ref.blockId,
    ...(ref.contentHash !== undefined ? { contentHash: ref.contentHash } : {}),
    linkedAt: ref.linkedAt,
    ...(ref.unlinked === true ? { unlinked: true } : {}),
    blockKind: ref.blockKind,
  };
}

function cloneLinkedSourceRef(ref: SourceRef): SourceRef {
  const { unlinked: _unlinked, ...linkedRef } = ref;
  return cloneSourceRef(linkedRef);
}

/**
 * Adapter for call sites that have a durable document block/visual id and need
 * the persisted `SourceRef.blockId` field. The explicit name prevents confusing
 * durable ids with transient Lexical node keys.
 */
export function sourceRefFromDurableBlockId(
  input: SourceRefFromDurableBlockIdInput,
): SourceRef {
  return cloneLinkedSourceRef(input);
}

/** Returns the durable id stored in `SourceRef.blockId`. */
export function durableBlockIdFromSourceRef(ref: SourceRef): string {
  return ref.blockId;
}

/** Returns an active source ref by stripping the transient `unlinked` flag. */
export function activeSourceRef(ref: SourceRef): SourceRef {
  return cloneLinkedSourceRef(ref);
}

/** Returns true when an element still has an active source link. */
export function isSourceLinked(el: SourceRefCarrier): boolean {
  return el.source !== undefined && el.source.unlinked !== true;
}

/**
 * Returns true when an element's linked source content has changed since the
 * element was inserted or last relinked.
 */
export function isSourceStale(
  el: SourceRefCarrier,
  currentHash: string,
): boolean {
  const contentHash = el.source?.contentHash;
  /* node:coverage ignore next 7 -- Covered by deck-source-refs.test.ts; tsx maps this multiline boolean return as residual lines. */
  return (
    isSourceLinked(el) &&
    typeof contentHash === "string" &&
    contentHash !== currentHash
  );
}

/** Marks an element's source link as intentionally broken. */
export function unlinkSource<T extends SourceRefCarrier>(el: T): T {
  if (el.source === undefined || el.source.unlinked === true) {
    return el;
  }
  return {
    ...el,
    source: {
      ...cloneSourceRef(el.source),
      unlinked: true,
    },
  };
}

/** Replaces an element's source link with a fresh active reference. */
export function relinkSource<T extends SourceRefCarrier>(
  el: T,
  ref: SourceRef,
): T {
  return {
    ...el,
    source: activeSourceRef(ref),
  };
}
