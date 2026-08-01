/**
 * Direct behavior coverage for `VisualCard` (#1958).
 *
 * `VisualCard` composes several independently-scoped collaborators. Two are
 * heavy, self-contained editing surfaces that each own their own extensive
 * internal state machines and are out of scope here: `VisualEditor` (the
 * in-card type/theme/refine/typography editing surface) and
 * `VisualContextPopover` (the floating contextual toolbox). Both are stubbed
 * to identity markers via a `node:module` `registerHooks` interception
 * (the pattern already used by `src/app/app/trash/page.test.tsx` and
 * `./page.test.tsx`) so this file can inspect the *exact props VisualCard
 * wires them with* — and invoke those prop callbacks directly to drive real
 * `editor.update()` mutations — without ever executing either surface's own
 * hooks. `@/lib/visual/export`'s `exportPNG`/`downloadBlob` are stubbed the
 * same way: they are the network/canvas/rasterization boundary with its own
 * exhaustive `export.test.ts`, so re-exercising their internals here would be
 * duplicated coverage; this file only asserts VisualCard calls them with the
 * right arguments and reacts correctly to their resolved/rejected outcomes.
 *
 * Everything else is real: `VisualRenderer` (pure SVG), `VisualNode`
 * (`$createVisualNode`/`getVisual`/`setVisual` on a real headless editor),
 * `applyVisualCommand`/`applyElasticLayout`/`applyBrand` (pure content
 * transforms), `RightSurfaceProvider`, `VisualPanelProvider`, and
 * `useEditingSurface` (real selection-derived `float` mode resolution).
 *
 * Coverage: the invalid-visual fallback; read-only vs. editable rendering;
 * opening/closing the editing controls (preview click, `registerEditableListener`
 * flipping non-editable, click-away outside the card, and clicking a
 * preview node/edge via `data-preview-node-id`/`data-preview-edge-id`);
 * `VisualContextPopover` only rendering in `float` mode with no edge
 * selected; the real mutation wiring behind `onChange`/`onCommand`/
 * `onRemove`/`onRemoveSelectedNode`/`onDuplicate`/`onApplyBrandToAll`; and
 * the shared quick-action operation boundary, download/copy/share recovery,
 * clipboard status feedback, and native Web Share gating.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, before, describe, test } from "node:test";
import { createElement, type ReactElement } from "react";
import {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  type LexicalEditor,
} from "lexical";
import { LexicalComposerContext } from "@lexical/react/LexicalComposerContext";

import {
  composerContextFor,
  flushEditor,
  installFakeDom,
  makeHeadlessEditor,
  mount,
  unmount,
} from "@/test/lexical-component-harness";
import {
  $createVisualNode,
  $isVisualNode,
  VisualNode,
} from "@/lib/lexical/visual-node";
import { FIXTURES } from "@/lib/visual/fixtures";
import type { Visual } from "@/lib/visual/schema";
import { RightSurfaceProvider } from "./right-surface-context";
import { VisualPanelProvider } from "./visual-panel-context";

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
  var __visualCardExport:
    | {
        calls: Array<{ svg: unknown; opts: unknown }>;
        impl: ((svg: unknown, opts: unknown) => Promise<Blob | null>) | null;
        downloads: Array<{ blob: Blob; filename: string }>;
      }
    | undefined;
}

const stubPrefix = "textiq-visual-card-test:";
const stubbedModules = new Map<string, string>([
  ["./visual-editor", `export function VisualEditor() { return null; }\n`],
  [
    "./visual-context-popover",
    `export function VisualContextPopover() { return null; }\n`,
  ],
  [
    "framer-motion",
    `
      import { createElement, forwardRef } from "react";

      // Only presentational; \`VisualCard\`'s root uses \`motion.div\` purely for
      // a mount-in fade/scale via \`useCardMotion\` (see reveal.ts) - orthogonal
      // to the interaction behavior this file covers, and real framer-motion's
      // transition driver can still be mid-flight (writing to DOM nodes via
      // rAF) when react-test-renderer unmounts between tests, throwing
      // asynchronously *after* the owning test already finished. Stubbing the
      // whole package to a plain forwardRef host element (dropping
      // animation-only props) sidesteps that entirely, the same way
      // VisualEditor/VisualContextPopover are stubbed as out-of-scope above.
      const MOTION_PROPS = new Set([
        "initial", "animate", "exit", "transition", "variants",
        "whileHover", "whileTap", "whileFocus", "whileDrag", "layout", "layoutId",
      ]);
      export const motion = new Proxy({}, {
        get(_target, tag) {
          return forwardRef(function MotionStub(props, ref) {
            const rest = {};
            for (const key in props) {
              if (!MOTION_PROPS.has(key)) rest[key] = props[key];
            }
            return createElement(tag, { ...rest, ref });
          });
        },
      });
      export function AnimatePresence(props) {
        return props.children ?? null;
      }
      export function useReducedMotion() {
        return true;
      }
    `,
  ],
  [
    "@/lib/visual/export",
    `
      export const DEFAULT_EXPORT_OPTIONS = { scale: 2, background: "include", padding: 0 };
      export async function exportPNG(svg, opts) {
        globalThis.__visualCardExport.calls.push({ svg, opts });
        const impl = globalThis.__visualCardExport.impl;
        return impl ? await impl(svg, opts) : null;
      }
      export function downloadBlob(blob, filename) {
        globalThis.__visualCardExport.downloads.push({ blob, filename });
      }
    `,
  ],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (stubbedModules.has(specifier)) {
      return {
        url: `${stubPrefix}${encodeURIComponent(specifier)}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(stubPrefix)) {
      const specifier = decodeURIComponent(url.slice(stubPrefix.length));
      return {
        format: "module",
        source: stubbedModules.get(specifier) ?? "",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

let VisualCard: typeof import("./visual-card").VisualCard;

let restoreDom: (() => void) | null = null;
let renderer: ReactTestRenderer | null = null;

before(async () => {
  ({ VisualCard } =
    (await import("./visual-card")) as typeof import("./visual-card"));
});

afterEach(() => {
  if (renderer) {
    unmount(renderer);
    renderer = null;
  }
  if (restoreDom) {
    restoreDom();
    restoreDom = null;
  }
  globalThis.__visualCardExport = undefined;
});

function makeEditor(): LexicalEditor {
  return makeHeadlessEditor({
    namespace: "visual-card-test",
    nodes: [VisualNode],
  });
}

/** Inserts a real `VisualNode` at the document root and returns its key. */
function insertVisualNode(editor: LexicalEditor, visual: Visual): string {
  let key = "";
  act(() => {
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode("Some source text"));
        const node = $createVisualNode(visual);
        key = node.getKey();
        $getRoot().clear().append(paragraph).append(node);
      },
      { discrete: true },
    );
  });
  return key;
}

function readVisual(editor: LexicalEditor, key: string): Visual | null {
  return editor.getEditorState().read(() => {
    const node = $getNodeByKey(key);
    return $isVisualNode(node) ? node.getVisual() : null;
  });
}

function visualNodeKeys(editor: LexicalEditor): string[] {
  return editor.getEditorState().read(() => {
    const keys: string[] = [];
    for (const child of $getRoot().getChildren()) {
      if ($isVisualNode(child)) {
        keys.push(child.getKey());
      }
    }
    return keys;
  });
}

function readVisualId(editor: LexicalEditor, key: string): string | null {
  return editor.getEditorState().read(() => {
    const node = $getNodeByKey(key);
    return $isVisualNode(node) ? node.getVisualId() : null;
  });
}

type MockNode = {
  contains: (node: unknown) => boolean;
};

function mountCard(
  editor: LexicalEditor,
  props: { nodeKey: string; visual: Visual; visualId?: string },
  createNodeMock?: (element: ReactElement) => unknown,
): ReactTestRenderer {
  return mount(
    createElement(
      LexicalComposerContext.Provider,
      { value: composerContextFor(editor) },
      createElement(
        RightSurfaceProvider,
        null,
        createElement(
          VisualPanelProvider,
          null,
          createElement(VisualCard, {
            nodeKey: props.nodeKey,
            visual: props.visual,
            visualId: props.visualId ?? "visual-1",
          }),
        ),
      ),
    ),
    createNodeMock ? { createNodeMock } : undefined,
  );
}

/** A `createNodeMock` that hands `VisualRenderer`'s root `<svg>` a truthy
 * mock object, standing in for the real `SVGSVGElement` that `quickDownload`/
 * `copyImage`/`nativeShare` read via `rendererRef.current`. `react-test-
 * renderer` resolves host refs to `null` unless `createNodeMock` says
 * otherwise; content only matters as far as being non-null, since
 * `@/lib/visual/export`'s `exportPNG` is stubbed to ignore its `svg`
 * argument beyond recording it. */
function svgRefMock(): { createNodeMock: (element: ReactElement) => unknown } {
  return {
    createNodeMock: (element) => (element.type === "svg" ? {} : null),
  };
}

/** A `createNodeMock` that hands VisualCard's own outer wrapper (marked via
 * `data-visual-chrome`) a mock supporting `.contains()` for the click-away
 * check, and a generic node otherwise. */
function cardRootMock(containsOutsideClicks: boolean): {
  createNodeMock: (element: ReactElement) => unknown;
  outsideNode: object;
} {
  const outsideNode = { marker: "outside" };
  const rootMock: MockNode = {
    contains: (node) => node !== outsideNode || containsOutsideClicks,
  };
  return {
    outsideNode,
    createNodeMock: (element) => {
      const props = (element as { props?: Record<string, unknown> }).props;
      if (props && props["data-visual-chrome"]) {
        return rootMock;
      }
      return {};
    },
  };
}

function findByAriaLabel(
  r: ReactTestRenderer,
  label: string,
): ReactTestInstance | null {
  const matches = r.root.findAll(
    (instance) => instance.props["aria-label"] === label,
  );
  return matches.length > 0 ? matches[0] : null;
}

/** Locates the stubbed `VisualEditor` instance by its function `.name`
 * rather than by reference. The `./visual-editor` stub module ends up
 * instantiated twice under this repo's Node version: once via this file's
 * own transitive resolution, and once via `visual-card.tsx`'s static
 * import — both resolve through the same `registerHooks` stub URL (verified
 * via resolve/load hook logging), but Node's synchronous customization
 * hooks and `tsx`'s own asynchronous loader hooks don't share a single
 * module cache, so `r.root.findAllByType(VisualEditor)` (reference
 * equality) does not match the instance actually rendered by `VisualCard`.
 * Matching by name sidesteps that and is otherwise equivalent, since both
 * instances are the identical stub source. */
function findVisualEditor(r: ReactTestRenderer): ReactTestInstance | null {
  const matches = r.root.findAll(
    (instance) =>
      typeof instance.type === "function" &&
      (instance.type as { name?: string }).name === "VisualEditor",
  );
  return matches.length > 0 ? matches[0] : null;
}

function findVisualContextPopover(
  r: ReactTestRenderer,
): ReactTestInstance | null {
  const matches = r.root.findAll(
    (instance) =>
      typeof instance.type === "function" &&
      (instance.type as { name?: string }).name === "VisualContextPopover",
  );
  return matches.length > 0 ? matches[0] : null;
}

/** Fake root element for the editor: supports the click-away listener the
 * card installs on `editor.getRootElement()` while its controls are open. */
function makeEditorRoot(): {
  root: { addEventListener: unknown; removeEventListener: unknown };
  dispatchMouseDown: (target: unknown) => void;
} {
  let handler: ((event: { target: unknown }) => void) | null = null;
  return {
    root: {
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        if (type === "mousedown") handler = fn;
      },
      removeEventListener: (type: string) => {
        if (type === "mousedown") handler = null;
      },
    },
    dispatchMouseDown: (target: unknown) => handler?.({ target }),
  };
}

describe("VisualCard", () => {
  test("renders the 'Unavailable visual' fallback when the visual payload fails to parse", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    renderer = mountCard(editor, {
      nodeKey: key,
      visual: { not: "a visual" } as unknown as Visual,
    });

    const fallback = findByAriaLabel(renderer, "Unavailable visual");
    assert.ok(fallback);
    assert.equal(fallback!.props.role, "img");
    assert.equal(findVisualEditor(renderer), null);
  });

  test("read-only: renders only the VisualRenderer, with no preview button or export controls", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    editor.isEditable = () => false;
    const key = insertVisualNode(editor, FIXTURES.list);
    renderer = mountCard(editor, { nodeKey: key, visual: FIXTURES.list });

    assert.equal(findByAriaLabel(renderer, "Edit visual"), null);
    assert.equal(findByAriaLabel(renderer, "Download visual as PNG"), null);
    assert.equal(findVisualEditor(renderer), null);
  });

  test("editable + closed: renders responsive, touch-sized quick actions; clicking the preview opens the editing controls", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    renderer = mountCard(editor, { nodeKey: key, visual: FIXTURES.list });

    const preview = findByAriaLabel(renderer, "Edit visual")!;
    assert.ok(preview);
    const downloadButton = findByAriaLabel(renderer, "Download visual as PNG")!;
    assert.match(String(downloadButton.props.className), /tiq-touch-target/);
    assert.match(
      String(downloadButton.parent?.props.className),
      /tiq-coarse-actions/,
    );
    assert.equal(findVisualEditor(renderer), null);

    act(() => {
      preview.props.onClick();
    });

    const editorStub = findVisualEditor(renderer!)!;
    assert.ok(editorStub);
    assert.equal(editorStub.props.canEdit, true);
    assert.equal(editorStub.props.initialSelectedNodeId, null);
    assert.equal(findByAriaLabel(renderer!, "Edit visual"), null);
  });

  test("keyboard activation requests initial tool focus and closing restores the preview", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    let previewFocusCalls = 0;
    const previewNode = {
      focus: () => {
        previewFocusCalls += 1;
      },
    };
    const createNodeMock = (element: ReactElement) => {
      const props = (element as { props?: Record<string, unknown> }).props;
      if (props?.["aria-label"] === "Edit visual") return previewNode;
      if (props?.["data-visual-chrome"]) {
        return { contains: () => true };
      }
      return {};
    };

    withMatchMediaFine(() => {
      renderer = mountCard(
        editor,
        { nodeKey: key, visual: FIXTURES.list },
        createNodeMock,
      );
    });

    let prevented = false;
    act(() => {
      findByAriaLabel(renderer!, "Edit visual")!.props.onKeyDown({
        key: "Enter",
        preventDefault: () => {
          prevented = true;
        },
      });
    });
    assert.equal(prevented, true);

    const popover = findVisualContextPopover(renderer!)!;
    assert.ok(popover);
    assert.equal(popover.props.focusFirstTool, true);

    act(() => {
      popover.props.onClose();
    });
    assert.ok(findByAriaLabel(renderer!, "Edit visual"));
    assert.equal(previewFocusCalls, 1);
  });

  test("registerEditableListener flipping non-editable while open closes the controls", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    renderer = mountCard(editor, { nodeKey: key, visual: FIXTURES.list });

    act(() => {
      findByAriaLabel(renderer!, "Edit visual")!.props.onClick();
    });
    assert.ok(findVisualEditor(renderer!));

    act(() => {
      editor.setEditable(false);
    });

    assert.equal(findVisualEditor(renderer!), null);
    assert.equal(findByAriaLabel(renderer!, "Edit visual"), null);
  });

  test("a pointer-down outside the card (but inside the editor root) closes the open controls", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    const { root, dispatchMouseDown } = makeEditorRoot();
    editor.getRootElement = (() => root) as typeof editor.getRootElement;
    const key = insertVisualNode(editor, FIXTURES.list);
    const { createNodeMock, outsideNode } = cardRootMock(false);
    renderer = mountCard(
      editor,
      { nodeKey: key, visual: FIXTURES.list },
      createNodeMock,
    );

    act(() => {
      findByAriaLabel(renderer!, "Edit visual")!.props.onClick();
    });
    assert.ok(findVisualEditor(renderer!));

    act(() => {
      dispatchMouseDown(outsideNode);
    });

    assert.equal(findVisualEditor(renderer!), null);
  });

  test("clicking a preview node (data-preview-node-id) opens the controls with that node selected", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    renderer = mountCard(editor, { nodeKey: key, visual: FIXTURES.list });

    const preview = findByAriaLabel(renderer, "Edit visual")!;
    act(() => {
      preview.props.onPointerDownCapture({
        target: {
          getAttribute: (attr: string) =>
            attr === "data-preview-node-id" ? "s1" : null,
        },
        preventDefault: () => {},
        stopPropagation: () => {},
      });
    });

    const editorStub = findVisualEditor(renderer!)!;
    assert.equal(editorStub.props.initialSelectedNodeId, "s1");
    assert.equal(editorStub.props.initialSelectedEdgeId, null);
  });

  test("clicking a preview edge (data-preview-edge-id) opens the controls with that edge selected, and suppresses VisualContextPopover", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.flowchart);
    withMatchMediaFine(() => {
      renderer = mountCard(editor, {
        nodeKey: key,
        visual: FIXTURES.flowchart,
      });
    });

    const edgeId = FIXTURES.flowchart.edges[0]!.id;
    act(() => {
      findByAriaLabel(renderer!, "Edit visual")!.props.onPointerDownCapture({
        target: {
          getAttribute: (attr: string) =>
            attr === "data-preview-edge-id" ? edgeId : null,
        },
        preventDefault: () => {},
        stopPropagation: () => {},
      });
    });

    const editorStub = findVisualEditor(renderer!)!;
    assert.equal(editorStub.props.initialSelectedEdgeId, edgeId);
    // selectedEdgeId !== null gates VisualContextPopover off even in float mode.
    assert.equal(findVisualContextPopover(renderer!), null);
  });

  test("VisualContextPopover renders in float mode with a real onRemove wired to remove the VisualNode", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    withMatchMediaFine(() => {
      renderer = mountCard(editor, { nodeKey: key, visual: FIXTURES.list });
    });

    act(() => {
      findByAriaLabel(renderer!, "Edit visual")!.props.onClick();
    });

    const popover = findVisualContextPopover(renderer!)!;
    assert.ok(popover);
    assert.equal(popover.props.visualId, "visual-1");
    assert.equal(popover.props.selectedNodeId, null);

    assert.equal(visualNodeKeys(editor).includes(key), true);
    act(() => {
      popover.props.onRemove();
      flushEditor(editor);
    });
    assert.equal(visualNodeKeys(editor).includes(key), false);
  });

  test("onChange (VisualEditor) writes the new Visual back via a real editor.update", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    renderer = mountCard(editor, { nodeKey: key, visual: FIXTURES.list });

    act(() => {
      findByAriaLabel(renderer!, "Edit visual")!.props.onClick();
    });
    const editorStub = findVisualEditor(renderer!)!;

    const next: Visual = { ...FIXTURES.list, title: "Renamed" };
    act(() => {
      editorStub.props.onChange(next);
      flushEditor(editor);
    });

    assert.equal(readVisual(editor, key)?.title, "Renamed");
  });

  test("onCommand (VisualEditor) applies a real visual command; an invalid command leaves the visual unchanged", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    renderer = mountCard(editor, { nodeKey: key, visual: FIXTURES.list });

    act(() => {
      findByAriaLabel(renderer!, "Edit visual")!.props.onClick();
    });
    const editorStub = findVisualEditor(renderer!)!;

    act(() => {
      editorStub.props.onCommand({
        op: "visual.set_node_label",
        nodeId: "s1",
        label: "Renamed step",
      });
      flushEditor(editor);
    });
    const afterValid = readVisual(editor, key)!;
    assert.equal(
      afterValid.nodes.find((n) => n.id === "s1")?.label,
      "Renamed step",
    );

    act(() => {
      editorStub.props.onCommand({
        op: "visual.set_node_label",
        nodeId: "does-not-exist",
        label: "Should not apply",
      });
      flushEditor(editor);
    });
    const afterInvalid = readVisual(editor, key)!;
    assert.deepEqual(afterInvalid, afterValid);
  });

  test("onRemoveSelectedNode (VisualContextPopover) deletes the selected node when more than one remains, and is undefined for a single-node visual", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    withMatchMediaFine(() => {
      renderer = mountCard(editor, { nodeKey: key, visual: FIXTURES.list });
    });

    act(() => {
      findByAriaLabel(renderer!, "Edit visual")!.props.onPointerDownCapture({
        target: {
          getAttribute: (attr: string) =>
            attr === "data-preview-node-id" ? "s1" : null,
        },
        preventDefault: () => {},
        stopPropagation: () => {},
      });
    });

    const popover = findVisualContextPopover(renderer!)!;
    assert.equal(typeof popover.props.onRemoveSelectedNode, "function");
    act(() => {
      (popover.props.onRemoveSelectedNode as () => void)();
      flushEditor(editor);
    });
    assert.equal(
      readVisual(editor, key)!.nodes.some((n) => n.id === "s1"),
      false,
    );
  });

  test("onRemoveSelectedNode is undefined when no node is selected (only the whole visual/edge is active)", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    withMatchMediaFine(() => {
      renderer = mountCard(editor, { nodeKey: key, visual: FIXTURES.list });
    });

    act(() => {
      findByAriaLabel(renderer!, "Edit visual")!.props.onClick();
    });

    const popover = findVisualContextPopover(renderer!)!;
    assert.equal(popover.props.selectedNodeId, null);
    assert.equal(popover.props.onRemoveSelectedNode, undefined);
  });

  test("onRemoveSelectedNode never deletes the last remaining node of a single-node visual", () => {
    const singleNode: Visual = {
      ...FIXTURES.list,
      nodes: [FIXTURES.list.nodes[0]!],
      edges: [],
    };
    restoreDom = installFakeDom();
    const editor = makeEditor();
    const key = insertVisualNode(editor, singleNode);
    withMatchMediaFine(() => {
      renderer = mountCard(editor, { nodeKey: key, visual: singleNode });
    });

    act(() => {
      findByAriaLabel(renderer!, "Edit visual")!.props.onPointerDownCapture({
        target: {
          getAttribute: (attr: string) =>
            attr === "data-preview-node-id" ? singleNode.nodes[0]!.id : null,
        },
        preventDefault: () => {},
        stopPropagation: () => {},
      });
    });

    const popover = findVisualContextPopover(renderer!)!;
    act(() => {
      (popover.props.onRemoveSelectedNode as () => void)();
      flushEditor(editor);
    });
    assert.equal(readVisual(editor, key)!.nodes.length, 1);
  });

  test("onDuplicate (VisualContextPopover) inserts a copy VisualNode with a distinct visualId", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    withMatchMediaFine(() => {
      renderer = mountCard(editor, { nodeKey: key, visual: FIXTURES.list });
    });

    act(() => {
      findByAriaLabel(renderer!, "Edit visual")!.props.onClick();
    });
    const popover = findVisualContextPopover(renderer!)!;

    assert.equal(visualNodeKeys(editor).length, 1);
    act(() => {
      (popover.props.onDuplicate as () => void)();
      flushEditor(editor);
    });
    const keys = visualNodeKeys(editor);
    assert.equal(keys.length, 2);
    const otherKey = keys.find((k) => k !== key)!;
    assert.equal(readVisual(editor, otherKey)?.title, FIXTURES.list.title);
    const originalId = readVisualId(editor, key);
    const otherId = readVisualId(editor, otherKey);
    assert.notEqual(originalId, otherId);
  });

  test("onApplyBrandToAll (VisualContextPopover) applies a brand to every VisualNode in the document", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    const key1 = insertVisualNode(editor, FIXTURES.list);
    act(() => {
      editor.update(
        () => {
          const node = $createVisualNode(FIXTURES.list);
          $getRoot().append(node);
        },
        { discrete: true },
      );
    });
    withMatchMediaFine(() => {
      renderer = mountCard(editor, { nodeKey: key1, visual: FIXTURES.list });
    });

    act(() => {
      findByAriaLabel(renderer!, "Edit visual")!.props.onClick();
    });
    const popover = findVisualContextPopover(renderer!)!;

    act(() => {
      (popover.props.onApplyBrandToAll as (brand: unknown) => void)({
        id: "brand-1",
        name: "Test Brand",
        ownerId: "owner-1",
        palette: ["#111111"],
        background: "#ffffff",
        nodeFill: "#222222",
        nodeStroke: null,
        nodeText: null,
        edgeColor: null,
        fontFamily: null,
      });
      flushEditor(editor);
    });

    for (const key of visualNodeKeys(editor)) {
      const visual = readVisual(editor, key)!;
      assert.equal(visual.style.background, "#ffffff");
      assert.equal(visual.style.nodeFill, "#222222");
    }
  });

  test("quickDownload calls exportPNG with the rendered SVG and downloadBlob with a sanitized filename", async () => {
    restoreDom = installFakeDom();
    globalThis.__visualCardExport = {
      calls: [],
      downloads: [],
      impl: async () => new Blob(["png"], { type: "image/png" }),
    };
    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    renderer = mountCard(
      editor,
      { nodeKey: key, visual: FIXTURES.list },
      svgRefMock().createNodeMock,
    );

    const downloadButton = findByAriaLabel(renderer, "Download visual as PNG")!;
    await act(async () => {
      await downloadButton.props.onClick({ stopPropagation: () => {} });
    });

    assert.equal(globalThis.__visualCardExport!.calls.length, 1);
    assert.deepEqual(
      globalThis.__visualCardExport!.downloads.map((d) => d.filename),
      ["How it works.png"],
    );
  });

  test("quickDownload ignores a renderer that settles after the visual card unmounts", async () => {
    restoreDom = installFakeDom();
    let resolveExport!: (blob: Blob | null) => void;
    globalThis.__visualCardExport = {
      calls: [],
      downloads: [],
      impl: () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
    };
    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    renderer = mountCard(
      editor,
      { nodeKey: key, visual: FIXTURES.list },
      svgRefMock().createNodeMock,
    );
    let settled!: Promise<void>;
    act(() => {
      settled = findByAriaLabel(
        renderer!,
        "Download visual as PNG",
      )!.props.onClick({ stopPropagation: () => {} });
    });
    assert.equal(globalThis.__visualCardExport.calls.length, 1);
    assert.equal(globalThis.__visualCardExport.downloads.length, 0);

    unmount(renderer);
    renderer = null;
    resolveExport(new Blob(["late-png"], { type: "image/png" }));
    await act(async () => {
      await settled;
    });

    assert.equal(globalThis.__visualCardExport.downloads.length, 0);
  });

  test("quick actions share one synchronous boundary and disable every competing action until settlement", async () => {
    restoreDom = installFakeDom({
      navigator: {
        clipboard: { write: async () => {} },
        share: async () => {},
        canShare: () => true,
      },
    });
    const originalClipboardItem = (globalThis as { ClipboardItem?: unknown })
      .ClipboardItem;
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {
      constructor(public items: unknown) {}
    };

    let resolveExport: ((blob: Blob | null) => void) | null = null;
    globalThis.__visualCardExport = {
      calls: [],
      downloads: [],
      impl: () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
    };

    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    renderer = mountCard(
      editor,
      { nodeKey: key, visual: FIXTURES.list },
      svgRefMock().createNodeMock,
    );

    try {
      const downloadButton = findByAriaLabel(
        renderer,
        "Download visual as PNG",
      )!;
      const copyButton = findByAriaLabel(renderer, "Copy image to clipboard")!;
      const shareButton = findByAriaLabel(renderer, "Share visual")!;

      act(() => {
        downloadButton.props.onClick({ stopPropagation: () => {} });
        downloadButton.props.onClick({ stopPropagation: () => {} });
        copyButton.props.onClick({ stopPropagation: () => {} });
        shareButton.props.onClick({ stopPropagation: () => {} });
      });

      assert.equal(globalThis.__visualCardExport.calls.length, 1);
      assert.equal(
        renderer.root.findByProps({ "aria-busy": true }).props["aria-busy"],
        true,
      );
      assert.equal(
        findByAriaLabel(renderer, "Downloading visual as PNG")!.props.disabled,
        true,
      );
      assert.equal(
        findByAriaLabel(renderer, "Copy image to clipboard")!.props.disabled,
        true,
      );
      assert.equal(
        findByAriaLabel(renderer, "Share visual")!.props.disabled,
        true,
      );

      assert.ok(resolveExport);
      await act(async () => {
        resolveExport!(new Blob(["png"], { type: "image/png" }));
      });

      assert.equal(globalThis.__visualCardExport.downloads.length, 1);
      assert.equal(
        findByAriaLabel(renderer, "Download visual as PNG")!.props.disabled,
        false,
      );
      assert.equal(
        renderer.root.findAllByProps({ "aria-busy": true }).length,
        0,
      );
    } finally {
      (globalThis as { ClipboardItem?: unknown }).ClipboardItem =
        originalClipboardItem;
    }
  });

  test("quickDownload surfaces a dismissible failure and permits a successful retry", async () => {
    restoreDom = installFakeDom();
    globalThis.__visualCardExport = {
      calls: [],
      downloads: [],
      impl: async () => null,
    };
    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    renderer = mountCard(
      editor,
      { nodeKey: key, visual: FIXTURES.list },
      svgRefMock().createNodeMock,
    );

    const downloadButton = findByAriaLabel(renderer, "Download visual as PNG")!;
    await act(async () => {
      await downloadButton.props.onClick({ stopPropagation: () => {} });
    });

    assert.equal(globalThis.__visualCardExport!.calls.length, 1);
    assert.equal(globalThis.__visualCardExport!.downloads.length, 0);
    assert.equal(
      renderer.root.findByProps({ role: "alert" }).findByType("span")
        .children[0],
      "Visual download failed. Try again.",
    );

    act(() => {
      findByAriaLabel(renderer!, "Dismiss visual action error")!.props.onClick({
        stopPropagation: () => {},
      });
    });
    assert.equal(renderer.root.findAllByProps({ role: "alert" }).length, 0);

    globalThis.__visualCardExport.impl = async () =>
      new Blob(["png"], { type: "image/png" });
    await act(async () => {
      await findByAriaLabel(renderer!, "Download visual as PNG")!.props.onClick(
        {
          stopPropagation: () => {},
        },
      );
    });

    assert.equal(globalThis.__visualCardExport.calls.length, 2);
    assert.deepEqual(
      globalThis.__visualCardExport.downloads.map(
        (download) => download.filename,
      ),
      ["How it works.png"],
    );
  });

  test("copyImage: idle -> copying -> copied on a successful export, using the real clipboard write", async () => {
    restoreDom = installFakeDom({
      navigator: {
        clipboard: {
          write: async (items: unknown[]) => {
            (globalThis as Record<string, unknown>).__clipboardWrites =
              ((globalThis as Record<string, unknown>).__clipboardWrites as
                unknown[] | undefined) ?? [];
            (
              (globalThis as Record<string, unknown>)
                .__clipboardWrites as unknown[]
            ).push(items);
          },
        },
      },
    });
    const originalClipboardItem = (globalThis as { ClipboardItem?: unknown })
      .ClipboardItem;
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {
      constructor(public items: unknown) {}
    };

    let resolveExport: ((blob: Blob | null) => void) | null = null;
    globalThis.__visualCardExport = {
      calls: [],
      downloads: [],
      impl: () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
    };

    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    renderer = mountCard(
      editor,
      { nodeKey: key, visual: FIXTURES.list },
      svgRefMock().createNodeMock,
    );

    try {
      const copyButton = findByAriaLabel(renderer, "Copy image to clipboard")!;
      assert.ok(copyButton);

      let clickPromise!: Promise<void>;
      act(() => {
        clickPromise = copyButton.props.onClick({
          stopPropagation: () => {},
        });
      });

      assert.ok(findByAriaLabel(renderer, "Copy failed") === null);
      assert.ok(resolveExport);
      await act(async () => {
        resolveExport!(new Blob(["png"], { type: "image/png" }));
        await clickPromise;
      });

      assert.ok(findByAriaLabel(renderer, "Image copied!"));
    } finally {
      (globalThis as { ClipboardItem?: unknown }).ClipboardItem =
        originalClipboardItem;
      delete (globalThis as Record<string, unknown>).__clipboardWrites;
    }
  });

  test("copyImage: idle -> copying -> error when exportPNG resolves null", async () => {
    restoreDom = installFakeDom({
      navigator: {
        clipboard: { write: async () => {} },
      },
    });
    const originalClipboardItem = (globalThis as { ClipboardItem?: unknown })
      .ClipboardItem;
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {
      constructor(public items: unknown) {}
    };
    globalThis.__visualCardExport = {
      calls: [],
      downloads: [],
      impl: async () => null,
    };

    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    renderer = mountCard(
      editor,
      { nodeKey: key, visual: FIXTURES.list },
      svgRefMock().createNodeMock,
    );

    try {
      const copyButton = findByAriaLabel(renderer, "Copy image to clipboard")!;
      await act(async () => {
        await copyButton.props.onClick({ stopPropagation: () => {} });
      });

      assert.ok(findByAriaLabel(renderer, "Copy failed"));
    } finally {
      (globalThis as { ClipboardItem?: unknown }).ClipboardItem =
        originalClipboardItem;
    }
  });

  test("nativeShare calls navigator.share with the exported file when Web Share is available", async () => {
    const shareCalls: unknown[] = [];
    restoreDom = installFakeDom({
      navigator: {
        share: async (payload: unknown) => {
          shareCalls.push(payload);
        },
        canShare: () => true,
      },
    });
    globalThis.__visualCardExport = {
      calls: [],
      downloads: [],
      impl: async () => new Blob(["png"], { type: "image/png" }),
    };

    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    renderer = mountCard(
      editor,
      { nodeKey: key, visual: FIXTURES.list },
      svgRefMock().createNodeMock,
    );

    const shareButton = findByAriaLabel(renderer, "Share visual")!;
    assert.ok(shareButton);
    await act(async () => {
      await shareButton.props.onClick({ stopPropagation: () => {} });
    });

    assert.equal(shareCalls.length, 1);
    const payload = shareCalls[0] as { title?: string; files?: File[] };
    assert.equal(payload.title, "How it works");
    assert.equal(payload.files?.length, 1);
  });

  test("nativeShare exposes non-cancellation failures, dismisses them, and sanitizes retry filenames", async () => {
    const shareCalls: Array<{ files?: File[]; title?: string }> = [];
    let rejectShare = true;
    restoreDom = installFakeDom({
      navigator: {
        share: async (payload: { files?: File[]; title?: string }) => {
          shareCalls.push(payload);
          if (rejectShare) throw new Error("share transport failed");
        },
        canShare: () => true,
      },
    });
    globalThis.__visualCardExport = {
      calls: [],
      downloads: [],
      impl: async () => new Blob(["png"], { type: "image/png" }),
    };

    const visual = { ...FIXTURES.list, title: "Revenue / Costs" };
    const editor = makeEditor();
    const key = insertVisualNode(editor, visual);
    renderer = mountCard(
      editor,
      { nodeKey: key, visual },
      svgRefMock().createNodeMock,
    );

    await act(async () => {
      await findByAriaLabel(renderer!, "Share visual")!.props.onClick({
        stopPropagation: () => {},
      });
    });

    assert.equal(shareCalls.length, 1);
    assert.ok(findByAriaLabel(renderer, "Share failed"));
    assert.equal(
      renderer.root.findByProps({ role: "alert" }).findByType("span")
        .children[0],
      "Visual sharing failed. Try again.",
    );

    act(() => {
      findByAriaLabel(renderer!, "Dismiss visual action error")!.props.onClick({
        stopPropagation: () => {},
      });
    });
    rejectShare = false;

    await act(async () => {
      await findByAriaLabel(renderer!, "Share visual")!.props.onClick({
        stopPropagation: () => {},
      });
    });

    assert.equal(shareCalls.length, 2);
    assert.equal(shareCalls[1]?.files?.[0]?.name, "Revenue _ Costs.png");
    assert.equal(renderer.root.findAllByProps({ role: "alert" }).length, 0);
  });

  test("nativeShare treats AbortError as a normal user cancellation", async () => {
    restoreDom = installFakeDom({
      navigator: {
        share: async () => {
          const error = new Error("cancelled");
          error.name = "AbortError";
          throw error;
        },
        canShare: () => true,
      },
    });
    globalThis.__visualCardExport = {
      calls: [],
      downloads: [],
      impl: async () => new Blob(["png"], { type: "image/png" }),
    };

    const editor = makeEditor();
    const key = insertVisualNode(editor, FIXTURES.list);
    renderer = mountCard(
      editor,
      { nodeKey: key, visual: FIXTURES.list },
      svgRefMock().createNodeMock,
    );

    await act(async () => {
      await findByAriaLabel(renderer!, "Share visual")!.props.onClick({
        stopPropagation: () => {},
      });
    });

    assert.equal(renderer.root.findAllByProps({ role: "alert" }).length, 0);
    assert.ok(findByAriaLabel(renderer, "Share visual"));
  });
});

/** Flips `useIsPointerFine`'s one-shot mount-time read to `true` for the
 * duration of `run`. `useIsPointerFine` only reads `matchMedia` once at
 * mount, so callers must wrap the `mountCard(...)` call itself (not a
 * later interaction) for this to have any effect. */
function withMatchMediaFine(run: () => void): void {
  const fakeWindow = globalThis.window as unknown as {
    matchMedia: (query: string) => {
      matches: boolean;
      addEventListener: () => void;
      removeEventListener: () => void;
    };
  };
  const original = fakeWindow.matchMedia;
  fakeWindow.matchMedia = () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  try {
    run();
  } finally {
    fakeWindow.matchMedia = original;
  }
}
