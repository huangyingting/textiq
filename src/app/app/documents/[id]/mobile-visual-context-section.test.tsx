/**
 * Direct behavior coverage for `VisualContextSection` (#1959).
 *
 * Mounted with a real `@lexical/headless` editor + `LexicalComposerContext`
 * + the real `EditorContextProvider` + the real `VisualPanelProvider` (the
 * same providers `lexical-editor.tsx` composes it with in production), this
 * exercises the component's own composition/derivation/callback-wiring logic
 * directly: `panelState`'s `registerUpdateListener`-driven read (including
 * the previous-sibling `currentSourceText` gate), the `activeVisual`
 * (`VisualCard`-driven) and `ctx.selectedVisualNodeKey` (selection-driven)
 * paths that both resolve `nodeKey`/`visualId` in production, and the real
 * `updateVisual`/`handleCommand`/`removeVisual`/`applyBrandToAll`/
 * `getSvgElement`/`handleClose` callbacks against a real Lexical node graph
 * (`applyVisualCommand`, `applyElasticLayout`, and `applyBrand` all run for
 * real — none of that logic is faked here).
 *
 * `./visual-context-popover` (a 1918-line sibling with no test file of its
 * own, and out of scope for #1959) is stubbed via the `node:module`
 * `registerHooks` pattern established by `trash/page.test.tsx`: the stub is a
 * trivial prop-recording component so this file only asserts what
 * `VisualContextSection` itself computes and passes down — not the
 * popover's internals. `@/components/editor/visual-svg-registry` and
 * `./visual-panel-context` run for real (both are small, dependency-free).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, before, beforeEach, test } from "node:test";
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { createHeadlessEditor } from "@lexical/headless";
import {
  createLexicalComposerContext,
  LexicalComposerContext,
  type LexicalComposerContextWithEditor,
} from "@lexical/react/LexicalComposerContext";
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $setSelection,
  type LexicalEditor,
} from "lexical";

import {
  useRegisterVisualSvg,
  VisualSvgRegistryProvider,
} from "@/components/editor/visual-svg-registry";
import { EditorContextProvider } from "@/lib/lexical/editor-context";
import {
  $createVisualNode,
  $isVisualNode,
  VisualNode,
} from "@/lib/lexical/visual-node";
import { FIXTURES } from "@/lib/visual/fixtures";

// Side effect only: flips on `IS_REACT_ACT_ENVIRONMENT`; also installs the
// baseline `document`/`window` stubs `EditorContextProvider`'s effect needs,
// persistently for this file's lifetime.
import { installPersistentDefaultDom } from "@/test/react-render-harness";

import { useVisualPanel, VisualPanelProvider } from "./visual-panel-context";

installPersistentDefaultDom();

type ModuleHooks = {
  registerHooks(hooks: {
    resolve(
      specifier: string,
      context: unknown,
      nextResolve: (specifier: string, context: unknown) => unknown,
    ): unknown;
    load(
      url: string,
      context: unknown,
      nextLoad: (url: string, context: unknown) => unknown,
    ): unknown;
  }): void;
};

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

declare global {
  var __visualContextSectionPopoverCalls: Record<string, unknown>[];
}
globalThis.__visualContextSectionPopoverCalls = [];

const stubPrefix = "textiq-visual-context-section-test:";
const stubbedSpecifier = "./visual-context-popover";
const stubSource = `
  export function VisualContextPopover(props) {
    globalThis.__visualContextSectionPopoverCalls.push(props);
    return null;
  }
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === stubbedSpecifier) {
      return {
        url: `${stubPrefix}${encodeURIComponent(specifier)}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(stubPrefix)) {
      return { format: "module", source: stubSource, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

let VisualContextSection: typeof import("./mobile-visual-context-section").VisualContextSection;

before(async () => {
  ({ VisualContextSection } = await import("./mobile-visual-context-section"));
});

function popoverCalls(): Record<string, unknown>[] {
  return globalThis.__visualContextSectionPopoverCalls;
}

function lastPopoverCall(): Record<string, unknown> | undefined {
  const calls = popoverCalls();
  return calls[calls.length - 1];
}

function makeEditor(): LexicalEditor {
  const editor = createHeadlessEditor({
    namespace: "visual-context-section-test",
    nodes: [VisualNode],
    onError(error) {
      throw error;
    },
  });
  editor.getRootElement = (() => null) as typeof editor.getRootElement;
  editor.getElementByKey = (() => null) as typeof editor.getElementByKey;
  return editor;
}

/**
 * Builds `paragraph("<sourceText>") + VisualNode(visual, visualId)` and
 * returns both keys. When `sourceText` is `null` the visual has no preceding
 * sibling at all (covers the "no previous block" branch of the
 * `currentSourceText` gate).
 */
function buildDoc(
  editor: LexicalEditor,
  visual = FIXTURES.flowchart,
  visualId = "vis-stable-1",
  sourceText: string | null = "Explain the login flow",
): { nodeKey: string } {
  let nodeKey = "";
  act(() => {
    editor.update(
      () => {
        const root = $getRoot().clear();
        if (sourceText !== null) {
          const paragraph = $createParagraphNode();
          paragraph.append($createTextNode(sourceText));
          root.append(paragraph);
        }
        const visualNode = $createVisualNode(visual, visualId);
        root.append(visualNode);
        nodeKey = visualNode.getKey();
      },
      { discrete: true },
    );
  });
  return { nodeKey };
}

/** Selects `nodeKey` via a real Lexical `NodeSelection` (keyboard/click path). */
function selectNode(editor: LexicalEditor, nodeKey: string) {
  act(() => {
    editor.update(
      () => {
        const selection = $createNodeSelection();
        selection.add(nodeKey);
        $setSelection(selection);
      },
      { discrete: true },
    );
  });
}

/** Bridges test-driven `VisualPanelProvider` setters into the mounted tree. */
function PanelController({
  activeVisual,
  selectedNodeId,
  onClose,
}: {
  activeVisual: { nodeKey: string; visualId: string } | null;
  selectedNodeId: string | null;
  onClose: (() => void) | null;
}) {
  const panel = useVisualPanel();
  useEffect(() => {
    panel.setActiveVisual(activeVisual);
    panel.setSelectedNodeId(selectedNodeId);
    panel.setOnClose(onClose);
    // Deliberately omit `panel` from deps: its setters are stable
    // (useCallback/useState), and including the whole object would re-run
    // this effect every render since `value` is a fresh useMemo result only
    // when its own inputs change — safe either way, but this mirrors how a
    // real caller (`VisualCard`) invokes the setters from its own effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVisual, selectedNodeId, onClose]);
  return null;
}

/** Registers a real getter with `VisualSvgRegistryProvider` for `visualId`. */
function SvgRegistrar({
  visualId,
  getSvg,
}: {
  visualId: string;
  getSvg: () => SVGSVGElement | null;
}) {
  useRegisterVisualSvg(visualId, getSvg);
  return null;
}

function mount(
  editor: LexicalEditor,
  controllerProps: {
    activeVisual: { nodeKey: string; visualId: string } | null;
    selectedNodeId?: string | null;
    onClose?: (() => void) | null;
    svgRegistrar?: { visualId: string; getSvg: () => SVGSVGElement | null };
  },
): { renderer: ReactTestRenderer; unmount: () => void } {
  const composerContext: LexicalComposerContextWithEditor = [
    editor,
    createLexicalComposerContext(null, null),
  ];
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      createElement(
        LexicalComposerContext.Provider,
        { value: composerContext },
        createElement(
          EditorContextProvider,
          null,
          createElement(
            VisualSvgRegistryProvider,
            null,
            controllerProps.svgRegistrar
              ? createElement(SvgRegistrar, controllerProps.svgRegistrar)
              : null,
            createElement(
              VisualPanelProvider,
              null,
              createElement(PanelController, {
                activeVisual: controllerProps.activeVisual,
                selectedNodeId: controllerProps.selectedNodeId ?? null,
                onClose: controllerProps.onClose ?? null,
              }),
              createElement(VisualContextSection),
            ),
          ),
        ),
      ),
    );
  });
  return {
    renderer,
    unmount: () => {
      act(() => {
        renderer.unmount();
      });
    },
  };
}

function readVisual(editor: LexicalEditor, nodeKey: string) {
  return editor.getEditorState().read(() => {
    const node = $getNodeByKey(nodeKey);
    return $isVisualNode(node) ? node.getVisual() : null;
  });
}

function nodeExists(editor: LexicalEditor, nodeKey: string): boolean {
  return editor.getEditorState().read(() => $getNodeByKey(nodeKey) !== null);
}

/**
 * `editor.update()` without `{ discrete: true }` batches its reconciliation
 * via a microtask (see `mobile-generate-visual-section.test.tsx`), so a
 * synchronous read immediately after triggering a callback would see stale
 * state. Awaiting a few resolved promises lets Lexical's internal
 * microtask-scheduled flush run first.
 */
async function flush(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

// The fake `document` installed by `createReactRenderHarness` doesn't define
// `head`/`getElementById` at all (only `createElement`, which already
// returns a plain, freely-assignable mock object — good enough for the
// `link.id = ...; link.rel = ...; link.href = ...` writes `applyBrandToAll`
// performs). Install both here so the font-loading branch can be exercised
// without jsdom; reset the recorded state before each test.
let fontIdsWithLinks: Set<string>;
let appendedFontLinks: { id: string; href: string }[];

(
  document as unknown as { getElementById: (id: string) => unknown }
).getElementById = (id: string) => (fontIdsWithLinks.has(id) ? { id } : null);
(
  document as unknown as { head: { appendChild: (node: unknown) => unknown } }
).head = {
  appendChild: (node: unknown) => {
    const link = node as { id: string; href: string };
    appendedFontLinks.push({ id: link.id, href: link.href });
    fontIdsWithLinks.add(link.id);
    return node;
  },
};

beforeEach(() => {
  fontIdsWithLinks = new Set();
  appendedFontLinks = [];
});

afterEach(() => {
  globalThis.__visualContextSectionPopoverCalls = [];
});

test("renders nothing when no visual is active or selected", () => {
  const editor = makeEditor();
  const { unmount } = mount(editor, { activeVisual: null });
  assert.equal(popoverCalls().length, 0);
  unmount();
});

test("activeVisual (VisualCard) path derives panelState and passes props to the popover, gated on the source-text sibling", () => {
  const editor = makeEditor();
  const { nodeKey } = buildDoc(
    editor,
    FIXTURES.flowchart,
    "vis-stable-1",
    "Explain the login flow",
  );
  const { unmount } = mount(editor, {
    activeVisual: { nodeKey, visualId: "vis-stable-1" },
    selectedNodeId: "canvas-node-3",
  });

  const call = lastPopoverCall();
  assert.ok(call, "expected VisualContextPopover to have rendered");
  assert.equal(call.mode, "panel");
  assert.equal(call.visualId, "vis-stable-1");
  assert.deepEqual(call.visual, FIXTURES.flowchart);
  assert.equal(call.selectedNodeId, "canvas-node-3");
  assert.equal(call.currentSourceText, "Explain the login flow");
  assert.equal(typeof call.onChange, "function");
  assert.equal(typeof call.onCommand, "function");
  assert.equal(typeof call.onRemove, "function");
  assert.equal(typeof call.onClose, "function");
  assert.equal(typeof call.getSvgElement, "function");
  assert.equal(typeof call.onApplyBrandToAll, "function");
  assert.ok(
    call.anchorRef &&
      typeof call.anchorRef === "object" &&
      "current" in call.anchorRef,
  );

  unmount();
});

test("currentSourceText is undefined when the previous sibling isn't a source-text block", () => {
  const editor = makeEditor();
  const { nodeKey } = buildDoc(editor, FIXTURES.flowchart, "vis-2", null);
  const { unmount } = mount(editor, {
    activeVisual: { nodeKey, visualId: "vis-2" },
  });

  const call = lastPopoverCall();
  assert.ok(call);
  assert.equal(call.currentSourceText, undefined);

  unmount();
});

test("ctx.selectedVisualNodeKey (real NodeSelection) drives panelState when no activeVisual is set", () => {
  const editor = makeEditor();
  const { nodeKey } = buildDoc(
    editor,
    FIXTURES.list,
    "vis-selected-1",
    "Steps to follow",
  );
  const { unmount } = mount(editor, { activeVisual: null });

  selectNode(editor, nodeKey);

  const call = lastPopoverCall();
  assert.ok(call, "expected the popover to render from the selection path");
  assert.equal(call.visualId, "vis-selected-1");
  assert.deepEqual(call.visual, FIXTURES.list);
  assert.equal(call.currentSourceText, "Steps to follow");

  unmount();
});

test("onChange (updateVisual) applies applyElasticLayout(next) to the real node", async () => {
  const editor = makeEditor();
  const { nodeKey } = buildDoc(editor, FIXTURES.flowchart, "vis-3");
  const { unmount } = mount(editor, {
    activeVisual: { nodeKey, visualId: "vis-3" },
  });

  const call = lastPopoverCall();
  assert.ok(call);
  const onChange = call.onChange as (next: unknown) => void;

  await act(async () => {
    onChange({ ...FIXTURES.flowchart, title: "Renamed flow" });
    await flush();
  });

  const updated = readVisual(editor, nodeKey);
  assert.ok(updated);
  assert.equal(updated?.title, "Renamed flow");

  unmount();
});

test("onCommand (handleCommand) runs the real applyVisualCommand + applyElasticLayout pipeline", async () => {
  const editor = makeEditor();
  const { nodeKey } = buildDoc(editor, FIXTURES.flowchart, "vis-4");
  const { unmount } = mount(editor, {
    activeVisual: { nodeKey, visualId: "vis-4" },
  });

  const call = lastPopoverCall();
  assert.ok(call);
  const onCommand = call.onCommand as (payload: unknown) => void;

  await act(async () => {
    onCommand({ op: "visual.set_kind", kind: "list" });
    await flush();
  });

  const updated = readVisual(editor, nodeKey);
  assert.equal(updated?.type, "list");

  unmount();
});

test("onCommand is a no-op when applyVisualCommand rejects the payload", async () => {
  const editor = makeEditor();
  const { nodeKey } = buildDoc(editor, FIXTURES.flowchart, "vis-4b");
  const { unmount } = mount(editor, {
    activeVisual: { nodeKey, visualId: "vis-4b" },
  });

  const call = lastPopoverCall();
  assert.ok(call);
  const onCommand = call.onCommand as (payload: unknown) => void;

  await act(async () => {
    // "reset_node_style" targets a node id that doesn't exist on this
    // fixture; applyVisualCommand should report failure and setVisual must
    // never run.
    onCommand({ op: "visual.reset_node_style", nodeId: "does-not-exist" });
    await flush();
  });

  const updated = readVisual(editor, nodeKey);
  assert.deepEqual(updated, FIXTURES.flowchart);

  unmount();
});

test("onRemove (removeVisual) removes the real VisualNode from the tree", async () => {
  const editor = makeEditor();
  const { nodeKey } = buildDoc(editor, FIXTURES.flowchart, "vis-5");
  const { unmount } = mount(editor, {
    activeVisual: { nodeKey, visualId: "vis-5" },
  });

  assert.ok(nodeExists(editor, nodeKey));
  const call = lastPopoverCall();
  assert.ok(call);
  const onRemove = call.onRemove as () => void;

  await act(async () => {
    onRemove();
    await flush();
  });

  assert.equal(nodeExists(editor, nodeKey), false);

  unmount();
});

test("onClose (handleClose) invokes the onClose registered on VisualPanelProvider", () => {
  const editor = makeEditor();
  const { nodeKey } = buildDoc(editor, FIXTURES.flowchart, "vis-6");
  let closeCalls = 0;
  const { unmount } = mount(editor, {
    activeVisual: { nodeKey, visualId: "vis-6" },
    onClose: () => {
      closeCalls += 1;
    },
  });

  const call = lastPopoverCall();
  assert.ok(call);
  const onClose = call.onClose as () => void;

  act(() => {
    onClose();
  });

  assert.equal(closeCalls, 1);

  unmount();
});

test("onApplyBrandToAll loads the matching Google Font once and rebrands every VisualNode in the document", async () => {
  const editor = makeEditor();
  let nodeKey = "";
  let secondKey = "";
  act(() => {
    editor.update(
      () => {
        const root = $getRoot().clear();
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode("Explain the flow"));
        root.append(paragraph);
        const first = $createVisualNode(FIXTURES.flowchart, "vis-a");
        root.append(first);
        const second = $createVisualNode(FIXTURES.list, "vis-b");
        root.append(second);
        nodeKey = first.getKey();
        secondKey = second.getKey();
      },
      { discrete: true },
    );
  });

  const { unmount } = mount(editor, {
    activeVisual: { nodeKey, visualId: "vis-a" },
  });

  const call = lastPopoverCall();
  assert.ok(call);
  const onApplyBrandToAll = call.onApplyBrandToAll as (brand: unknown) => void;

  const brand = {
    id: "brand-1",
    name: "Acme",
    ownerId: "user-1",
    palette: null,
    background: null,
    nodeFill: null,
    nodeStroke: null,
    nodeText: null,
    edgeColor: null,
    fontFamily: "'Inter', sans-serif",
    fontAssetUrl: null,
  };

  await act(async () => {
    onApplyBrandToAll(brand);
    await flush();
  });

  assert.equal(appendedFontLinks.length, 1);
  assert.equal(appendedFontLinks[0]?.id, "gfont-brand-inter");
  assert.match(appendedFontLinks[0]?.href ?? "", /fonts\.googleapis\.com/);

  const firstVisual = readVisual(editor, nodeKey);
  const secondVisual = readVisual(editor, secondKey);
  assert.equal(firstVisual?.style.fontFamily, "'Inter', sans-serif");
  assert.equal(secondVisual?.style.fontFamily, "'Inter', sans-serif");

  await act(async () => {
    onApplyBrandToAll(brand);
    await flush();
  });
  assert.equal(
    appendedFontLinks.length,
    1,
    "the font <link> must only be appended once (getElementById guard)",
  );

  unmount();
});

test("getSvgElement returns null with no registered SVG getter", () => {
  const editor = makeEditor();
  const { nodeKey } = buildDoc(editor, FIXTURES.flowchart, "vis-svg");
  const { unmount } = mount(editor, {
    activeVisual: { nodeKey, visualId: "vis-svg" },
  });

  const call = lastPopoverCall();
  assert.ok(call);
  const getSvgElement = call.getSvgElement as () => unknown;
  assert.equal(getSvgElement(), null);

  unmount();
});

test("getSvgElement delegates to the real VisualSvgRegistryProvider entry for the active visualId", () => {
  const editor = makeEditor();
  const { nodeKey } = buildDoc(editor, FIXTURES.flowchart, "vis-svg-2");
  const fakeSvg = {} as SVGSVGElement;
  const { unmount } = mount(editor, {
    activeVisual: { nodeKey, visualId: "vis-svg-2" },
    svgRegistrar: { visualId: "vis-svg-2", getSvg: () => fakeSvg },
  });

  const call = lastPopoverCall();
  assert.ok(call);
  const getSvgElement = call.getSvgElement as () => unknown;
  assert.equal(getSvgElement(), fakeSvg);

  unmount();
});
