/**
 * Direct behavior coverage for `OverallAdjustmentsPanel` (#1959).
 *
 * Mounted with a real `@lexical/headless` editor + `LexicalComposerContext`
 * (the only context this component reads via `useLexicalComposerContext()`),
 * this exercises the real `ThemeSection`/`BrandSection` composition and their
 * production mutation callbacks against a real Lexical node graph:
 *  - `ThemeSection`'s per-theme buttons run the real
 *    `applyVisualCommand`(`visual.apply_theme`) + `applyElasticLayout`
 *    pipeline against every `VisualNode` in the document via `$nodesOfType`.
 *  - `BrandSection` lazily fetches `/api/brand` (stubbed `global.fetch`,
 *    restored after the suite), rendering nothing once loaded with zero
 *    brands (or on a fetch failure — the component swallows errors), and
 *    otherwise renders one button per brand whose click runs the real
 *    `applyBrand` + `applyElasticLayout` pipeline plus the real Google-Font
 *    `<link>` / `injectBrandFontFace` `<style>` DOM injection paths (same
 *    `document.head`/`getElementById` stub pattern as
 *    `mobile-visual-context-section.test.tsx`, since the harness's fake
 *    `document` has neither by default).
 *
 * No component is stubbed here: `Divider`/`Surface`/`Tooltip` (from
 * `@/components/ui`) and the `lucide-react` icons are all plain, portal-free
 * markup safe to mount directly (only `Tooltip`'s own floating bubble
 * portals — see the `document.body` fix below — never `Divider`/`Surface`).
 */
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { createHeadlessEditor } from "@lexical/headless";
import {
  createLexicalComposerContext,
  LexicalComposerContext,
  type LexicalComposerContextWithEditor,
} from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  type LexicalEditor,
} from "lexical";

import type { BrandStyle } from "@/lib/brand/schema";
import {
  $createVisualNode,
  $isVisualNode,
  VisualNode,
} from "@/lib/lexical/visual-node";
import { FIXTURES } from "@/lib/visual/fixtures";
import { STYLE_THEMES } from "@/lib/visual/themes";

// Side effect only: flips on `IS_REACT_ACT_ENVIRONMENT`; also installs the
// baseline `document`/`window` stubs this file's effects need, persistently
// for this file's lifetime (its tests directly monkey-patch
// `globalThis.document`/`globalThis.window` across cases).
import { installPersistentDefaultDom } from "@/test/react-render-harness";

installPersistentDefaultDom();

// `Tooltip` (wrapping every theme/brand button) unconditionally calls
// `createPortal(tooltip, document.body)` once `document` exists, so `body`
// needs a `nodeType` react-dom's portal guard accepts. Matches
// `mobile-text-format-section.test.tsx`/`mobile-editing-sheet.test.tsx`.
(globalThis.document as unknown as { body: { nodeType: number } }).body = {
  nodeType: 1,
} as never;

// The fake `document` installed by `installPersistentDefaultDom` doesn't
// define `head`/`getElementById` at all (only `createElement`, which already
// returns a plain, freely-assignable mock object). Install both so the
// Google-Font `<link>` path (`applyBrandToAll`) and the custom-font
// `injectBrandFontFace` `<style>` path can both be exercised without jsdom.
// Matches `mobile-visual-context-section.test.tsx`.
let elementIdsInDom: Set<string>;
let appendedHeadNodes: { id: string; tag: string; [key: string]: unknown }[];

(
  document as unknown as { getElementById: (id: string) => unknown }
).getElementById = (id: string) => (elementIdsInDom.has(id) ? { id } : null);
(
  document as unknown as { head: { appendChild: (node: unknown) => unknown } }
).head = {
  appendChild: (node: unknown) => {
    const el = node as { id: string; tagName?: string; [key: string]: unknown };
    appendedHeadNodes.push({ ...el, tag: el.tagName ?? "unknown" });
    elementIdsInDom.add(el.id);
    return node;
  },
};

beforeEach(() => {
  elementIdsInDom = new Set();
  appendedHeadNodes = [];
});

let OverallAdjustmentsPanel: typeof import("./overall-adjustments-panel").OverallAdjustmentsPanel;

before(async () => {
  ({ OverallAdjustmentsPanel } = await import("./overall-adjustments-panel"));
});

type FetchStub = (url: string) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

let fetchImpl: FetchStub = () =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ brands: [] }) });
const originalFetch = globalThis.fetch;
globalThis.fetch = ((url: string) =>
  fetchImpl(url)) as unknown as typeof globalThis.fetch;

afterEach(() => {
  fetchImpl = () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ brands: [] }) });
});

function restoreFetch() {
  globalThis.fetch = originalFetch;
}
process.on("exit", restoreFetch);

/** Flushes the microtask queue so the panel's `editor.update()` batches
 * (non-`discrete`) and `BrandSection`'s `fetch().then()` chain settle before
 * a synchronous read. */
async function flush(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

function makeEditor(): LexicalEditor {
  const editor = createHeadlessEditor({
    namespace: "overall-adjustments-panel-test",
    nodes: [VisualNode],
    onError(error) {
      throw error;
    },
  });
  editor.getRootElement = (() => null) as typeof editor.getRootElement;
  editor.getElementByKey = (() => null) as typeof editor.getElementByKey;
  return editor;
}

/** Builds two `VisualNode`s in the document, returning both keys. */
function buildTwoVisualNodes(editor: LexicalEditor): {
  firstKey: string;
  secondKey: string;
} {
  let firstKey = "";
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
        firstKey = first.getKey();
        secondKey = second.getKey();
      },
      { discrete: true },
    );
  });
  return { firstKey, secondKey };
}

function readVisual(editor: LexicalEditor, nodeKey: string) {
  return editor.getEditorState().read(() => {
    const node = $getNodeByKey(nodeKey);
    return $isVisualNode(node) ? node.getVisual() : null;
  });
}

function mount(editor: LexicalEditor): {
  renderer: ReactTestRenderer;
  unmount: () => void;
} {
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
        createElement(OverallAdjustmentsPanel, null),
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

function findButtons(renderer: ReactTestRenderer) {
  return renderer.root.findAll((node) => node.type === "button");
}

function findByAriaLabel(renderer: ReactTestRenderer, label: string) {
  return findButtons(renderer).find(
    (button) => button.props["aria-label"] === label,
  );
}

const brandFixture: BrandStyle = {
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
  logoAssetUrl: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

test("renders the 'Document adjustments' header and one theme button per STYLE_THEMES entry; brand section starts in its loading state", async () => {
  fetchImpl = () => new Promise(() => {}); // never resolves within this test
  const editor = makeEditor();
  const { renderer, unmount } = mount(editor);

  const header = renderer.root.findAll(
    (node) => node.props.children === "Document adjustments",
  );
  assert.ok(header.length > 0, "expected the 'Document adjustments' header");

  for (const theme of STYLE_THEMES) {
    assert.ok(
      findByAriaLabel(renderer, `Apply ${theme.name} theme to all visuals`),
      `expected a theme button for ${theme.name}`,
    );
  }

  const loading = renderer.root.findAll(
    (node) => node.props.children === "Loading brands…",
  );
  assert.ok(loading.length > 0, "expected the brand section's loading state");

  await act(async () => {
    await flush();
  });
  unmount();
});

test("clicking a theme button applies the real theme command to every VisualNode in the document", async () => {
  const editor = makeEditor();
  const { firstKey, secondKey } = buildTwoVisualNodes(editor);
  const { renderer, unmount } = mount(editor);

  const oceanButton = findByAriaLabel(
    renderer,
    "Apply Ocean theme to all visuals",
  );
  assert.ok(oceanButton, "expected the Ocean theme button");

  await act(async () => {
    (oceanButton?.props as { onClick: () => void }).onClick();
    await flush();
  });

  const oceanColors = STYLE_THEMES.find((t) => t.id === "ocean")!.colors;
  const firstVisual = readVisual(editor, firstKey);
  const secondVisual = readVisual(editor, secondKey);
  assert.equal(firstVisual?.style.nodeFill, oceanColors.nodeFill);
  assert.equal(firstVisual?.style.nodeStroke, oceanColors.nodeStroke);
  assert.deepEqual(firstVisual?.style.palette, oceanColors.palette);
  assert.equal(secondVisual?.style.nodeFill, oceanColors.nodeFill);
  assert.equal(secondVisual?.style.background, oceanColors.background);

  await act(async () => {
    await flush();
  });
  unmount();
});

test("BrandSection renders nothing once loaded with zero brands (successful, empty response)", async () => {
  fetchImpl = () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ brands: [] }) });
  const editor = makeEditor();
  const { renderer, unmount } = mount(editor);

  await act(async () => {
    await flush();
  });

  const brandHeader = renderer.root.findAll(
    (node) => node.props.children === "Brand — all visuals",
  );
  assert.equal(
    brandHeader.length,
    0,
    "BrandSection should render nothing once done loading with no brands",
  );
  const loading = renderer.root.findAll(
    (node) => node.props.children === "Loading brands…",
  );
  assert.equal(loading.length, 0);

  unmount();
});

test("BrandSection swallows a fetch rejection and ends up rendering nothing (no unhandled error)", async () => {
  fetchImpl = () => Promise.reject(new Error("network down"));
  const editor = makeEditor();
  const { renderer, unmount } = mount(editor);

  await act(async () => {
    await flush();
  });

  const brandHeader = renderer.root.findAll(
    (node) => node.props.children === "Brand — all visuals",
  );
  assert.equal(brandHeader.length, 0);

  unmount();
});

test("BrandSection swallows a non-ok response and ends up rendering nothing", async () => {
  fetchImpl = () =>
    Promise.resolve({
      ok: false,
      json: () => Promise.resolve({}),
    });
  const editor = makeEditor();
  const { renderer, unmount } = mount(editor);

  await act(async () => {
    await flush();
  });

  const brandHeader = renderer.root.findAll(
    (node) => node.props.children === "Brand — all visuals",
  );
  assert.equal(brandHeader.length, 0);

  unmount();
});

test("clicking a brand button (Google Font path) loads the font <link> once and rebrands every VisualNode", async () => {
  fetchImpl = () =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ brands: [brandFixture] }),
    });
  const editor = makeEditor();
  const { firstKey, secondKey } = buildTwoVisualNodes(editor);
  const { renderer, unmount } = mount(editor);

  await act(async () => {
    await flush();
  });

  const brandButton = findByAriaLabel(
    renderer,
    "Apply brand Acme to all visuals",
  );
  assert.ok(brandButton, "expected the Acme brand button once loaded");

  await act(async () => {
    (brandButton?.props as { onClick: () => void }).onClick();
    await flush();
  });

  assert.equal(appendedHeadNodes.length, 1);
  assert.equal(appendedHeadNodes[0]?.id, "gfont-brand-inter");
  assert.match(
    String(appendedHeadNodes[0]?.href ?? ""),
    /fonts\.googleapis\.com/,
  );

  const firstVisual = readVisual(editor, firstKey);
  const secondVisual = readVisual(editor, secondKey);
  assert.equal(firstVisual?.style.fontFamily, "'Inter', sans-serif");
  assert.equal(secondVisual?.style.fontFamily, "'Inter', sans-serif");

  // Re-clicking must not append a second <link> (getElementById guard).
  await act(async () => {
    (brandButton?.props as { onClick: () => void }).onClick();
    await flush();
  });
  assert.equal(
    appendedHeadNodes.length,
    1,
    "the font <link> must only be appended once",
  );

  unmount();
});

test("clicking a brand button with a custom font asset (no matching Google Font) injects a <style> @font-face rule", async () => {
  const customBrand: BrandStyle = {
    ...brandFixture,
    id: "brand-2",
    name: "Customco",
    fontFamily: "'MyCustomFont', sans-serif",
    fontAssetUrl: "https://example.com/assets/font.woff2" as never,
  };
  fetchImpl = () =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ brands: [customBrand] }),
    });
  const editor = makeEditor();
  const { renderer, unmount } = mount(editor);

  await act(async () => {
    await flush();
  });

  const brandButton = findByAriaLabel(
    renderer,
    "Apply brand Customco to all visuals",
  );
  assert.ok(brandButton, "expected the Customco brand button once loaded");

  await act(async () => {
    (brandButton?.props as { onClick: () => void }).onClick();
    await flush();
  });

  assert.equal(appendedHeadNodes.length, 1);
  assert.equal(appendedHeadNodes[0]?.id, "brand-font-brand-2");
  assert.match(String(appendedHeadNodes[0]?.textContent ?? ""), /@font-face/);

  unmount();
});
