import assert from "node:assert/strict";
import { test } from "node:test";
import React, {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  buildImageNode,
  buildShapeNode,
  buildSlide,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import type { SourceBlockIndexEntry } from "@/lib/presentation/block-index";
import type { NodeSourceMetadata, SlideNode } from "@/lib/presentation/schema";
import type { SourceLinkClassification } from "@/lib/presentation/source-links";
import type { StyleBinding, StylePatch } from "@/lib/presentation/style-schema";
import { currentObjectReorderCommandDescriptor } from "@/lib/presentation/current-object-command-descriptors";

import { InspectorShell, type InspectorShellProps } from "./inspector-shell";
import {
  NodeSourcePanel,
  sourceStatus,
  sourceWithPatch,
} from "./node-source-panel";

type ElementLike = ReactElement<Record<string, unknown>>;

type Recorder = ReturnType<typeof createRecorder>;

const functionComponentsToResolve = new Set([
  "InspectorShell",
  "PanelSection",
  "NotesPanel",
  "DecorationPanel",
  "ActionButton",
  "InspectorPanelSelect",
  "MultiArrangePanel",
  "SingleArrangePanel",
  "RangeField",
  "NumberField",
  "AdjustPanel",
  "EffectsPanel",
  "LocalOverrideBadge",
  "NodeContentPanel",
  "LocalStylePanel",
  "NodeGeometryPanel",
  "NodeSourcePanel",
  "StyleBindingPanel",
  "LayersPanel",
  "DiagnosticsPanel",
  "DeckChromePanel",
  "SlideControlsPanel",
  "SlideSettingsPanel",
]);

function withFakeReact<T>(
  options: { states?: unknown[] } = {},
  callback: (setters: unknown[]) => T,
): T {
  const original = {
    useId: React.useId,
    useMemo: React.useMemo,
    useState: React.useState,
  };
  let stateIndex = 0;
  let idIndex = 0;
  const setters: unknown[] = [];
  Object.assign(React, {
    useId: () => `final-inspector-${++idIndex}`,
    useMemo: <TValue>(factory: () => TValue) => factory(),
    useState: (initial: unknown) => {
      const index = stateIndex;
      stateIndex += 1;
      const value =
        index < (options.states?.length ?? 0)
          ? options.states?.[index]
          : typeof initial === "function"
            ? (initial as () => unknown)()
            : initial;
      const setter = (next: unknown) =>
        setters.push(typeof next === "function" ? next(value) : next);
      return [value, setter];
    },
  });
  try {
    return callback(setters);
  } finally {
    Object.assign(React, original);
  }
}

function resolveKnown(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(resolveKnown);
  if (!isValidElement(node)) return node;
  const element = node as ElementLike;
  const type = element.type;
  if (
    typeof type === "function" &&
    functionComponentsToResolve.has(type.name)
  ) {
    return resolveKnown((type as (props: unknown) => ReactNode)(element.props));
  }
  const children = resolveKnown(element.props.children as ReactNode);
  return React.cloneElement(element, undefined, children);
}

function walk(node: ReactNode, visit: (element: ElementLike) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isValidElement(node)) return;
  const element = node as ElementLike;
  visit(element);
  walk(element.props.children as ReactNode, visit);
  walk(element.props.trigger as ReactNode, visit);
}

function findAll(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
): ElementLike[] {
  const matches: ElementLike[] = [];
  walk(node, (element) => {
    if (predicate(element)) matches.push(element);
  });
  return matches;
}

function textContent(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement(node)) {
    return textContent((node as ElementLike).props.children as ReactNode);
  }
  return "";
}

function changeEvent(value: string, checked = false) {
  return { currentTarget: { value, checked } };
}

function createRecorder() {
  return {
    controls: [] as unknown[],
    props: [] as unknown[],
    deckChrome: [] as unknown[],
    slideAttributes: [] as Array<{ name?: string; notes?: string }>,
    slideStyle: [] as StylePatch[],
    slideSource: [] as Array<NodeSourceMetadata | undefined>,
    layout: [] as Record<string, unknown>[],
    attributes: [] as Array<{ locked?: boolean; hidden?: boolean }>,
    content: [] as Record<string, unknown>[],
    localStyle: [] as StylePatch[],
    source: [] as Array<NodeSourceMetadata | undefined>,
    bindings: [] as StyleBinding[],
    align: [] as string[],
    distribute: [] as string[],
    matchSize: [] as string[],
    actions: [] as string[],
    selectedLayers: [] as string[],
    layerUpdates: [] as unknown[],
    layerMoves: [] as unknown[],
    diagnostics: [] as unknown[],
    relink: [] as SourceBlockIndexEntry[],
  };
}

function sourceBlock(id: string): SourceBlockIndexEntry {
  return {
    documentId: "doc-1",
    id,
    kind: "text",
    hash: `hash-${id}`,
    revision: `rev-${id}`,
    displayLabel: `Block ${id}`,
    refresh: { kind: "text", text: `Text ${id}` },
  };
}

const textNode = buildTextNode({
  id: "text-1",
  name: "Named text",
  source: {
    documentId: "doc-1",
    blockId: "block-1",
    blockKind: "text",
    contentHash: "old-hash",
    linkedAt: "2026-06-30T00:00:00.000Z",
    display: { blockLabel: "Body block" },
  },
  localStyle: { text: { color: "#111111", fontSizePt: 18 } },
});
const imageNode = buildImageNode("asset-1", {
  id: "image-1",
  content: {
    assetId: "asset-1",
    fit: "contain",
    crop: { top: 1, right: 2, bottom: 3, left: 4 },
  },
  localStyle: {
    opacity: 0.75,
    image: { brightness: 1.1, contrast: 0.9, saturation: 1.2 },
    effect: { kind: "blur", radiusPt: 5 },
    shadow: { xPt: 1, yPt: 2, blurPt: 3, color: "#000000", opacity: 0.2 },
  },
});
const glowShape = buildShapeNode({
  id: "shape-1",
  content: { shape: "rect" },
  localStyle: {
    effect: { kind: "glow", color: "#4f46e5", blurPt: 14, opacity: 0.35 },
    shadow: { xPt: 2, yPt: 4, blurPt: 10, color: "#111111", opacity: 0.2 },
    blendMode: "multiply",
  },
});

const slide: SlideNode = buildSlide("cover", [textNode, imageNode, glowShape], {
  id: "slide-1",
  name: "Coverage slide",
  notes: "Initial notes",
  controls: { tone: "confident", density: "normal", emphasis: "visual" },
  props: { decoration: "subtle", chrome: "minimal" },
  localStyle: { slide: { background: { type: "solid", color: "#ffffff" } } },
  source: { documentId: "doc-1", blockId: "slide-block" },
});

function propsFor(
  recorder: Recorder,
  overrides: Partial<InspectorShellProps> = {},
): InspectorShellProps {
  return {
    activeSlide: slide,
    deckChrome: { footer: { enabled: true } },
    selectedNode: undefined,
    selectedResolvedStyle: undefined,
    selectedIds: [],
    isDecorationSelected: false,
    selectedGeneratedSource: undefined,
    diagnostics: [],
    layerDecorations: [],
    layerChrome: [],
    onUpdateControls: (patch) => recorder.controls.push(patch),
    onUpdateProps: (patch) => recorder.props.push(patch),
    onUpdateDeckChrome: (patch) => recorder.deckChrome.push(patch),
    onUpdateSlideAttributes: (patch) => recorder.slideAttributes.push(patch),
    onUpdateSlideLocalStyle: (patch) => recorder.slideStyle.push(patch),
    onResetSlideLocalStyle: () => recorder.actions.push("reset-slide"),
    onUpdateSlideSource: (source) => recorder.slideSource.push(source),
    onUploadSlideBackgroundImage: () => recorder.actions.push("upload-bg"),
    onUpdateSelectedLayout: (patch) => recorder.layout.push(patch),
    onUpdateSelectedAttributes: (patch) => recorder.attributes.push(patch),
    onUpdateSelectedContent: (patch) => recorder.content.push(patch),
    onUpdateSelectedLocalStyle: (patch) => recorder.localStyle.push(patch),
    assetResolver: (assetId) => `https://example.test/${assetId}.png`,
    onReplaceImage: () => recorder.actions.push("replace-image"),
    onReplaceVisual: () => recorder.actions.push("replace-visual"),
    onResetToTheme: () => recorder.actions.push("reset-theme"),
    onUpdateSelectedSource: (source) => recorder.source.push(source),
    onRefreshSelectedSource: () => recorder.actions.push("refresh-source"),
    onUnlinkSelectedSource: () => recorder.actions.push("unlink-source"),
    onRelinkSelectedSource: (block) => recorder.relink.push(block),
    selectedSourceClassification: undefined,
    sourceBlocks: [],
    onChangeStyleBinding: (binding) => recorder.bindings.push(binding),
    onAlignSelection: (mode) => recorder.align.push(mode),
    onDistributeSelection: (mode) => recorder.distribute.push(mode),
    onMatchSize: (mode) => recorder.matchSize.push(mode),
    onGroupSelection: () => recorder.actions.push("group"),
    onUngroupSelection: () => recorder.actions.push("ungroup"),
    onReorderSelection: (kind) => recorder.actions.push(`reorder-${kind}`),
    onSelectLayer: (nodeId) => recorder.selectedLayers.push(nodeId),
    onUpdateLayer: (...args) => recorder.layerUpdates.push(args),
    onReorderLayer: (...args) => recorder.layerMoves.push(args),
    onDetachDecoration: () => recorder.actions.push("detach"),
    onDiagnosticAction: (...args) => recorder.diagnostics.push(args),
    TEMPLATE_OPTIONS: [
      { kind: "cover", label: "Cover" },
      { kind: "section", label: "Section" },
    ],
    activeTemplate: { layouts: [{ id: "default" }, { id: "wide" }] },
    activeLayoutId: "default",
    onReapplyTemplate: (kind, layoutId) =>
      recorder.actions.push(`template-${kind}-${layoutId ?? "default"}`),
    selectionMode: "normal",
    onToggleSelectionMode: () => recorder.actions.push("toggle-layers"),
    initialPanel: undefined,
    ...overrides,
  };
}

function renderInspector(
  recorder: Recorder,
  overrides: Partial<InspectorShellProps>,
) {
  return withFakeReact({}, () =>
    resolveKnown(InspectorShell(propsFor(recorder, overrides))),
  );
}

function clickButtons(tree: ReactNode, labels: readonly string[]) {
  for (const label of labels) {
    const button = findAll(
      tree,
      (element) => element.type === "button" && textContent(element) === label,
    )[0];
    assert.ok(button, `missing button ${label}`);
    (button.props.onClick as () => void)();
  }
}

test("InspectorShell final panel select, notes, decoration, and fallback panels call safe handlers", () => {
  const recorder = createRecorder();
  const notes = renderInspector(recorder, { initialPanel: "notes" });
  const textarea = findAll(notes, (element) => element.type === "textarea")[0];
  (textarea.props.onChange as (event: unknown) => void)(
    changeEvent("Updated notes"),
  );
  const panelSelect = findAll(
    notes,
    (element) =>
      element.type === "select" &&
      element.props["aria-label"] === "Inspector panel",
  )[0];
  (panelSelect.props.onChange as (event: unknown) => void)({
    currentTarget: { value: "layers" },
  });

  const fallback = renderInspector(recorder, {
    selectedNode: textNode,
    selectedIds: [textNode.id],
    initialPanel: "image",
  });
  assert.equal(textContent(fallback).includes("Content"), true);

  const decoration = renderInspector(recorder, {
    selectedNode: glowShape,
    selectedIds: [glowShape.id],
    isDecorationSelected: true,
    selectedGeneratedSource: "deckChrome",
    initialPanel: "decoration",
  });
  assert.equal(textContent(decoration).includes("Deck Chrome"), true);
  clickButtons(decoration, ["Detach from deck chrome"]);

  assert.deepEqual(recorder.slideAttributes, [{ notes: "Updated notes" }]);
  assert.ok(recorder.actions.includes("toggle-layers"));
  assert.ok(recorder.actions.includes("detach"));
});

test("InspectorShell final arrange panels exercise align, distribute, match size, and reorder actions", () => {
  const recorder = createRecorder();
  const reorderModes = ["front", "back", "forward", "backward"] as const;
  const multi = renderInspector(recorder, {
    selectedNode: textNode,
    selectedIds: ["text-1", "image-1", "shape-1"],
    initialPanel: "arrange",
  });
  clickButtons(multi, [
    "Left",
    "Center",
    "Right",
    "Top",
    "Middle",
    "Bottom",
    "Distribute H",
    "Distribute V",
    "Match width",
    "Match height",
    "Match both",
    "Group",
    "Ungroup",
    ...reorderModes.map(
      (mode) => currentObjectReorderCommandDescriptor(mode).shortLabel,
    ),
  ]);

  const disabledMulti = renderInspector(recorder, {
    selectedNode: textNode,
    selectedIds: ["text-1", "image-1"],
    initialPanel: "arrange",
  });
  const distributeH = findAll(
    disabledMulti,
    (element) =>
      element.type === "button" && textContent(element) === "Distribute H",
  )[0];
  assert.equal(distributeH.props.disabled, true);

  const single = renderInspector(recorder, {
    selectedNode: textNode,
    selectedIds: [textNode.id],
    initialPanel: "arrange",
  });
  clickButtons(
    single,
    reorderModes.map(
      (mode) =>
        currentObjectReorderCommandDescriptor(mode).inspectorSingleLabel,
    ),
  );

  assert.deepEqual(recorder.align.slice(0, 6), [
    "left",
    "center",
    "right",
    "top",
    "middle",
    "bottom",
  ]);
  assert.deepEqual(recorder.distribute, ["horizontal", "vertical"]);
  assert.deepEqual(recorder.matchSize, ["width", "height", "both"]);
  assert.ok(recorder.actions.includes("group"));
  assert.ok(recorder.actions.includes("reorder-front"));
  assert.ok(recorder.actions.includes("reorder-backward"));
});

test("InspectorShell final adjust and effects panels emit image and style patches", () => {
  const recorder = createRecorder();
  const adjust = renderInspector(recorder, {
    selectedNode: imageNode,
    selectedIds: [imageNode.id],
    initialPanel: "adjust",
  });
  const fit = findAll(
    adjust,
    (element) =>
      element.type === "select" &&
      element.props["aria-label"] !== "Inspector panel",
  )[0];
  (fit.props.onChange as (event: unknown) => void)(changeEvent("fill"));
  for (const input of findAll(adjust, (element) => element.type === "input")) {
    if (input.props.type === "range" || input.props.type === "number") {
      (input.props.onChange as (event: unknown) => void)(changeEvent("8"));
    }
  }
  clickButtons(adjust, ["Reset crop", "Reset adjustments"]);

  const glowEffects = renderInspector(recorder, {
    selectedNode: glowShape,
    selectedIds: [glowShape.id],
    initialPanel: "effects",
  });
  const selects = findAll(
    glowEffects,
    (element) =>
      element.type === "select" &&
      element.props["aria-label"] !== "Inspector panel",
  );
  const effectSelect = selects[0];
  for (const value of ["blur", "glow", "glass", "none"]) {
    (effectSelect.props.onChange as (event: unknown) => void)(
      changeEvent(value),
    );
  }
  (selects[1].props.onChange as (event: unknown) => void)(
    changeEvent("screen"),
  );
  for (const input of findAll(
    glowEffects,
    (element) => element.type === "input",
  )) {
    if (input.props.type === "checkbox") {
      (input.props.onChange as (event: unknown) => void)(
        changeEvent("", false),
      );
      (input.props.onChange as (event: unknown) => void)(changeEvent("", true));
    } else if (input.props.type === "number") {
      (input.props.onChange as (event: unknown) => void)(changeEvent("11"));
    } else if (input.props.type === "color") {
      (input.props.onChange as (event: unknown) => void)(
        changeEvent("#abcdef"),
      );
    } else if (input.props.type === "range") {
      (input.props.onChange as (event: unknown) => void)(changeEvent("0.5"));
    }
  }
  clickButtons(glowEffects, ["Reset to theme"]);

  const noImageAdjust = renderInspector(recorder, {
    selectedNode: textNode,
    selectedIds: [textNode.id],
    initialPanel: "adjust",
  });
  assert.equal(
    textContent(noImageAdjust).includes(
      "Image adjustment controls are available",
    ),
    false,
  );

  assert.ok(recorder.content.some((patch) => patch.fit === "fill"));
  assert.ok(recorder.content.some((patch) => "crop" in patch));
  assert.ok(recorder.localStyle.some((patch) => patch.opacity !== undefined));
  assert.ok(
    recorder.localStyle.some(
      (patch) => patch.effect !== undefined || patch.shadow !== undefined,
    ),
  );
  assert.ok(recorder.actions.includes("reset-theme"));
});

test("NodeSourcePanel final statuses and relink controls cover source branches", () => {
  const recorder = createRecorder();
  const source: NodeSourceMetadata = {
    documentId: "doc-1",
    blockId: "block-1",
    blockKind: "text",
    contentHash: "old-hash",
    blockRevision: "rev-1",
    linkedAt: "2026-06-30T00:00:00.000Z",
    display: { blockLabel: "Original block" },
    refresh: { state: "stale", checkedAt: "2026-06-30T00:00:00.000Z" },
    extra: { note: "kept" },
  };
  const classification: SourceLinkClassification = {
    slideId: "slide-1",
    slideIndex: 0,
    nodeId: textNode.id,
    nodeType: textNode.type,
    source,
    state: "stale",
    reason: "Hash changed",
    block: sourceBlock("block-2"),
    sourceHash: "old-hash",
    currentHash: "new-hash",
  };
  const blocks = Array.from({ length: 10 }, (_, index) =>
    sourceBlock(`${index}`),
  );

  const panel = resolveKnown(
    NodeSourcePanel({
      node: { ...textNode, source },
      classification,
      availableBlocks: blocks,
      onUpdateSource: (next) => recorder.source.push(next),
      onRefreshSource: () => recorder.actions.push("refresh"),
      onUnlinkSource: () => recorder.actions.push("unlink"),
      onRelinkSource: (block) => recorder.relink.push(block),
    }),
  );

  const inputs = findAll(panel, (element) => element.type === "input");
  (inputs[0].props.onChange as (event: unknown) => void)(changeEvent("doc-2"));
  (inputs[1].props.onChange as (event: unknown) => void)(
    changeEvent("block-3"),
  );
  (inputs[2].props.onChange as (event: unknown) => void)(changeEvent("", true));
  const kindSelect = findAll(panel, (element) => element.type === "select")[0];
  (kindSelect.props.onChange as (event: unknown) => void)(changeEvent("image"));
  clickButtons(panel, [
    "Mark updated",
    "Update from document",
    "Unlink",
    "Relink to first local block",
    "Clear source",
  ]);
  const relinkChoice = findAll(
    panel,
    (element) =>
      element.type === "button" && textContent(element).includes("Block 1"),
  )[0];
  (relinkChoice.props.onClick as () => void)();

  const standalone = resolveKnown(
    NodeSourcePanel({
      node: { ...textNode, source: undefined },
      onUpdateSource: (next) => recorder.source.push(next),
    }),
  );
  const disabledButtons = findAll(
    standalone,
    (element) => element.type === "button" && element.props.disabled === true,
  );
  assert.ok(disabledButtons.length >= 3);

  const unlinkedPanel = resolveKnown(
    NodeSourcePanel({
      node: { ...textNode, source: { ...source, unlinked: true } },
      onUpdateSource: (next) => recorder.source.push(next),
    }),
  );
  const unlinkDisabled = findAll(
    unlinkedPanel,
    (element) => element.type === "button" && textContent(element) === "Unlink",
  )[0];
  assert.equal(unlinkDisabled.props.disabled, true);

  assert.equal(sourceStatus(undefined), "Standalone");
  assert.equal(sourceStatus({ documentId: "", blockId: "" }), "Draft link");
  assert.equal(sourceStatus({ ...source, unlinked: true }), "Unlinked");
  assert.equal(
    sourceStatus(source, { ...classification, state: "fresh" }),
    "Fresh",
  );
  assert.equal(
    sourceStatus(source, { ...classification, state: "orphan" }),
    "Orphaned",
  );
  assert.equal(
    sourceStatus(source, { ...classification, state: "unknown" }),
    "Unknown",
  );
  assert.equal(
    sourceStatus(source, { ...classification, state: "unlinked" }),
    "Unlinked",
  );
  assert.equal(
    sourceStatus(source, { ...classification, dismissed: true }),
    "Dismissed",
  );
  assert.equal(
    sourceWithPatch(undefined, { documentId: "new" }).documentId,
    "new",
  );
  assert.ok(recorder.actions.includes("refresh"));
  assert.ok(recorder.actions.includes("unlink"));
  assert.ok(recorder.relink.length >= 2);
  assert.ok(recorder.source.some((entry) => entry === undefined));
  assert.ok(recorder.source.some((entry) => entry?.documentId === "doc-2"));
});
