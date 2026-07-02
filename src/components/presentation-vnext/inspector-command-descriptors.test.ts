import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { DeckV7, SlideNode } from "@/lib/presentation-vnext/schema";

import {
  createInspectorCommandDescriptors,
  defaultStyleBindingForNode,
} from "./inspector-command-descriptors";

const textNode = {
  id: "text-a",
  type: "text",
  role: "title",
  layout: { frame: { x: 10, y: 10, w: 20, h: 10 } },
  content: { paragraphs: [{ id: "p", text: "Hello" }] },
} as const;

function baseDeck(): DeckV7 {
  const slide = {
    id: "slide-a",
    type: "slide",
    template: { kind: "blank" },
    children: [textNode],
  } as unknown as SlideNode;
  return {
    schemaVersion: 7,
    canvas: { format: "16:9", width: 16, height: 9, unit: "percent" },
    theme: { packageId: "neutral" },
    assets: { images: {} },
    slides: [slide],
  };
}

function noopSetter<T>(_value: T | ((current: T) => T)) {}

describe("inspector command descriptors", () => {
  test("derive style bindings outside the editor shell", () => {
    assert.deepEqual(
      defaultStyleBindingForNode(
        textNode as unknown as import("@/lib/presentation-vnext/schema").SlideChildNode,
      ),
      {
        ref: "text.title",
      },
    );
  });

  test("clamp inspector layout updates before dispatching editor commands", () => {
    const deck = baseDeck();
    let changed: DeckV7 | undefined;
    const commands = createInspectorCommandDescriptors({
      deck,
      activeSlide: deck.slides[0],
      selectedResolvedNode: undefined,
      firstSelectedId: "text-a",
      selectedIds: ["text-a"],
      onDeckChange: (next) => {
        changed = next;
      },
      setSelection: noopSetter,
      setFocusedNodeId: noopSetter,
      setHoveredNodeId: noopSetter,
      setStageAnnouncement: noopSetter,
      setActiveGroupId: noopSetter,
      setActiveSlideIndex: noopSetter,
      setDeckDiagnosticsReviewOpen: noopSetter,
      setInspectorSheetOpen: noopSetter,
      requestImageRepair: () => undefined,
      exitInlineEdit: () => undefined,
      focusSelectedNodeSoon: () => undefined,
      focusEditorRootSoon: () => undefined,
      requestInspectorPanel: () => undefined,
      replacementNodeAfterDelete: () => undefined,
      isMobileInspectorViewport: () => false,
      handleSelectSourceItem: () => undefined,
      handleRefreshSourceAt: () => undefined,
      handleUnlinkSourceAt: () => undefined,
    });

    commands.handleUpdateSelectedLayout({
      frame: { x: -999, y: 999, w: 0, h: 999 },
      rotation: -10,
      zIndex: 1.8,
    });

    const updated = changed?.slides[0]?.children[0];
    assert.equal(updated?.layout?.zIndex, 1);
    assert.equal(updated?.layout?.rotation, 350);
    assert.deepEqual(updated?.layout?.frame, {
      x: -100,
      y: 200,
      w: 0.1,
      h: 300,
    });
  });
});
