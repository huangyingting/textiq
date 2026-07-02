import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Deck } from "./deck";
import { deckHistoryReducer, initDeckHistory } from "./use-deck-history";
import { validateImageFile } from "./image-element";
import { loadSlideFonts } from "./slide-font-loading";
import {
  deriveSlidePresencePayload,
  extractSlidePresencePeers,
  SLIDE_PRESENCE_AWARENESS_KEY,
  type SlidePresencePayload,
} from "@/lib/presentation-shared/use-slide-presence";

function deck(title = "Initial"): Deck {
  return {
    schemaVersion: 6,
    canvas: { format: "16:9" },
    design: { themeId: "default" },
    masters: [{ id: "master-default", name: "Default", elements: [] }],
    defaultMasterId: "master-default",
    slides: [{ id: "slide-1", index: 0, title, notes: "", elements: [] }],
  } as Deck;
}

describe("presentation hook owners", () => {
  it("deck history reducer applies imperative deck actions", () => {
    const initial = deck("Initial");
    const next = deck("Next");
    const committed = deckHistoryReducer(initDeckHistory(initial), {
      type: "commit",
      deck: next,
      coalesceKey: "drag:1",
    });
    const replaced = deckHistoryReducer(committed, {
      type: "replace",
      deck: initial,
    });
    const undone = deckHistoryReducer(replaced, { type: "undo" });
    const redone = deckHistoryReducer(undone, { type: "redo" });

    assert.equal(committed.present.slides[0]?.title, "Next");
    assert.equal(replaced.present.slides[0]?.title, "Initial");
    assert.equal(undone.present.slides[0]?.title, "Initial");
    assert.equal(redone.present.slides[0]?.title, "Initial");
  });

  it("image upload validation surfaces non-image errors", () => {
    const result = validateImageFile(
      new File(["not an image"], "notes.txt", { type: "text/plain" }),
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /image/i);
  });

  it("loadSlideFonts starts loading browser fonts", async () => {
    const originalDocument = globalThis.document;
    const loadedSpecs: string[] = [];
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        fonts: {
          load: (spec: string) => {
            loadedSpecs.push(spec);
            return Promise.resolve([]);
          },
          ready: Promise.resolve(),
        },
      },
    });

    try {
      await loadSlideFonts(["inter"]);
      assert.ok(loadedSpecs.length > 0);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  });

  it("slide presence derives local payload and extracts awareness peers", () => {
    const states = new Map<number, Record<string, unknown>>();
    const remotePayload: SlidePresencePayload = {
      documentId: "doc-1",
      userName: "Remote",
      userId: "remote-1",
      selectedSlideId: "slide-2",
      selectedNodeIds: ["el-1"],
      editingMode: "selecting",
    };
    states.set(7, { [SLIDE_PRESENCE_AWARENESS_KEY]: remotePayload });

    const local = deriveSlidePresencePayload({
      documentId: "doc-1",
      userName: "Local",
      userId: "local-1",
      selectedSlideId: "slide-1",
      selectedNodeIds: [],
      editingMode: "browsing",
    });
    const peers = extractSlidePresencePeers(states, 3, "doc-1");

    assert.equal(local.userName, "Local");
    assert.equal(local.selectedSlideId, "slide-1");
    assert.equal(peers.length, 1);
    assert.equal(peers[0]?.userName, "Remote");
  });
});
