/**
 * Direct behavior coverage for `BlockSparkPlugin` (#1958).
 *
 * `BlockSparkPlugin` composes several already-independently-tested
 * collaborators: `useEditorContext` (selection descriptor + DOM rects,
 * `editor-context-provider.test.ts`), `useVisualGeneration` (the full
 * generate/success/failure/credit-error/reset state machine,
 * `use-visual-generation.test.ts`), and `GeneratedCandidatesPanel`/
 * `VisualRenderer`/`FloatingSurface` (shared UI primitives). This file
 * exercises the plugin's OWN wiring on top of those: gutter-button
 * visibility gating (editable + fine-pointer + a live target), opening the
 * panel and driving a REAL `generate()` call (there is no dependency
 * injection seam below the hook — `useVisualGeneration()` is called with no
 * action port override — so `globalThis.fetch` is stubbed directly, exactly
 * as `requestVisualCandidates`'s own injectable-`fetchImpl` design intends
 * for the network boundary), candidate selection inserting a real
 * `VisualNode` into the document, retry/credit-error rendering, the options
 * sub-panel (orientation/detail/stayCloserToText/rememberChoices — including
 * `rememberChoices`'s real effect of preserving `genOptions` across a
 * close/reopen), and the search/filter + category expand/collapse UI over
 * `VISUAL_KINDS`.
 *
 * Scope note: `BlockSparkPlugin` also tracks a *hovered/focused* block via
 * `editor.registerRootListener` + raw DOM `mousemove`/`pointerover`/
 * `focusin`/`mouseleave` listeners on the real contenteditable root. That
 * path would require a custom fake root element with real listener capture
 * (no existing test in the codebase exercises `registerRootListener`) and is
 * secondary to the plugin's core generate/pending/failure/result-action
 * contract this file targets; `makeEditor` stubs `registerRootListener` as a
 * no-op (avoiding `@lexical/headless`'s "not supported in headless mode"
 * throw) so `block` state simply never activates, and every scenario here
 * drives the plugin's target instead through the SAME selection-derived path
 * (`ctx.kind === "range"`) already proven in `floating-text-toolbar.test.tsx`
 * — `displayTarget` prioritizes a live selection over a hovered block
 * anyway. The DOM-hover path is a lighter-touch area flagged in the session
 * report rather than covered here.
 *
 * `editor.getRootElement()` is read at *render* time (not just inside an
 * effect, unlike `floating-text-toolbar.tsx`), so the fake-root override
 * must stay installed for a test's full lifetime (including any awaited
 * `generate()` resolution), not just its initial mount — this file's
 * `withNativeSelectionRect` is therefore async-aware (`run` may return a
 * promise) rather than the purely-synchronous helper of the same name in
 * `floating-text-toolbar.test.tsx`.
 *
 * The gutter button/panel both animate open/close via a raw `framer-motion`
 * `AnimatePresence`; its *exit* transition never resolves synchronously
 * under `react-test-renderer` (no real animation-frame clock) — matching
 * `floating-text-toolbar.test.tsx`/`insert-menu.test.tsx`'s precedent, this
 * file never asserts a "dialog unmounts after closing" transition within one
 * continuously-mounted render. Instead it asserts the discrete state that
 * *caused* the close (the inserted `VisualNode`, the `editor.focus` spy, or
 * the still-mounted gutter button's `aria-expanded` reverting to `false`).
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createElement } from "react";
import { act, type ReactTestRenderer } from "react-test-renderer";

import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
} from "lexical";

import { LexicalComposerContext } from "@lexical/react/LexicalComposerContext";

import { EditorContextProvider } from "@/lib/lexical/editor-context";
import { $isVisualNode, VisualNode } from "@/lib/lexical/visual-node";
import { FIXTURES } from "@/lib/visual/fixtures";
import { FloatingSurface } from "@/components/ui";

import {
  composerContextFor,
  flushEditor,
  installFakeDom,
  makeHeadlessEditor,
  mount,
  textOf,
  unmount,
  waitForAsyncDrain,
  withMatchMedia,
} from "@/test/lexical-component-harness";

import { BlockSparkPlugin } from "./block-spark";

/** Minimal `Response`-shaped payload accepted by `requestVisualCandidates`. */
type FakeFetchResponse = {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
};

/**
 * Headless editor with `VisualNode` registered (real insertion is asserted)
 * and `registerRootListener` stubbed to a non-throwing no-op — see the file
 * docblock's scope note for why the DOM-hover path is not exercised.
 */
function makeEditor(): LexicalEditor {
  const editor = makeHeadlessEditor({
    namespace: "block-spark-test",
    nodes: [VisualNode],
  });
  editor.registerRootListener = (() => () =>
    undefined) as typeof editor.registerRootListener;
  return editor;
}

/** Selects `[start, end)` of a fresh paragraph's text as a real range selection. */
function selectRange(
  editor: LexicalEditor,
  text: string,
  start: number,
  end: number,
) {
  act(() => {
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const textNode = $createTextNode(text);
        paragraph.append(textNode);
        $getRoot().clear().append(paragraph);
        textNode.select(start, end);
      },
      { discrete: true },
    );
  });
}

/**
 * Makes the native `window.getSelection()` report a non-collapsed selection
 * anchored inside a fake editor root (same technique as
 * `floating-text-toolbar.test.tsx`), and gives that root a real
 * `getBoundingClientRect()` so `leftGutterButtonLeft` resolves a non-null
 * gutter position. Async-aware: `run` may return a promise, and the
 * overrides stay installed until it settles (see file docblock).
 */
async function withNativeSelectionRect(
  editor: LexicalEditor,
  run: () => void | Promise<void>,
): Promise<void> {
  const fakeRootElement = {
    contains: () => true,
    getBoundingClientRect: () => ({
      top: 0,
      left: 200,
      right: 700,
      bottom: 800,
      width: 500,
      height: 800,
    }),
  } as unknown as HTMLElement;
  const originalGetRootElement = editor.getRootElement;
  editor.getRootElement = (() =>
    fakeRootElement) as typeof editor.getRootElement;

  const fakeWindow = globalThis.window as unknown as {
    getSelection: () => unknown;
  };
  const originalGetSelection = fakeWindow.getSelection;
  fakeWindow.getSelection = () => ({
    rangeCount: 1,
    isCollapsed: false,
    anchorNode: {},
    getRangeAt: () => ({
      getBoundingClientRect: () => ({
        top: 10,
        left: 220,
        right: 320,
        bottom: 40,
        width: 100,
        height: 30,
      }),
    }),
  });
  try {
    await run();
  } finally {
    editor.getRootElement = originalGetRootElement;
    fakeWindow.getSelection = originalGetSelection;
  }
}

/** A controllable `globalThis.fetch` stub queue for `/api/generate` requests. */
function fakeFetchQueue() {
  const responses: FakeFetchResponse[] = [];
  const calls: Array<{ url: string; body: unknown }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(init.body as string) : null,
    });
    const next = responses.shift();
    if (!next) {
      throw new Error("no fake fetch response queued");
    }
    return next as unknown as Response;
  }) as typeof fetch;
  return {
    calls,
    push: (response: FakeFetchResponse) => responses.push(response),
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function mountPlugin(editor: LexicalEditor): ReactTestRenderer {
  return mount(
    createElement(
      LexicalComposerContext.Provider,
      { value: composerContextFor(editor) },
      createElement(
        EditorContextProvider,
        null,
        createElement(BlockSparkPlugin),
      ),
    ),
  );
}

function findGutterButton(renderer: ReactTestRenderer) {
  const matches = renderer.root.findAll(
    (instance) =>
      instance.type === "button" &&
      typeof instance.props["aria-label"] === "string" &&
      (instance.props["aria-label"] as string).startsWith("Generate visual"),
  );
  return matches.length === 1 ? matches[0] : null;
}

function findDialogs(renderer: ReactTestRenderer) {
  return renderer.root.findAll(
    (instance) => instance.type === "div" && instance.props.role === "dialog",
  );
}

function findAlert(renderer: ReactTestRenderer) {
  const matches = renderer.root.findAll(
    (instance) => instance.type === "div" && instance.props.role === "alert",
  );
  return matches.length === 1 ? matches[0] : null;
}

function findCandidateButtons(renderer: ReactTestRenderer) {
  return renderer.root.findAll(
    (instance) =>
      instance.type === "button" &&
      typeof instance.props["aria-label"] === "string" &&
      (instance.props["aria-label"] as string).startsWith(
        "Insert generated visual",
      ),
  );
}

function findByAriaLabel(
  renderer: ReactTestRenderer,
  type: string,
  label: string,
) {
  return renderer.root.find(
    (instance) =>
      instance.type === type && instance.props["aria-label"] === label,
  );
}

/** Finds a button anywhere under `scope` whose rendered text equals `text` (labels are often nested in a `<span>`, not a direct child). */
function findButtonWithText(
  scope: { findAll: ReactTestRenderer["root"]["findAll"] },
  text: string,
) {
  const matches = scope.findAll(
    (instance) => instance.type === "button" && textOf(instance) === text,
  );
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one button with text "${text}", found ${matches.length}`,
    );
  }
  return matches[0];
}

function findRadio(renderer: ReactTestRenderer, label: string) {
  return renderer.root.find(
    (instance) =>
      instance.type === "button" &&
      instance.props.role === "radio" &&
      instance.props["aria-label"] === label,
  );
}

function visualNodeCount(editor: LexicalEditor): number {
  return editor.getEditorState().read(() => {
    let count = 0;
    for (const child of $getRoot().getChildren()) {
      if ($isVisualNode(child)) {
        count += 1;
      }
    }
    return count;
  });
}

describe("BlockSparkPlugin", () => {
  let restoreDom: (() => void) | null = null;
  let renderer: ReactTestRenderer | null = null;
  let fetchQueue: ReturnType<typeof fakeFetchQueue> | null = null;

  afterEach(() => {
    if (renderer) {
      unmount(renderer);
      renderer = null;
    }
    if (fetchQueue) {
      fetchQueue.restore();
      fetchQueue = null;
    }
    if (restoreDom) {
      restoreDom();
      restoreDom = null;
    }
  });

  test("renders nothing while the editor is not editable", async () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    editor.setEditable(false);
    await withNativeSelectionRect(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountPlugin(editor);
        selectRange(editor, "Hello world", 0, 5);
      });
      assert.equal(findGutterButton(renderer as ReactTestRenderer), null);
      assert.equal(findDialogs(renderer as ReactTestRenderer).length, 0);
    });
  });

  test("hides the gutter button with no selection and no hovered block", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    withMatchMedia(true, () => {
      renderer = mountPlugin(editor);
    });
    assert.equal(findGutterButton(renderer as ReactTestRenderer), null);
  });

  test("shows the gutter button with the selection-specific label for a live range selection on a fine pointer", async () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    await withNativeSelectionRect(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountPlugin(editor);
        selectRange(editor, "Hello world", 0, 5);
      });
      const button = findGutterButton(renderer as ReactTestRenderer);
      assert.ok(button, "expected the gutter button to be visible");
      assert.equal(
        button!.props["aria-label"],
        "Generate visual for selected text",
      );
    });
  });

  test("hides the gutter button on a coarse pointer even with a live selection", async () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    await withNativeSelectionRect(editor, () => {
      withMatchMedia(false, () => {
        renderer = mountPlugin(editor);
        selectRange(editor, "Hello world", 0, 5);
      });
      assert.equal(findGutterButton(renderer as ReactTestRenderer), null);
    });
  });

  test("clicking the gutter button opens the panel, marks it aria-expanded, and starts a real generate() request", async () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    fetchQueue = fakeFetchQueue();

    await withNativeSelectionRect(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountPlugin(editor);
        selectRange(editor, "Hello world", 0, 5);
      });

      const button = findGutterButton(renderer as ReactTestRenderer)!;
      assert.equal(button.props["aria-expanded"], false);

      act(() => {
        button.props.onClick();
      });

      assert.equal(fetchQueue!.calls.length, 1);
      assert.equal(fetchQueue!.calls[0].url, "/api/generate");
      assert.equal(
        (fetchQueue!.calls[0].body as { text?: string }).text,
        "Hello",
      );
      assert.equal(findDialogs(renderer as ReactTestRenderer).length, 1);
      assert.equal(
        (renderer as ReactTestRenderer).root.findByType(FloatingSurface).props
          .layer,
        "canvas",
      );
      const reopenedButton = findGutterButton(renderer as ReactTestRenderer)!;
      assert.equal(reopenedButton.props["aria-expanded"], true);
    });
  });

  test("a successful generation renders a candidate; choosing it inserts a real VisualNode, focuses the editor, and closes the panel (a second gutter click reopens it with a fresh request)", async () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    let focusCalls = 0;
    editor.focus = (() => {
      focusCalls += 1;
    }) as typeof editor.focus;
    fetchQueue = fakeFetchQueue();
    fetchQueue.push({
      ok: true,
      json: async () => ({ candidates: [FIXTURES.list] }),
    });

    await withNativeSelectionRect(editor, async () => {
      withMatchMedia(true, () => {
        renderer = mountPlugin(editor);
        selectRange(editor, "Hello world", 0, 5);
      });

      const button = findGutterButton(renderer as ReactTestRenderer)!;
      act(() => {
        button.props.onClick();
      });

      await act(async () => {
        await waitForAsyncDrain();
      });

      const candidates = findCandidateButtons(renderer as ReactTestRenderer);
      assert.equal(candidates.length, 1);
      assert.equal(visualNodeCount(editor), 0);

      // `insertVisual`'s `editor.update()` is not `{ discrete: true }`;
      // flushing inside the same `act()` forces it to commit synchronously
      // so the read below observes the inserted `VisualNode`.
      act(() => {
        candidates[0].props.onClick();
        flushEditor(editor);
      });

      assert.equal(focusCalls, 1);
      assert.equal(visualNodeCount(editor), 1);

      // `insertVisual` calls `closePanel()`, setting `openKey` back to
      // `null`. `FloatingSurface` animates its close via a raw
      // `AnimatePresence`, whose exit transition never resolves
      // synchronously under `react-test-renderer` (no real animation-frame
      // clock) -- matching `floating-text-toolbar.test.tsx` and
      // `insert-menu.test.tsx`'s precedent, this asserts the discrete state
      // that *caused* the close (the still-mounted gutter button's
      // `aria-expanded` reflecting `openKey === displayTarget.key`) rather
      // than the exiting dialog's unmount.
      const buttonAfterInsert = findGutterButton(
        renderer as ReactTestRenderer,
      )!;
      assert.equal(buttonAfterInsert.props["aria-expanded"], false);

      // ...and because the panel is now closed, a second click on the
      // (still-visible, selection-anchored) gutter button does not toggle it
      // shut again -- it starts a brand-new generate() request instead.
      const callCountAfterInsert = fetchQueue!.calls.length;
      const buttonAgain = findGutterButton(renderer as ReactTestRenderer)!;
      act(() => {
        buttonAgain.props.onClick();
      });
      assert.equal(fetchQueue!.calls.length, callCountAfterInsert + 1);
    });
  });

  test("a failed generation renders a retryable alert; Try again re-issues the same request", async () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    fetchQueue = fakeFetchQueue();
    fetchQueue.push({
      ok: false,
      status: 500,
      json: async () => ({ error: "Something went wrong" }),
    });

    await withNativeSelectionRect(editor, async () => {
      withMatchMedia(true, () => {
        renderer = mountPlugin(editor);
        selectRange(editor, "Hello world", 0, 5);
      });

      const button = findGutterButton(renderer as ReactTestRenderer)!;
      act(() => {
        button.props.onClick();
      });
      await act(async () => {
        await waitForAsyncDrain();
      });

      const alert = findAlert(renderer as ReactTestRenderer);
      assert.ok(alert, "expected an error alert");
      assert.match(textOf(alert!), /Something went wrong/);

      fetchQueue!.push({
        ok: true,
        json: async () => ({ candidates: [FIXTURES.list] }),
      });
      const retryButton = findButtonWithText(renderer!.root, "Try again");
      act(() => {
        retryButton.props.onClick();
      });
      assert.equal(fetchQueue!.calls.length, 2);
      assert.deepEqual(fetchQueue!.calls[1].body, fetchQueue!.calls[0].body);

      await act(async () => {
        await waitForAsyncDrain();
      });
      assert.equal(
        findCandidateButtons(renderer as ReactTestRenderer).length,
        1,
      );
    });
  });

  test("a credit/quota error (402) renders the Upgrade link", async () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    fetchQueue = fakeFetchQueue();
    fetchQueue.push({
      ok: false,
      status: 402,
      json: async () => ({ error: "You're out of credits" }),
    });
    // `next/link`'s `Link` (used for the "Upgrade" affordance) throws
    // "self is not defined" under react-test-renderer (no jsdom) — its
    // `useIntersection` prefetch effect falls back to `next`'s
    // `request-idle-callback` shim, which references the free variable
    // `self` unconditionally once its own `typeof self` guard fails.
    const originalSelf = (globalThis as { self?: unknown }).self;
    (globalThis as { self?: unknown }).self = globalThis;

    try {
      await withNativeSelectionRect(editor, async () => {
        withMatchMedia(true, () => {
          renderer = mountPlugin(editor);
          selectRange(editor, "Hello world", 0, 5);
        });

        const button = findGutterButton(renderer as ReactTestRenderer)!;
        act(() => {
          button.props.onClick();
        });
        await act(async () => {
          await waitForAsyncDrain();
        });

        const alert = findAlert(renderer as ReactTestRenderer);
        assert.ok(alert, "expected an error alert");
        const upgradeLinks = renderer!.root.findAll(
          (instance) => instance.type === "a",
        );
        assert.equal(upgradeLinks.length, 1);
        assert.equal(upgradeLinks[0].props.href, "/app/settings/billing");
      });
    } finally {
      (globalThis as { self?: unknown }).self = originalSelf;
    }
  });

  test("the options panel toggles orientation/detail/stayCloserToText, and Remember my choices preserves genOptions across close/reopen", async () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    fetchQueue = fakeFetchQueue();

    await withNativeSelectionRect(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountPlugin(editor);
        selectRange(editor, "Hello world", 0, 5);
      });

      const button = findGutterButton(renderer as ReactTestRenderer)!;
      act(() => {
        button.props.onClick();
      });

      const optionsButton = findByAriaLabel(
        renderer as ReactTestRenderer,
        "button",
        "Generation options",
      );
      act(() => {
        optionsButton.props.onClick();
      });

      const orientationGroup = findByAriaLabel(
        renderer as ReactTestRenderer,
        "div",
        "Visual orientation",
      );
      assert.equal(orientationGroup.props.role, "radiogroup");
      const landscapeOption = findButtonWithText(orientationGroup, "Landscape");
      assert.equal(landscapeOption.props["aria-checked"], false);

      const checkboxes = () =>
        renderer!.root.findAll(
          (instance) =>
            instance.type === "input" && instance.props.type === "checkbox",
        );
      const rememberCheckbox = checkboxes()[1];
      act(() => {
        rememberCheckbox.props.onChange({ target: { checked: true } });
      });

      act(() => {
        landscapeOption.props.onClick();
      });

      const stayCloserCheckbox = checkboxes()[0];
      assert.equal(stayCloserCheckbox.props.checked, false);
      act(() => {
        stayCloserCheckbox.props.onChange({ target: { checked: true } });
      });
      assert.equal(checkboxes()[0].props.checked, true);

      const updatedLandscapeOption = findButtonWithText(
        findByAriaLabel(
          renderer as ReactTestRenderer,
          "div",
          "Visual orientation",
        ),
        "Landscape",
      );
      assert.equal(updatedLandscapeOption.props["aria-checked"], true);

      // Close (rememberChoices=true keeps genOptions) and reopen: the
      // orientation choice should have survived the reset.
      const closeButton = findByAriaLabel(
        renderer as ReactTestRenderer,
        "button",
        "Close",
      );
      act(() => {
        closeButton.props.onClick();
      });
      const reopenButton = findGutterButton(renderer as ReactTestRenderer)!;
      act(() => {
        reopenButton.props.onClick();
      });
      const reopenedOptionsButton = findByAriaLabel(
        renderer as ReactTestRenderer,
        "button",
        "Generation options",
      );
      act(() => {
        reopenedOptionsButton.props.onClick();
      });
      const reopenedLandscape = findButtonWithText(
        findByAriaLabel(
          renderer as ReactTestRenderer,
          "div",
          "Visual orientation",
        ),
        "Landscape",
      );
      assert.equal(
        reopenedLandscape.props["aria-checked"],
        true,
        "expected genOptions.orientation to survive close/reopen when rememberChoices is set",
      );
    });
  });

  test("searching narrows the visual-kind categories and shows an empty state for an unmatched query", async () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    fetchQueue = fakeFetchQueue();

    await withNativeSelectionRect(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountPlugin(editor);
        selectRange(editor, "Hello world", 0, 5);
      });

      const button = findGutterButton(renderer as ReactTestRenderer)!;
      act(() => {
        button.props.onClick();
      });

      const searchInput = findByAriaLabel(
        renderer as ReactTestRenderer,
        "input",
        "Search visual types",
      );

      act(() => {
        searchInput.props.onChange({ target: { value: "flowchart" } });
      });
      const radiogroups = renderer!.root.findAll(
        (instance) => instance.props.role === "radiogroup",
      );
      // "AI generated visual types" hides ("flowchart" is not an auto-type
      // search hit); only the Process category's radiogroup (flowchart's
      // category) should remain among the visual-kind groups.
      const visualKindGroups = radiogroups.filter((instance) =>
        (instance.props["aria-label"] as string | undefined)?.endsWith(
          "generated visual types",
        ),
      );
      assert.equal(visualKindGroups.length, 1);
      assert.equal(
        visualKindGroups[0].props["aria-label"],
        "Process generated visual types",
      );

      act(() => {
        searchInput.props.onChange({ target: { value: "zzz-no-match" } });
      });
      const emptyMessages = renderer!.root.findAll(
        (instance) =>
          instance.type === "p" &&
          textOf(instance) === "No visual types match this search.",
      );
      assert.equal(emptyMessages.length, 1);
    });
  });

  test("expanding a collapsed category reveals its visual-kind radiogroup", async () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    fetchQueue = fakeFetchQueue();

    await withNativeSelectionRect(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountPlugin(editor);
        selectRange(editor, "Hello world", 0, 5);
      });

      const button = findGutterButton(renderer as ReactTestRenderer)!;
      act(() => {
        button.props.onClick();
      });

      // "Data" is not in `DEFAULT_EXPANDED_VISUAL_CATEGORIES`, so it starts
      // collapsed.
      const dataHeader = findButtonWithText(renderer!.root, "Data");
      assert.equal(dataHeader.props["aria-expanded"], false);
      assert.equal(
        renderer!.root.findAll(
          (instance) =>
            instance.props["aria-label"] === "Data generated visual types",
        ).length,
        0,
      );

      act(() => {
        dataHeader.props.onClick();
      });

      const reopenedDataHeader = findButtonWithText(renderer!.root, "Data");
      assert.equal(reopenedDataHeader.props["aria-expanded"], true);
      assert.equal(
        renderer!.root.findAll(
          (instance) =>
            instance.props["aria-label"] === "Data generated visual types",
        ).length,
        1,
      );
    });
  });

  test("choosing a visual kind while the panel is open updates genOptions and triggers a fresh generate() request", async () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    fetchQueue = fakeFetchQueue();

    await withNativeSelectionRect(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountPlugin(editor);
        selectRange(editor, "Hello world", 0, 5);
      });

      const button = findGutterButton(renderer as ReactTestRenderer)!;
      act(() => {
        button.props.onClick();
      });
      assert.equal(fetchQueue!.calls.length, 1);

      const autoRadio = findRadio(
        renderer as ReactTestRenderer,
        "Auto visual type",
      );
      assert.equal(autoRadio.props["aria-checked"], true);

      act(() => {
        autoRadio.props.onClick();
      });
      // Re-choosing the already-active "Auto" type still re-generates
      // (there is no dedupe on the type-radio path, unlike the gutter
      // button's toggle-to-close behavior).
      assert.equal(fetchQueue!.calls.length, 2);
    });
  });
});
