import type { Provider, ProviderAwareness } from "@lexical/yjs";
import type { Doc } from "yjs";
import { WebsocketProvider } from "y-websocket";

type SyncListener = (isSynced: boolean) => void;
type StatusListener = (arg0: { status: string }) => void;
type UpdateListener = (arg0: unknown) => void;
type ReloadListener = (doc: Doc) => void;
type AwarenessUpdateListener = () => void;
type ProviderUserState = Exclude<
  ReturnType<ProviderAwareness["getLocalState"]>,
  null
>;

const toProviderUserState = (state: unknown): ProviderUserState => {
  const s: Record<string, unknown> =
    typeof state === "object" && state !== null
      ? (state as Record<string, unknown>)
      : {};
  return {
    ...s,
    anchorPos: (s["anchorPos"] ?? null) as ProviderUserState["anchorPos"],
    awarenessData:
      typeof s["awarenessData"] === "object" && s["awarenessData"] !== null
        ? (s["awarenessData"] as object)
        : {},
    color: typeof s["color"] === "string" ? s["color"] : "",
    focusPos: (s["focusPos"] ?? null) as ProviderUserState["focusPos"],
    focusing: Boolean(s["focusing"]),
    name: typeof s["name"] === "string" ? s["name"] : "",
  };
};

class LexicalAwarenessAdapter implements ProviderAwareness {
  private readonly updateListeners = new Map<
    AwarenessUpdateListener,
    (...args: unknown[]) => void
  >();

  constructor(private readonly awareness: WebsocketProvider["awareness"]) {}

  getLocalState(): ReturnType<ProviderAwareness["getLocalState"]> {
    const state = this.awareness.getLocalState();
    if (state === null) {
      return null;
    }
    return toProviderUserState(state);
  }

  getStates(): ReturnType<ProviderAwareness["getStates"]> {
    const states = new Map<number, ProviderUserState>();
    this.awareness.getStates().forEach((state, clientId) => {
      states.set(clientId, toProviderUserState(state));
    });
    return states;
  }

  setLocalState(arg0: ReturnType<ProviderAwareness["getLocalState"]>): void {
    this.awareness.setLocalState(arg0);
  }

  setLocalStateField(field: string, value: unknown): void {
    this.awareness.setLocalStateField(field, value);
  }

  on(...args: ["update", AwarenessUpdateListener]): void {
    const [, cb] = args;
    if (this.updateListeners.has(cb)) {
      return;
    }
    const wrapped = () => {
      cb();
    };
    this.updateListeners.set(cb, wrapped);
    this.awareness.on("update", wrapped);
  }

  off(...args: ["update", AwarenessUpdateListener]): void {
    const [, cb] = args;
    const wrapped = this.updateListeners.get(cb);
    if (!wrapped) {
      return;
    }
    this.awareness.off("update", wrapped);
    this.updateListeners.delete(cb);
  }

  dispose(): void {
    for (const wrapped of this.updateListeners.values()) {
      this.awareness.off("update", wrapped);
    }
    this.updateListeners.clear();
  }
}

export class LexicalWebsocketProviderAdapter implements Provider {
  readonly awareness: ProviderAwareness;

  private readonly reloadListeners = new Set<ReloadListener>();
  private readonly updateListeners = new Map<
    UpdateListener,
    (update: Uint8Array) => void
  >();

  constructor(
    readonly websocketProvider: WebsocketProvider,
    private readonly doc: Doc,
  ) {
    this.awareness = new LexicalAwarenessAdapter(websocketProvider.awareness);
  }

  connect(): void | Promise<void> {
    return this.websocketProvider.connect();
  }

  disconnect(): void {
    this.websocketProvider.disconnect();
  }

  on(...args: ["sync", SyncListener]): void;
  on(...args: ["status", StatusListener]): void;
  on(...args: ["update", UpdateListener]): void;
  on(...args: ["reload", ReloadListener]): void;
  on(
    ...args:
      | ["sync", SyncListener]
      | ["status", StatusListener]
      | ["update", UpdateListener]
      | ["reload", ReloadListener]
  ): void {
    const [type, cb] = args;
    if (type === "sync") {
      this.websocketProvider.on("sync", cb);
      return;
    }
    if (type === "status") {
      this.websocketProvider.on("status", cb);
      return;
    }
    if (type === "update") {
      if (this.updateListeners.has(cb)) {
        return;
      }
      const wrapped = (update: Uint8Array) => {
        cb(update);
      };
      this.updateListeners.set(cb, wrapped);
      this.doc.on("update", wrapped);
      return;
    }
    this.reloadListeners.add(cb);
  }

  off(...args: ["sync", SyncListener]): void;
  off(...args: ["status", StatusListener]): void;
  off(...args: ["update", UpdateListener]): void;
  off(...args: ["reload", ReloadListener]): void;
  off(
    ...args:
      | ["sync", SyncListener]
      | ["status", StatusListener]
      | ["update", UpdateListener]
      | ["reload", ReloadListener]
  ): void {
    const [type, cb] = args;
    if (type === "sync") {
      this.websocketProvider.off("sync", cb);
      return;
    }
    if (type === "status") {
      this.websocketProvider.off("status", cb);
      return;
    }
    if (type === "update") {
      const wrapped = this.updateListeners.get(cb);
      if (!wrapped) {
        return;
      }
      this.doc.off("update", wrapped);
      this.updateListeners.delete(cb);
      return;
    }
    this.reloadListeners.delete(cb);
  }

  dispose(): void {
    for (const wrapped of this.updateListeners.values()) {
      this.doc.off("update", wrapped);
    }
    this.updateListeners.clear();
    if (this.awareness instanceof LexicalAwarenessAdapter) {
      this.awareness.dispose();
    }
    this.reloadListeners.clear();
  }
}

export function createLexicalWebsocketProviderAdapter(
  websocketProvider: WebsocketProvider,
  doc: Doc,
): LexicalWebsocketProviderAdapter {
  return new LexicalWebsocketProviderAdapter(websocketProvider, doc);
}

export function isLexicalWebsocketProviderAdapter(
  provider: Provider,
): provider is LexicalWebsocketProviderAdapter {
  return provider instanceof LexicalWebsocketProviderAdapter;
}
