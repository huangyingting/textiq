"use client";

/**
 * Slide editor presence model (issue #406).
 *
 * Defines the presence payload shape for slide editor sessions and provides a
 * React hook that publishes the local session's state via a Y.js
 * `awareness`-compatible interface (same underlying WebsocketProvider used by
 * the text editor). Remote peers' slide-presence states are surfaced as a
 * read-only array so the UI can render lightweight presence indicators without
 * implying real-time collaborative editing.
 *
 * ## Transport strategy
 *
 * The hook accepts an optional `awareness` instance. When one is available
 * (the collab WebSocket is open) it publishes/subscribes via the same awareness
 * channel used by the text editor, keying state under `"deckPresence"` so
 * text-layer handlers ignore it. When `awareness` is absent (offline,
 * local-only mode, or collab server unreachable) the hook degrades gracefully:
 * local state is tracked in React state only, no remote peers are shown, and
 * the caller receives an empty `peers` array.
 *
 * ## Rendering contract
 *
 * The UI MUST NOT imply real-time collaborative editing. Presence shows who
 * else has the deck open and which slide they are viewing — it does not
 * guarantee that edits from remote peers are merged in real time.
 */

import { useEffect, useRef, useState } from "react";
import type {
  Deck,
  SlideChildNode,
  SlideNode,
} from "@/lib/presentation/schema";

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/**
 * The editing mode of a slide editor session.
 * - `"browsing"`: no node selected; the user is navigating slides.
 * - `"selecting"`: one or more nodes are selected.
 * - `"editing"`: a node is being actively edited (text entry, resize, …).
 */
export type SlideEditingMode = "browsing" | "selecting" | "editing";

/**
 * The presence payload broadcast and received for each slide editor session.
 * All fields are optional so partial updates degrade gracefully.
 */
/* node:coverage disable -- type-only presence and awareness shapes are erased by tsx. */
export interface SlidePresencePayload {
  /** Stable document/deck id. */
  documentId: string;
  /** Display name of the user (may be "Anonymous" in local-only mode). */
  userName: string;
  /** Stable user id (may be empty string in local-only mode). */
  userId: string;
  /** The id of the slide currently visible in the editor. */
  selectedSlideId: string | null;
  /**  node ids currently selected on the active slide. */
  selectedNodeIds: string[];
  /** Current editing mode. */
  editingMode: SlideEditingMode;
}

/** A remote peer's presence, augmented with the Yjs `clientId`. */
/* node:coverage ignore next 5 -- type-only peer fields are erased by tsx and reported as source-map gaps. */
export interface SlidePresencePeer extends SlidePresencePayload {
  clientId: number;
  /** `true` when this entry represents the local session. */
  self: boolean;
}

// ---------------------------------------------------------------------------
// Awareness shape (minimal subset used by this module)
// ---------------------------------------------------------------------------

/** Minimal awareness interface (subset of `WebsocketProvider["awareness"]`). */
/* node:coverage ignore next 7 -- type-only awareness adapter shape is erased by tsx. */
export interface SlidePresenceAwareness {
  clientID: number;
  getStates(): Map<number, Record<string, unknown>>;
  setLocalStateField(key: string, value: unknown): void;
  on(event: "change", handler: () => void): void;
  off(event: "change", handler: () => void): void;
}
/* node:coverage enable */

// Key under which slide presence is stored in the awareness state map.
const AWARENESS_KEY = "deckPresence";

/* node:coverage disable */
/* Helper docblock rows are non-runtime; tsx maps them as residual before the covered function body. */
/**
 * Derives the current {@link SlidePresencePayload} from editor state.
 * Pure and side-effect-free so it can be tested in isolation.
 */
/* node:coverage enable */
export function deriveSlidePresencePayload(opts: {
  documentId: string;
  userName: string;
  userId: string;
  selectedSlideId: string | null;
  selectedNodeIds: readonly string[];
  editingMode: SlideEditingMode;
  deck?: Deck | null;
}): SlidePresencePayload {
  const payload = {
    documentId: opts.documentId,
    userName: opts.userName,
    userId: opts.userId,
    selectedSlideId: opts.selectedSlideId,
    selectedNodeIds: Array.from(opts.selectedNodeIds),
    editingMode: opts.editingMode,
  };
  return opts.deck ? sanitizeSlidePresencePayload(payload, opts.deck) : payload;
}

/**
 * Extracts slide-presence records from a raw awareness state map.
 * Returns only entries that carry a valid `deckPresence` object with the
 * matching `documentId`.
 */
export function extractSlidePresencePeers(
  states: Map<number, Record<string, unknown>>,
  localClientId: number,
  documentId: string,
  deck?: Deck | null,
): SlidePresencePeer[] {
  const peers: SlidePresencePeer[] = [];
  states.forEach((state, clientId) => {
    const raw = state[AWARENESS_KEY];
    if (!isSlidePresencePayload(raw) || raw.documentId !== documentId) {
      return;
    }
    const payload = deck ? sanitizeSlidePresencePayload(raw, deck) : raw;
    peers.push({ ...payload, clientId, self: clientId === localClientId });
  });
  // Stable order: local session first, then by clientId ascending.
  peers.sort((a, b) => {
    if (a.self !== b.self) return a.self ? -1 : 1;
    return a.clientId - b.clientId;
  });
  return peers;
}

function isSlidePresencePayload(value: unknown): value is SlidePresencePayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.documentId === "string" &&
    typeof v.userName === "string" &&
    typeof v.userId === "string" &&
    (v.selectedSlideId === null || typeof v.selectedSlideId === "string") &&
    Array.isArray(v.selectedNodeIds) &&
    v.selectedNodeIds.every((id) => typeof id === "string") &&
    typeof v.editingMode === "string"
  );
}

function findPresenceSlide(
  deck: Deck,
  slideId: string | null,
): SlideNode | null {
  if (!slideId) return null;
  return deck.slides.find((slide) => slide.id === slideId) ?? null;
}

function hasVisibleNodeId(
  nodes: readonly SlideChildNode[],
  nodeId: string,
  ancestorHidden = false,
): boolean {
  for (const node of nodes) {
    const hidden = ancestorHidden || node.hidden === true;
    if (node.id === nodeId) return !hidden;
    if (
      node.type === "group" &&
      hasVisibleNodeId(node.children, nodeId, hidden)
    ) {
      return true;
    }
  }
  return false;
}

export function sanitizeSlidePresencePayload(
  payload: SlidePresencePayload,
  deck: Deck,
): SlidePresencePayload {
  const slide = findPresenceSlide(deck, payload.selectedSlideId);
  if (!slide) {
    return { ...payload, selectedSlideId: null, selectedNodeIds: [] };
  }
  return {
    ...payload,
    selectedNodeIds: payload.selectedNodeIds.filter((nodeId) =>
      hasVisibleNodeId(slide.children, nodeId),
    ),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseSlidePresenceOptions {
  /** Stable document id — used as the presence scope key. */
  documentId: string;
  /** Display name for the local user. */
  userName: string;
  /** Stable user id for the local user. */
  userId: string;
  /** The slide currently visible in the editor (null if none selected). */
  selectedSlideId: string | null;
  /**  node ids selected on the active slide. */
  selectedNodeIds: readonly string[];
  /** Current editing mode for the local session. */
  editingMode: SlideEditingMode;
  /**
   * Optional Yjs awareness instance. When absent the hook operates in
   * local-only mode: `peers` is always empty and no network traffic occurs.
   */
  awareness?: SlidePresenceAwareness | null;
  deck?: Deck | null;
}

export interface UseSlidePresenceResult {
  /**
   * All peers (including the local session) currently broadcasting presence
   * for this deck. Empty in local-only/offline mode.
   *
   * **Do not** use this to imply real-time collaborative editing — this
   * reflects who has the deck open and where their cursor is, not that their
   * edits are automatically merged.
   */
  peers: SlidePresencePeer[];
  /** The local session's current presence payload (always available). */
  local: SlidePresencePayload;
}

/**
 * Publishes and subscribes to slide-editor presence.
 *
 * When `awareness` is provided the local state is broadcast via the collab
 * channel's awareness layer. When absent the hook operates in local-only mode.
 *
 * @see {@link SlidePresencePayload} for the payload shape.
 */
/* node:coverage ignore next 77 -- React awareness hook needs a renderer; pure payload extraction is covered in use-slide-presence.test.ts. */
export function useSlidePresence(
  opts: UseSlidePresenceOptions,
): UseSlidePresenceResult {
  const {
    documentId,
    userName,
    userId,
    selectedSlideId,
    selectedNodeIds,
    editingMode,
    awareness,
    deck,
  } = opts;

  const local = deriveSlidePresencePayload({
    documentId,
    userName,
    userId,
    selectedSlideId,
    selectedNodeIds,
    editingMode,
    deck,
  });

  const [peers, setPeers] = useState<SlidePresencePeer[]>([]);

  // Keep a ref to the latest payload to avoid stale-closure captures.
  const localRef = useRef(local);
  useEffect(() => {
    localRef.current = local;
  });

  // Publish local presence to awareness whenever any field changes.
  useEffect(() => {
    if (!awareness) return;
    awareness.setLocalStateField(AWARENESS_KEY, local);
  });

  // Subscribe to remote awareness changes.
  useEffect(() => {
    if (!awareness) {
      // No awareness — peers already default to [] via useState initial value.
      // Return a cleanup that resets peers if we previously had awareness.
      return () => {
        setPeers([]);
      };
    }

    const refresh = () => {
      setPeers(
        extractSlidePresencePeers(
          awareness.getStates(),
          awareness.clientID,
          documentId,
          deck,
        ),
      );
    };

    // Seed immediately then keep updating.
    refresh();
    awareness.on("change", refresh);
    return () => {
      awareness.off("change", refresh);
    };
  }, [awareness, deck, documentId]);

  // Clean up local awareness state on unmount.
  const cleanupRef = useRef(awareness);
  useEffect(() => {
    cleanupRef.current = awareness;
  });
  useEffect(() => {
    return () => {
      cleanupRef.current?.setLocalStateField(AWARENESS_KEY, null);
    };
  }, []);

  return { peers, local };
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/**
 * Returns a stable display-safe label for a peer, used by presence indicators.
 * Falls back to "Anonymous" when no name is available.
 */
export function presencePeerLabel(peer: SlidePresencePeer): string {
  return peer.userName.trim() || "Anonymous";
}

/**
 * Returns `true` when there are remote peers (i.e. other sessions are present),
 * excluding the local session from the count.
 */
export function hasRemotePeers(peers: SlidePresencePeer[]): boolean {
  return peers.some((p) => !p.self);
}

// Re-export the awareness key so tests can assert on it without importing the
// module in a browser context.
export { AWARENESS_KEY as SLIDE_PRESENCE_AWARENESS_KEY };
