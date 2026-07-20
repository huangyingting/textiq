/**
 * Shell control contract coverage for `DocumentExportButton` (#1933).
 *
 * `DocumentExportButton` only reads Lexical through `useLexicalComposerContext`
 * (`getEditorState().read()`/`.toJSON()`), so a real `@lexical/headless` editor
 * wired into a `LexicalComposerContext.Provider` (the same pattern
 * `use-insert-imported-markdown.test.ts` uses) is enough to mount it for real —
 * no jsdom, no `lexical-editor.tsx`. Coverage here stays scoped to the button's
 * own contract: menu visibility/open-close wiring, the exporting/disabled
 * state, PPTX entitlement gating (including the guarded no-op click), and the
 * async fetch-rejection recovery path that `fetchDeckJson` owns. It
 * deliberately never invokes the PDF/PPTX/infographic *generation* itself —
 * those dynamic imports are documented "browser-only" renderers
 * (`document-export-targets.ts`, `pptx-apply.ts`) with their own test
 * coverage, and running them would pull in jsPDF/PptxGenJS DOM dependencies
 * out of scope for this shell-control pass.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

import { createHeadlessEditor } from "@lexical/headless";
import {
  createLexicalComposerContext,
  LexicalComposerContext,
  type LexicalComposerContextWithEditor,
} from "@lexical/react/LexicalComposerContext";
import type { LexicalEditor } from "lexical";

// Imported for its module-level side effect only: it flips
// `IS_REACT_ACT_ENVIRONMENT` on, which `act()` requires.
import "@/test/react-render-harness";

import type { DeckFetchPort } from "@/lib/action-ports";
import { getEntitlements } from "@/lib/billing/catalog";

import { DocumentExportButton } from "./document-export-button";

function makeEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: "document-export-button-test",
    onError(error) {
      throw error;
    },
  });
}

function composerContextFor(
  editor: LexicalEditor,
): LexicalComposerContextWithEditor {
  return [editor, createLexicalComposerContext(null, null)];
}

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function createDeferred<T>() {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
  };
}

function stubDeckPort(fetchDeckJson: DeckFetchPort["fetchDeckJson"]) {
  return { fetchDeckJson } satisfies DeckFetchPort;
}

/** Minimal fake DOM so the outside-click/Escape effect can attach listeners. */
function installFakeDom(): () => void {
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      // `Tooltip` (wrapping every `EditorToolbarButton`) always calls
      // `createPortal(tooltip, document.body)` once `document` exists, so
      // `body` needs a `nodeType` react-dom's portal guard accepts.
      body: { nodeType: 1 },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
  return () => {
    if (previousDocument) {
      Object.defineProperty(globalThis, "document", previousDocument);
    } else {
      delete (globalThis as { document?: unknown }).document;
    }
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  };
}

type Props = Parameters<typeof DocumentExportButton>[0];

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    documentTitle: "Quarterly Report",
    documentId: "doc-1933",
    deckPort: stubDeckPort(async () => ({
      ok: false,
      deckJson: null,
      revisionToken: null,
      error: "no deck",
      failure: { code: "document_not_found", retryable: false },
    })),
    ...overrides,
  } as Props;
}

function mountButton(editor: LexicalEditor, props: Props): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      createElement(
        LexicalComposerContext.Provider,
        { value: composerContextFor(editor) },
        createElement(DocumentExportButton, props),
      ),
    );
  });
  return renderer;
}

/** Recursively flattens a `ReactTestInstance` subtree into visible text. */
function textOf(node: ReactTestInstance | string | number): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  return node.children.map(textOf).join("");
}

function findExportButton(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.find(
    (instance) =>
      instance.type === "button" &&
      instance.props["aria-label"] === "Export document",
  );
}

function findMenuItems(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll(
    (instance) => instance.props.role === "menuitem",
  );
}

function findPptxMenuItem(renderer: ReactTestRenderer): ReactTestInstance {
  const item = findMenuItems(renderer).find((instance) =>
    textOf(instance).includes("PPTX deck"),
  );
  assert.ok(item, "expected a PPTX deck menu item");
  return item;
}

describe("DocumentExportButton", () => {
  test("idle render exposes accessible button wiring and no open menu", () => {
    const renderer = mountButton(makeEditor(), baseProps());
    try {
      const button = findExportButton(renderer);
      assert.equal(button.props.disabled, false);
      assert.equal(button.props["aria-haspopup"], "menu");
      assert.equal(button.props["aria-expanded"], false);
      assert.equal(
        renderer.root.findAll((instance) => instance.props.role === "menu")
          .length,
        0,
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("clicking the button opens the export menu with document/infographic sections", () => {
    const restoreDom = installFakeDom();
    const renderer = mountButton(makeEditor(), baseProps());
    try {
      act(() => {
        findExportButton(renderer).props.onClick();
      });
      assert.equal(findExportButton(renderer).props["aria-expanded"], true);

      const menu = renderer.root.find(
        (instance) => instance.props.role === "menu",
      );
      assert.equal(menu.props["aria-label"], "Export document");

      const menuItemLabels = findMenuItems(renderer).map(textOf);
      assert.ok(
        menuItemLabels.some((label) => label.includes("PDF")),
        "expected a PDF menu item",
      );
      assert.ok(
        menuItemLabels.some((label) => label.includes("PPTX deck")),
        "expected a PPTX menu item",
      );
      assert.ok(
        menuItemLabels.some((label) => label.includes("Infographic PNG")),
        "expected an Infographic PNG menu item",
      );
      assert.ok(
        menuItemLabels.some((label) => label.includes("Infographic PDF")),
        "expected an Infographic PDF menu item",
      );
      assert.equal(
        renderer.root.findAll((instance) => instance.props.role === "status")
          .length,
        0,
        "expected no unreachable export warning status surface",
      );
    } finally {
      act(() => renderer.unmount());
      restoreDom();
    }
  });

  test("the mobile backdrop click closes the open menu", () => {
    const restoreDom = installFakeDom();
    const renderer = mountButton(makeEditor(), baseProps());
    try {
      act(() => {
        findExportButton(renderer).props.onClick();
      });
      assert.equal(findExportButton(renderer).props["aria-expanded"], true);

      // Exercise the backdrop's own close wiring
      // (`onClick={() => setIsOpen(false)}`).
      const backdrop = renderer.root.find(
        (instance) =>
          instance.type === "div" &&
          instance.props["aria-hidden"] === "true" &&
          typeof instance.props.onClick === "function",
      );
      act(() => {
        backdrop.props.onClick();
      });
      assert.equal(findExportButton(renderer).props["aria-expanded"], false);
    } finally {
      act(() => renderer.unmount());
      restoreDom();
    }
  });

  test("selecting an infographic width preset toggles aria-pressed", () => {
    const restoreDom = installFakeDom();
    const renderer = mountButton(makeEditor(), baseProps());
    try {
      act(() => {
        findExportButton(renderer).props.onClick();
      });

      const presetChips = renderer.root.findAll(
        (instance) =>
          instance.type === "button" &&
          typeof instance.props["aria-pressed"] === "boolean",
      );
      const defaultChip = presetChips.find(
        (chip) => chip.props["aria-pressed"] === true,
      );
      assert.ok(defaultChip, "expected a default active width preset");
      assert.equal(textOf(defaultChip), "1080px");

      const largerChip = presetChips.find((chip) => textOf(chip) === "1200px");
      assert.ok(largerChip, "expected the 1200px preset chip");
      assert.equal(largerChip.props["aria-pressed"], false);

      act(() => {
        largerChip.props.onClick();
      });

      const updatedChips = renderer.root.findAll(
        (instance) =>
          instance.type === "button" &&
          typeof instance.props["aria-pressed"] === "boolean",
      );
      assert.equal(
        updatedChips.find((chip) => textOf(chip) === "1080px")?.props[
          "aria-pressed"
        ],
        false,
      );
      assert.equal(
        updatedChips.find((chip) => textOf(chip) === "1200px")?.props[
          "aria-pressed"
        ],
        true,
      );
    } finally {
      act(() => renderer.unmount());
      restoreDom();
    }
  });

  test("PPTX menu item is disabled and guarded for free-tier entitlements", async () => {
    const restoreDom = installFakeDom();
    let fetchDeckJsonCalls = 0;
    const renderer = mountButton(
      makeEditor(),
      baseProps({
        deckPort: stubDeckPort(async () => {
          fetchDeckJsonCalls += 1;
          return {
            ok: true,
            deckJson: { schemaVersion: 1 },
            revisionToken: "rev-1",
            themeDiagnostics: [],
          };
        }),
      }),
    );
    try {
      act(() => {
        findExportButton(renderer).props.onClick();
      });
      const pptxItem = findPptxMenuItem(renderer);
      assert.equal(pptxItem.props.disabled, true);
      assert.equal(pptxItem.props["aria-disabled"], true);

      const menu = renderer.root.find(
        (instance) => instance.props.role === "menu",
      );
      assert.match(textOf(menu), /Plus \/ Pro/);
      assert.match(textOf(menu), /PPTX export requires Plus or Pro\./);

      // The guard (`if (!canPptx) return;`) makes the click a no-op: no
      // fetch, no menu close, no error surfaced.
      act(() => {
        pptxItem.props.onClick();
      });
      await waitForAsyncDrain();

      assert.equal(fetchDeckJsonCalls, 0);
      assert.equal(findExportButton(renderer).props["aria-expanded"], true);
      assert.equal(
        renderer.root.findAll((instance) => instance.props.role === "alert")
          .length,
        0,
      );
    } finally {
      act(() => renderer.unmount());
      restoreDom();
    }
  });

  test("a rejected deck fetch during PPTX export recovers with a friendly error", async () => {
    const restoreDom = installFakeDom();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ entitlements: getEntitlements("pro") }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const renderer = mountButton(
      makeEditor(),
      baseProps({
        deckPort: stubDeckPort(async () => {
          throw new Error("network unavailable");
        }),
      }),
    );
    try {
      // Flush the `useUserEntitlements` fetch effect so `canPptx` flips true.
      await act(async () => {
        await waitForAsyncDrain();
      });

      act(() => {
        findExportButton(renderer).props.onClick();
      });
      const pptxItem = findPptxMenuItem(renderer);
      assert.equal(pptxItem.props.disabled, false);

      await act(async () => {
        await pptxItem.props.onClick();
      });

      const alert = renderer.root.find(
        (instance) => instance.props.role === "alert",
      );
      assert.equal(
        textOf(alert),
        "PPTX export requires a current Deck presentation.",
      );
      // The menu closed and the button returned to its idle, enabled state.
      assert.equal(findExportButton(renderer).props["aria-expanded"], false);
      assert.equal(findExportButton(renderer).props.disabled, false);
    } finally {
      act(() => renderer.unmount());
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });

  test("PPTX export shows the exporting/disabled pending state before resolving", async () => {
    const restoreDom = installFakeDom();
    const deferred = createDeferred<{
      ok: true;
      deckJson: unknown;
      revisionToken: string | null;
      themeDiagnostics: [];
    }>();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ entitlements: getEntitlements("pro") }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const renderer = mountButton(
      makeEditor(),
      baseProps({
        deckPort: stubDeckPort(() => deferred.promise),
      }),
    );
    try {
      await act(async () => {
        await waitForAsyncDrain();
      });
      globalThis.fetch = originalFetch;

      act(() => {
        findExportButton(renderer).props.onClick();
      });
      const pptxItem = findPptxMenuItem(renderer);

      let settled: Promise<void> | undefined;
      act(() => {
        settled = pptxItem.props.onClick() as Promise<void> | undefined;
      });

      const pendingButton = findExportButton(renderer);
      assert.equal(pendingButton.props.disabled, true);
      assert.equal(textOf(pendingButton), "Exporting…");
      // Menu closed immediately when the export started.
      assert.equal(
        renderer.root.findAll((instance) => instance.props.role === "menu")
          .length,
        0,
      );

      deferred.resolve({
        ok: true,
        deckJson: { schemaVersion: 1 },
        revisionToken: "rev-1",
        themeDiagnostics: [],
      });
      await act(async () => {
        await settled;
      });

      const idleButton = findExportButton(renderer);
      assert.equal(idleButton.props.disabled, false);
    } finally {
      act(() => renderer.unmount());
      restoreDom();
    }
  });
});
