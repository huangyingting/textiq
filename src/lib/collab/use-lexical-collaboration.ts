"use client";

import type { Provider } from "@lexical/yjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import type { CollabStatus, Peer } from "./use-collaboration";
import { createLexicalWebsocketProviderAdapter } from "./lexical-provider-adapter";
import { colorFromId } from "./y-text";
import { resolveCollabWsUrl } from "./ws-url";

/** Falls back to ready (local-only) mode if the server never syncs. */
const DEGRADED_TIMEOUT_MS = 2500;

/**
 * Transaction origins for the collaborative title `Y.Text`. The document body is
 * bound by `@lexical/yjs`, but the title is a plain shared text bound via
 * `useYText`, which classifies changes by transaction origin.
 */
const TITLE_LOCAL_ORIGIN = Symbol("textiq-lexical-title-local");
const TITLE_SEED_ORIGIN = Symbol("textiq-lexical-title-seed");

type Awareness = WebsocketProvider["awareness"];

/**
 * Lexical's `@lexical/yjs` binding stores presence at the top level of each
 * awareness state (`{ name, color, ... }`), unlike our textarea binding which
 * nested it under `user`. Read peers from that shape.
 */
function computePeers(awareness: Awareness): Peer[] {
  const self = awareness.clientID;
  const peers: Peer[] = [];
  awareness.getStates().forEach((state, clientId) => {
    const s = state as { name?: string; color?: string };
    if (typeof s.name === "string") {
      peers.push({
        clientId,
        name: s.name,
        color: s.color ?? colorFromId(clientId),
        self: clientId === self,
      });
    }
  });
  // Stable order: self first, then by join order (clientId).
  peers.sort((a, b) => {
    if (a.self !== b.self) {
      return a.self ? -1 : 1;
    }
    return a.clientId - b.clientId;
  });
  return peers;
}

export type LexicalCollaboration = {
  /** Factory the `CollaborationPlugin` calls to obtain the Yjs provider. */
  providerFactory: (id: string, yjsDocMap: Map<string, Y.Doc>) => Provider;
  status: CollabStatus;
  /** True once the initial server sync (or degraded fallback) has happened. */
  ready: boolean;
  /** True once the collab server has actually synced this room at least once. */
  synced: boolean;
  /**
   * True when the collab server never synced within the timeout, so the editor
   * is running local-only. In this mode the `CollaborationPlugin` never fires
   * its DB bootstrap (which is gated on the provider `sync` event), so the
   * editor must be seeded from the database directly.
   */
  degraded: boolean;
  peers: Peer[];
  /** Shared awareness channel used by the document and slide-editor presence. */
  awareness: Awareness;
  /** This client's presence/cursor color. */
  cursorColor: string;
  /** Shared title text, bound to the editor's title input via `useYText`. */
  ytitle: Y.Text;
  /** Transaction origin for local title edits (vs. remote/seed). */
  localOrigin: symbol;
  /** Seeds the title from the database once, guarded so peers don't double-seed. */
  seedTitle: (title: string) => void;
};

/**
 * Owns a `y-websocket` provider for one document "room" and exposes everything
 * the Lexical `CollaborationPlugin` and the presence UI need. The provider is
 * created with `connect: false` so the plugin drives `connect()`/`disconnect()`;
 * we keep it for status, the ready gate, and presence.
 */
export function useLexicalCollaboration(opts: {
  room: string;
  userName: string;
}): LexicalCollaboration {
  const { room } = opts;

  // Created once per mount. `connect: false` keeps construction SSR-safe (no
  // socket/BroadcastChannel) and lets the CollaborationPlugin own connection.
  const [doc] = useState(() => new Y.Doc());
  const ytitle = doc.getText("title");
  const [provider] = useState(() => {
    const wsUrl = resolveCollabWsUrl();
    return new WebsocketProvider(wsUrl, room, doc, { connect: false });
  });
  const [lexicalProvider] = useState(() =>
    createLexicalWebsocketProviderAdapter(provider, doc),
  );

  const [status, setStatus] = useState<CollabStatus>("connecting");
  const [synced, setSynced] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    const awareness = provider.awareness;

    const onStatus = (event: { status: CollabStatus }) => {
      setStatus(event.status);
    };
    const onSync = (isSynced: boolean) => {
      if (isSynced) {
        setSynced(true);
      }
    };
    const onAwareness = () => {
      setPeers(computePeers(awareness));
    };

    provider.on("status", onStatus);
    provider.on("sync", onSync);
    awareness.on("change", onAwareness);

    const degradeTimer = setTimeout(
      () => setDegraded(true),
      DEGRADED_TIMEOUT_MS,
    );

    return () => {
      clearTimeout(degradeTimer);
      provider.off("status", onStatus);
      provider.off("sync", onSync);
      awareness.off("change", onAwareness);
    };
  }, [provider]);

  // The plugin only disconnects on unmount; fully tear down the provider/doc.
  useEffect(() => {
    return () => {
      lexicalProvider.dispose();
      provider.destroy();
      doc.destroy();
    };
  }, [doc, lexicalProvider, provider]);

  const providerFactory = useCallback(
    (id: string, yjsDocMap: Map<string, Y.Doc>) => {
      if (!yjsDocMap.has(id)) {
        yjsDocMap.set(id, doc);
      }
      return lexicalProvider;
    },
    [doc, lexicalProvider],
  );

  const cursorColor = colorFromId(provider.awareness.clientID);
  const ready = synced || degraded;

  // Seed the title into the shared text from the database (the durable source of
  // truth) whenever the shared title is empty. The `ytitle.length === 0` guard
  // alone prevents clobbering a populated (collaboratively edited) title, so a
  // peer joining a room that already has a title never re-inserts it.
  //
  // We deliberately do NOT gate this behind a persistent `meta.titleSeeded`
  // latch: an in-memory collab room can outlive its title (e.g. it was created
  // before the title synced, or the title was transiently cleared), and a
  // one-way "seeded" latch would then strand the field on the empty "Untitled"
  // placeholder forever even though the database holds the real title. Re-seeding
  // an empty room from the DB also self-heals such rooms for every collaborator.
  const seededTitleRef = useRef(false);
  const seedTitle = useCallback(
    (title: string) => {
      if (seededTitleRef.current) {
        return;
      }
      seededTitleRef.current = true;
      if (ytitle.length === 0 && title) {
        doc.transact(() => {
          // Re-check inside the transaction in case a concurrent sync populated
          // the title between the guard above and this write.
          if (ytitle.length === 0) {
            ytitle.insert(0, title);
          }
        }, TITLE_SEED_ORIGIN);
      }
    },
    [doc, ytitle],
  );

  return {
    providerFactory,
    status,
    ready,
    synced,
    degraded,
    peers,
    awareness: provider.awareness,
    cursorColor,
    ytitle,
    localOrigin: TITLE_LOCAL_ORIGIN,
    seedTitle,
  };
}
