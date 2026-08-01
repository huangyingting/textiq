import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import type {
  Deck,
  SlideChildNode,
  SlideNode,
} from "@/lib/presentation/schema";
import {
  buildDeck,
  buildImageNode,
  buildShapeNode,
  buildSlide,
  buildTableNode,
  buildTextNode,
  buildVisualNode,
} from "@/test/builders/presentation-deck";

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

function slideFixture(value: unknown): SlideNode {
  return value as unknown as SlideNode;
}

function slideChildFixture(value: unknown): SlideChildNode {
  return value as unknown as SlideChildNode;
}

function baseDeck(): Deck {
  const slide = slideFixture({
    id: "slide-a",
    type: "slide",
    template: { kind: "blank" },
    children: [textNode],
  });
  return {
    schemaVersion: 7,
    canvas: { format: "16:9", width: 16, height: 9, unit: "percent" },
    theme: { packageId: "neutral" },
    assets: { images: {} },
    slides: [slide],
  };
}

function noopSetter<T>(_value: T | ((current: T) => T)) {}

function richDeck(): Deck {
  return buildDeck([
    buildSlide(
      "content",
      [
        buildTextNode({ id: "text-a", role: "subtitle" }),
        buildShapeNode({ id: "shape-a" }),
        buildImageNode("img-001", { id: "image-a" }),
      ],
      {
        id: "slide-a",
        props: {
          deckChrome: {
            footer: { mode: "detached", nodeId: "shape-a" },
          },
        },
      },
    ),
    buildSlide("content", [buildTableNode({ id: "table-a" })], {
      id: "slide-b",
    }),
  ]);
}

function createCommandHarness(
  overrides: Partial<
    Parameters<typeof createInspectorCommandDescriptors>[0]
  > = {},
) {
  const deck = richDeck();
  const calls: Record<string, unknown[]> = {
    changes: [],
    announcements: [],
    focus: [],
    panels: [],
    source: [],
    repairs: [],
    reviewOpen: [],
  };
  const args = {
    deck,
    activeSlide: deck.slides[0],
    selectedResolvedNode: undefined,
    firstSelectedId: "text-a",
    selectedIds: ["text-a", "shape-a", "image-a"],
    onDeckChange: (next: Deck) => calls.changes.push(next),
    setSelection: noopSetter,
    setFocusedNodeId: noopSetter,
    setHoveredNodeId: noopSetter,
    setStageAnnouncement: (value: string | ((current: string) => string)) =>
      calls.announcements.push(
        typeof value === "function" ? value("current") : value,
      ),
    setActiveGroupId: noopSetter,
    setActiveSlideIndex: (value: number | ((current: number) => number)) =>
      calls.focus.push(typeof value === "function" ? value(0) : value),
    setDeckDiagnosticsReviewOpen: (
      value: boolean | ((current: boolean) => boolean),
    ) =>
      calls.reviewOpen.push(typeof value === "function" ? value(true) : value),
    setInspectorSheetOpen: noopSetter,
    requestImageRepair: (nodeId: string) => calls.repairs.push(nodeId),
    exitInlineEdit: () => calls.focus.push("exit-inline"),
    focusSelectedNodeSoon: (nodeId: string | undefined) =>
      calls.focus.push(nodeId),
    focusEditorRootSoon: () => calls.focus.push("editor-root"),
    requestInspectorPanel: (panel: string) => calls.panels.push(panel),
    replacementNodeAfterDelete: () => "shape-a",
    isMobileInspectorViewport: () => true,
    handleSelectSourceItem: (slideId: string, nodeId: string) =>
      calls.source.push(`select:${slideId}:${nodeId}`),
    handleRefreshSourceAt: (slideId: string, nodeId: string) =>
      calls.source.push(`refresh:${slideId}:${nodeId}`),
    handleUnlinkSourceAt: (slideId: string, nodeId: string) =>
      calls.source.push(`unlink:${slideId}:${nodeId}`),
    ...overrides,
  } satisfies Parameters<typeof createInspectorCommandDescriptors>[0];
  return {
    deck,
    calls,
    commands: createInspectorCommandDescriptors(args),
  };
}

function diagnostic(
  target: PresentationDiagnostic["target"],
): PresentationDiagnostic {
  return {
    code: "missing-asset",
    category: "asset",
    severity: "warning",
    target,
    message: "Needs attention",
  };
}

describe("inspector command descriptors", () => {
  test("derive style bindings outside the editor shell", () => {
    assert.deepEqual(defaultStyleBindingForNode(slideChildFixture(textNode)), {
      ref: "text.title",
    });
  });

  test("clamp inspector layout updates before dispatching editor commands", () => {
    const deck = baseDeck();
    let changed: Deck | undefined;
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

  test("derives default style bindings for all supported node kinds and text roles", () => {
    for (const [role, ref] of [
      ["title", "text.title"],
      ["subtitle", "text.subtitle"],
      ["kicker", "text.kicker"],
      ["caption", "text.caption"],
      ["quote", "text.quote"],
      ["metric", "text.metric"],
      ["body", "text.body"],
    ] as const) {
      assert.deepEqual(defaultStyleBindingForNode(buildTextNode({ role })), {
        ref,
      });
    }
    assert.deepEqual(defaultStyleBindingForNode(buildImageNode()), {
      ref: "media.inline",
    });
    assert.deepEqual(defaultStyleBindingForNode(buildVisualNode()), {
      ref: "chart.primary",
    });
    assert.deepEqual(
      defaultStyleBindingForNode({
        id: "connector-a",
        type: "connector",
        role: "connector",
        layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
        content: {
          from: { kind: "point", point: { x: 0, y: 0 } },
          to: { kind: "point", point: { x: 10, y: 10 } },
        },
      }),
      { ref: "connector.primary" },
    );
    assert.deepEqual(defaultStyleBindingForNode(buildTableNode()), {
      ref: "surface.table",
    });
    assert.deepEqual(defaultStyleBindingForNode(buildShapeNode()), {
      ref: "surface.card",
    });
  });

  test("routes slide, node, layer, and arrangement command handlers", () => {
    const { commands, calls } = createCommandHarness();

    commands.handleUpdateControls({ density: "dense" });
    commands.handleUpdateProps({
      deckChrome: { footer: { mode: "inherit" } },
    });
    commands.handleUpdateDeckChrome({ footer: { enabled: false } });
    commands.handleUpdateSlideAttributes({ name: "Renamed", notes: "Notes" });
    commands.handleUpdateSlideLocalStyle({
      slide: { background: { type: "solid", color: "#fff" } },
    });
    commands.handleResetSlideLocalStyle();
    commands.handleUpdateSlideSource(undefined);
    commands.handleChangeStyleBinding({ ref: "text.title" });
    commands.handleUpdateSelectedAttributes({ locked: true });
    commands.handleUpdateSelectedAttributes({ hidden: true });
    commands.handleUpdateSelectedContent({ paragraphs: [] });
    commands.handleResetToTheme();
    commands.handleUpdateSelectedLocalStyle({ text: { color: "#111" } });
    commands.handleUpdateSelectedSource(undefined);
    commands.handleSelectLayer("shape-a");
    commands.handleUpdateLayer("shape-a", { name: "Shape", hidden: false });
    commands.handleReorderLayer("shape-a", 0);
    commands.handleAlignSelection("left");
    commands.handleDistributeSelection("horizontal");
    commands.handleMatchSize("width");
    commands.handleReorderSelection("front");

    assert.ok(calls.changes.length >= 16);
    assert.ok(calls.announcements.includes("Selection locked"));
    assert.ok(calls.focus.includes("shape-a"));
  });

  test("navigates diagnostics and routes source diagnostic actions", () => {
    const { commands, calls } = createCommandHarness();

    commands.handleDiagnosticNavigate(
      diagnostic({ scope: "node", slideId: "slide-a", nodeId: "text-a" }),
    );
    commands.handleDiagnosticNavigate(
      diagnostic({ scope: "slide", slideId: "slide-b" }),
    );
    commands.handleDiagnosticNavigate(
      diagnostic({ scope: "slide", slideId: "missing" }),
    );

    commands.handleDiagnosticAction(
      {
        type: "open-source-review",
        target: { scope: "node", slideId: "slide-a", nodeId: "text-a" },
      },
      diagnostic({ scope: "deck" }),
    );
    commands.handleDiagnosticAction(
      {
        type: "refresh-source",
        target: { scope: "node", slideId: "slide-a", nodeId: "text-a" },
      },
      diagnostic({ scope: "deck" }),
    );
    commands.handleDiagnosticAction(
      {
        type: "unlink-source",
        target: { scope: "node", slideId: "slide-a", nodeId: "text-a" },
      },
      diagnostic({ scope: "deck" }),
    );
    commands.handleDiagnosticAction(
      {
        type: "relink-source",
        target: { scope: "node", slideId: "slide-a", nodeId: "text-a" },
      },
      diagnostic({ scope: "deck" }),
    );
    const noTargetHarness = createCommandHarness({
      activeSlide: undefined,
      firstSelectedId: undefined,
    });
    noTargetHarness.commands.handleDiagnosticAction(
      { type: "refresh-source", target: { scope: "deck" } },
      diagnostic({ scope: "deck" }),
    );

    assert.ok(calls.focus.includes("exit-inline"));
    assert.ok(calls.panels.includes("diagnostics"));
    assert.ok(calls.panels.includes("source"));
    assert.deepEqual(calls.source, [
      "select:slide-a:text-a",
      "refresh:slide-a:text-a",
      "unlink:slide-a:text-a",
      "select:slide-a:text-a",
    ]);
    assert.ok(
      calls.announcements.includes("Diagnostic target is no longer present."),
    );
    assert.ok(
      noTargetHarness.calls.announcements.includes(
        "Source diagnostic target is no longer present.",
      ),
    );
  });

  test("closes diagnostics review before opening an image asset repair", () => {
    const { commands, calls } = createCommandHarness();

    commands.handleDiagnosticAction(
      { type: "open-asset-panel" },
      diagnostic({
        scope: "node",
        slideId: "slide-a",
        nodeId: "image-a",
      }),
    );

    assert.deepEqual(calls.repairs, ["image-a"]);
    assert.deepEqual(calls.reviewOpen, [false]);
  });

  test("detaches deck chrome and theme decorations when selected", () => {
    const deck = richDeck();
    const chromeHarness = createCommandHarness({
      deck,
      activeSlide: deck.slides[0],
      selectedResolvedNode: {
        id: "chrome-footer",
        source: "deckChrome",
        chromeKind: "footer",
        layout: { frame: { x: 0, y: 0, w: 10, h: 10 } },
        style: {},
        content: { type: "shape", shape: "rect" },
      } as never,
    });
    chromeHarness.commands.handleDetachDecoration();
    assert.equal(chromeHarness.calls.changes.length, 1);

    const decorationHarness = createCommandHarness({
      deck,
      activeSlide: deck.slides[0],
      selectedResolvedNode: {
        id: "decoration-a",
        source: "themeDecoration",
        layout: {
          framePx: { x: 0, y: 0, w: 100, h: 20 },
          frame: { x: 0, y: 0, w: 20, h: 10 },
        },
        style: { fill: { type: "solid", color: "#fff" } },
        content: { type: "text", paragraphs: [] },
      } as never,
    });
    decorationHarness.commands.handleDetachDecoration();
    assert.equal(decorationHarness.calls.changes.length, 1);

    const ignoredHarness = createCommandHarness({
      selectedResolvedNode: {
        id: "node-a",
        source: "slide",
      } as never,
    });
    ignoredHarness.commands.handleDetachDecoration();
    assert.equal(ignoredHarness.calls.changes.length, 0);
  });
});
