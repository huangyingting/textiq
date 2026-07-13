/**
 * Direct behavior coverage for `GenerateVisualSection` (#1959).
 *
 * Mounted with a real `@lexical/headless` editor +
 * `LexicalComposerContext.Provider` + the real `EditorContextProvider`,
 * following the `use-editing-surface.test.ts` pattern — a genuine
 * non-collapsed text-range selection drives the real
 * `generateTargetForContext` (already exhaustively pinned by
 * `generate.test.ts`) instead of faking its output. `useVisualGeneration`
 * (already covered end-to-end by `use-visual-generation.test.ts`) also runs
 * for real; only the network boundary it calls through
 * (`requestVisualCandidates`'s injectable `fetch`) is stubbed here, via a
 * deferred `globalThis.fetch` so the in-flight "loading" render can be
 * observed before resolving.
 *
 * Covers: no-target null render, the button's idle/loading/regenerate label
 * states and `disabled` wiring, error + credit-error rendering with a
 * working retry, and `insertVisual`'s node-graph effect (a real VisualNode
 * inserted immediately after the target block, carrying the stamped source
 * text), the `generatedVisualsBySection` reset, and the `editor.focus()`
 * call — not pixel layout.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
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

import { Button } from "@/components/ui";
import { EditorContextProvider } from "@/lib/lexical/editor-context";
import { $isVisualNode, VisualNode } from "@/lib/lexical/visual-node";
import { FIXTURES } from "@/lib/visual/fixtures";

// Side effect only: flips on `IS_REACT_ACT_ENVIRONMENT` and installs the
// baseline `document`/`window` stubs `EditorContextProvider`'s effect needs.
import { createReactRenderHarness } from "@/test/react-render-harness";

import { GenerateVisualSection } from "./mobile-generate-visual-section";

createReactRenderHarness().run(() => null);

// `Tooltip` (wrapping every generated-candidate button) always calls
// `createPortal(tooltip, document.body)` once `document` exists, so `body`
// needs a `nodeType` react-dom's portal guard accepts.
(globalThis.document as unknown as { body: { nodeType: number } }).body = {
  nodeType: 1,
};

// The credit-error path renders a `next/link` "Upgrade" link, whose
// `useIntersection` prefetch effect calls the browser-only `self` global
// (via `requestIdleCallback`); polyfill it to `globalThis` for this suite so
// that effect resolves against Node's real `setTimeout` instead of throwing.
const globalForSelf = globalThis as unknown as Record<string, unknown>;
if (!("self" in globalForSelf)) {
  globalForSelf.self = globalThis;
}

function makeEditor(): LexicalEditor {
  const editor = createHeadlessEditor({
    namespace: "generate-visual-section-test",
    nodes: [VisualNode],
    onError(error) {
      throw error;
    },
  });
  editor.getRootElement = (() => null) as typeof editor.getRootElement;
  editor.getElementByKey = (() => null) as typeof editor.getElementByKey;
  return editor;
}

/** Selects the full text of a fresh paragraph, producing a real `"range"` ctx. */
function selectParagraphText(editor: LexicalEditor, text: string): string {
  let paragraphKey = "";
  act(() => {
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const textNode = $createTextNode(text);
        paragraph.append(textNode);
        $getRoot().clear().append(paragraph);
        textNode.select(0, text.length);
        paragraphKey = paragraph.getKey();
      },
      { discrete: true },
    );
  });
  return paragraphKey;
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
        createElement(
          EditorContextProvider,
          null,
          createElement(GenerateVisualSection),
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

// The main action button is the only `Button` component instance directly
// under `GenerateVisualSection` — candidate/upgrade/retry controls render as
// plain `<button>`/`Link` elements, so matching on the composite avoids
// ambiguity once candidates (each their own `<button type="button">`) exist.
function findButton(renderer: ReactTestRenderer) {
  return renderer.root.findByType(Button);
}

function fakeResponse(status: number, json: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => json };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flush(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

let originalFetch: typeof fetch;
let fetchCalls: { url: string; body: unknown }[];

before(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(
  handler: (
    body: unknown,
  ) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
) {
  fetchCalls = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    fetchCalls.push({ url: String(url), body });
    return handler(body);
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// No target — renders nothing
// ---------------------------------------------------------------------------

test("renders null when there is no selection to generate from", () => {
  const editor = makeEditor();
  const { renderer, unmount } = mount(editor);
  try {
    assert.equal(renderer.toJSON(), null);
  } finally {
    unmount();
  }
});

// ---------------------------------------------------------------------------
// Idle → loading → success (label switching + disabled wiring)
// ---------------------------------------------------------------------------

test("shows 'Generate visual', then a disabled 'Generating…' state while the request is in flight, then 'Regenerate' once candidates arrive", async () => {
  const editor = makeEditor();
  selectParagraphText(editor, "Turn this into a visual");
  const { renderer, unmount } = mount(editor);
  try {
    const idleButton = findButton(renderer);
    assert.equal(idleButton.props.disabled, false);
    assert.equal(idleButton.props.children, "Generate visual");

    const gate = deferred<{
      ok: boolean;
      status: number;
      json(): Promise<unknown>;
    }>();
    stubFetch(() => gate.promise);

    act(() => {
      findButton(renderer).props.onClick();
    });

    const loadingButton = findButton(renderer);
    assert.equal(loadingButton.props.disabled, true);
    assert.equal(loadingButton.props.children, "Generating…");
    assert.equal(fetchCalls.length, 1);
    assert.equal(
      (fetchCalls[0].body as { text: string }).text,
      "Turn this into a visual",
    );

    await act(async () => {
      gate.resolve(fakeResponse(200, { candidates: [FIXTURES.flowchart] }));
      await flush();
    });

    const doneButton = findButton(renderer);
    assert.equal(doneButton.props.disabled, false);
    assert.equal(doneButton.props.children, "Regenerate");

    const variationButtons = renderer.root.findAll(
      (node) =>
        typeof node.props["aria-label"] === "string" &&
        node.props["aria-label"].startsWith("Select variation"),
    );
    assert.equal(variationButtons.length, 1);
  } finally {
    unmount();
  }
});

// ---------------------------------------------------------------------------
// Error + credit-error rendering, with a working retry
// ---------------------------------------------------------------------------

test("renders a credit-error message with no retry button, and a generic error with a working 'Try again'", async () => {
  const editor = makeEditor();
  selectParagraphText(editor, "Needs credits");
  const { renderer, unmount } = mount(editor);
  try {
    stubFetch(async () => fakeResponse(402, { error: "Out of credits" }));

    await act(async () => {
      findButton(renderer).props.onClick();
      await flush();
    });

    const alert = renderer.root.findByProps({ role: "alert" });
    assert.match(
      String(alert.findByType("span").props.children),
      /Out of credits/,
    );
    assert.throws(() => renderer.root.findByProps({ children: "Try again" }));
    const upgradeLink = renderer.root.find(
      (node) => node.props.href === "/app/settings/billing",
    );
    assert.ok(upgradeLink, "expected an upgrade link for the credit error");

    stubFetch(async () => fakeResponse(500, { error: "Generation failed" }));
    await act(async () => {
      findButton(renderer).props.onClick();
      await flush();
    });

    const genericAlert = renderer.root.findByProps({ role: "alert" });
    assert.match(
      String(genericAlert.findByType("span").props.children),
      /Generation failed/,
    );
    const retryButton = renderer.root.findByProps({ children: "Try again" });

    stubFetch(async () =>
      fakeResponse(200, { candidates: [FIXTURES.flowchart] }),
    );
    await act(async () => {
      retryButton.props.onClick();
      await flush();
    });

    assert.equal(fetchCalls.length, 1);
    assert.throws(() => renderer.root.findByProps({ role: "alert" }));
  } finally {
    unmount();
  }
});

// ---------------------------------------------------------------------------
// insertVisual — real Lexical node-graph effect + reset + focus
// ---------------------------------------------------------------------------

test("choosing a candidate inserts a real VisualNode after the target block, stamps the source text, resets candidates, and refocuses the editor", async () => {
  const editor = makeEditor();
  const blockKey = selectParagraphText(editor, "  Source text with padding  ");
  const { renderer, unmount } = mount(editor);
  try {
    // `@lexical/headless`'s `createHeadlessEditor` overrides `focus` to
    // always throw ("focus is not supported in headless mode") — real,
    // non-headless editors don't do this, so this spy replaces it outright
    // (rather than delegating to the throwing original) purely to observe
    // that `insertVisual` calls it exactly once.
    let focusCalls = 0;
    editor.focus = (() => {
      focusCalls += 1;
    }) as typeof editor.focus;

    stubFetch(async () =>
      fakeResponse(200, { candidates: [FIXTURES.flowchart] }),
    );
    await act(async () => {
      findButton(renderer).props.onClick();
      await flush();
    });

    const candidateButton = renderer.root.findByProps({
      "aria-label": "Select variation 1 of 1",
    });

    // `insertVisual`'s `editor.update` is not `{ discrete: true }`, so Lexical
    // batches it via a microtask — flush before reading the resulting state.
    await act(async () => {
      candidateButton.props.onClick();
      await flush();
    });

    editor.getEditorState().read(() => {
      const target = $getNodeByKey(blockKey);
      assert.ok(target, "expected the target paragraph to still exist");
      const next = target?.getNextSibling();
      assert.ok(next && $isVisualNode(next), "expected an inserted VisualNode");
      if (next && $isVisualNode(next)) {
        assert.equal(next.getVisual().type, FIXTURES.flowchart.type);
        assert.equal(next.getVisual().sourceText, "Source text with padding");
      }
    });

    assert.equal(focusCalls, 1);

    const remainingVariations = renderer.root.findAll(
      (node) =>
        typeof node.props["aria-label"] === "string" &&
        node.props["aria-label"].startsWith("Select variation"),
    );
    assert.equal(
      remainingVariations.length,
      0,
      "expected generatedVisualsBySection to reset after inserting",
    );
  } finally {
    unmount();
  }
});
