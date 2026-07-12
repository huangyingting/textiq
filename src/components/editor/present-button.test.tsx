/**
 * Direct contract coverage for `PresentButton` (issue #1933).
 *
 * `prepareDeckForOpen` (the deck-fetch/validate/fallback decision) already
 * has full pure-function coverage in `deck-open-preparation.test.ts`, so
 * this file focuses on the component's own wiring: the toolbar button's
 * accessible label/disabled/pending state, the loading state around the
 * async `handlePresent` call, composing the correct child (`PresentMode` on
 * success, the local `PresentOpenRecovery` dialog on failure) with the right
 * props, and the close callback resetting state.
 *
 * `createReactRenderHarness().run()` renders `PresentButton` on a real fiber
 * (so hooks execute for real and persist across calls) but never deep-
 * reconciles the returned element tree — so the real, heavy `<PresentMode>`
 * child is captured as a plain, un-executed element descriptor instead of
 * being mounted. `PresentOpenRecovery` is a small local function with no
 * hooks, so its element's `.type` (the function itself) can be invoked
 * directly to inspect its rendered markup without any source changes.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { act } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";

import { buildMinimalDeck } from "@/test/builders/presentation-deck";
import { createReactRenderHarness } from "@/test/react-render-harness";

import type { FetchDeckResult } from "@/lib/document/persistence-types";
import { createBlankDeck } from "@/lib/presentation/empty-deck";
import { PresentMode } from "@/components/presentation/present-mode";

import { PresentButton } from "./present-button";

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function createDeferred<T>() {
  let resolve: ((value: T) => void) | null = null;
  let reject: ((reason: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (reason: unknown) => reject?.(reason),
  };
}

function stubDeckPort(
  fetchDeckJson: (documentId: string) => Promise<FetchDeckResult>,
) {
  return { fetchDeckJson };
}

type ElementLike = ReactElement<Record<string, unknown>>;

function fragmentChildren(node: ReactNode): ElementLike[] {
  if (!isValidElement(node)) return [];
  const children = (node.props as { children?: ReactNode }).children;
  const list = Array.isArray(children) ? children : [children];
  return list.filter((child): child is ElementLike => isValidElement(child));
}

function collectElements(node: ReactNode, collected: ElementLike[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  collected.push(element);
  collectElements(
    (element.props as { children?: ReactNode }).children,
    collected,
  );
  return collected;
}

function findButton(tree: ReactNode): ElementLike {
  // `<EditorToolbarButton>` is always the first child of the returned
  // fragment (the composed `PresentMode`/`PresentOpenRecovery` slots follow).
  const [button] = fragmentChildren(tree);
  assert.ok(button, "expected the EditorToolbarButton element");
  return button;
}

function clickPresentButton(tree: ReactNode): Promise<void> {
  return (findButton(tree).props.onClick as () => Promise<void>)();
}

function findByType(tree: ReactNode, type: unknown): ElementLike | undefined {
  return fragmentChildren(tree).find((element) => element.type === type);
}

describe("PresentButton", () => {
  test("idle render exposes an accessible, enabled toolbar button and no overlay", () => {
    const harness = createReactRenderHarness();
    try {
      const tree = harness.run(() =>
        PresentButton({
          documentId: "doc-1",
          deckPort: stubDeckPort(async () => ({
            ok: true,
            deckJson: null,
            revisionToken: null,
          })),
        }),
      );
      const button = findButton(tree);
      assert.equal(button.props.label, "Present");
      assert.equal(button.props.tooltip, "Present fullscreen");
      assert.equal(button.props["aria-label"], "Present document");
      assert.equal(button.props.disabled, false);
      assert.equal(button.props.iconOnly, false);
      assert.equal(fragmentChildren(tree).length, 1);
    } finally {
      harness.cleanup();
    }
  });

  test("uses the document title in the accessible label and forwards iconOnly", () => {
    const harness = createReactRenderHarness();
    try {
      const tree = harness.run(() =>
        PresentButton({
          documentId: "doc-1",
          documentTitle: "Q3 Board Deck",
          iconOnly: true,
          deckPort: stubDeckPort(async () => ({
            ok: true,
            deckJson: null,
            revisionToken: null,
          })),
        }),
      );
      const button = findButton(tree);
      assert.equal(button.props["aria-label"], "Present Q3 Board Deck");
      assert.equal(button.props.iconOnly, true);
    } finally {
      harness.cleanup();
    }
  });

  test("disables the button while the deck fetch is pending, then re-enables it", async () => {
    const harness = createReactRenderHarness();
    const deferred = createDeferred<FetchDeckResult>();
    let seenDocumentId: string | undefined;
    try {
      let tree = harness.run(() =>
        PresentButton({
          documentId: "doc-77",
          deckPort: stubDeckPort((documentId) => {
            seenDocumentId = documentId;
            return deferred.promise;
          }),
        }),
      );
      let clickResult: Promise<void> | undefined;
      act(() => {
        clickResult = clickPresentButton(tree);
      });
      tree = harness.run(() =>
        PresentButton({
          documentId: "doc-77",
          deckPort: stubDeckPort(() => deferred.promise),
        }),
      );
      assert.equal(findButton(tree).props.disabled, true);

      await act(async () => {
        deferred.resolve({ ok: true, deckJson: null, revisionToken: null });
        await clickResult;
        await waitForAsyncDrain();
      });
      tree = harness.run(() =>
        PresentButton({
          documentId: "doc-77",
          deckPort: stubDeckPort(() => deferred.promise),
        }),
      );
      assert.equal(findButton(tree).props.disabled, false);
      assert.equal(seenDocumentId, "doc-77");
    } finally {
      harness.cleanup();
    }
  });

  test("a missing saved deck falls back to a blank deck rendered through PresentMode", async () => {
    const harness = createReactRenderHarness();
    try {
      let tree = harness.run(() =>
        PresentButton({
          documentId: "doc-blank",
          documentTitle: "Untitled talk",
          deckPort: stubDeckPort(async () => ({
            ok: true,
            deckJson: null,
            revisionToken: "rev-0",
          })),
        }),
      );
      await act(async () => {
        await clickPresentButton(tree);
      });
      tree = harness.run(() =>
        PresentButton({
          documentId: "doc-blank",
          documentTitle: "Untitled talk",
          deckPort: stubDeckPort(async () => ({
            ok: true,
            deckJson: null,
            revisionToken: "rev-0",
          })),
        }),
      );
      const presentMode = findByType(tree, PresentMode);
      assert.ok(presentMode, "expected PresentMode to be composed");
      assert.deepEqual(
        presentMode!.props.deck,
        createBlankDeck({
          documentId: "doc-blank",
          title: "Untitled talk",
        }),
      );
      assert.deepEqual(presentMode!.props.visuals, {});
      assert.equal(typeof presentMode!.props.onClose, "function");
      assert.equal(findByType(tree, "PresentOpenRecovery"), undefined);
    } finally {
      harness.cleanup();
    }
  });

  test("an existing deck is opened through PresentMode with the resolved theme package and injected visuals", async () => {
    const harness = createReactRenderHarness();
    const deck = buildMinimalDeck();
    const visuals = { "visual-1": { id: "visual-1" } as unknown };
    try {
      let tree = harness.run(() =>
        PresentButton({
          documentId: "doc-9",
          deckPort: stubDeckPort(async () => ({
            ok: true,
            deckJson: deck,
            revisionToken: "rev-9",
          })),
          getVisuals: () => visuals as never,
        }),
      );
      await act(async () => {
        await clickPresentButton(tree);
      });
      tree = harness.run(() =>
        PresentButton({
          documentId: "doc-9",
          deckPort: stubDeckPort(async () => ({
            ok: true,
            deckJson: deck,
            revisionToken: "rev-9",
          })),
          getVisuals: () => visuals as never,
        }),
      );
      const presentMode = findByType(tree, PresentMode);
      assert.ok(presentMode);
      assert.deepEqual(presentMode!.props.deck, deck);
      assert.deepEqual(presentMode!.props.visuals, visuals);
      assert.ok(presentMode!.props.themePackage);

      // Closing resets the composed child.
      act(() => {
        (presentMode!.props.onClose as () => void)();
      });
      tree = harness.run(() =>
        PresentButton({
          documentId: "doc-9",
          deckPort: stubDeckPort(async () => ({
            ok: true,
            deckJson: deck,
            revisionToken: "rev-9",
          })),
          getVisuals: () => visuals as never,
        }),
      );
      assert.equal(findByType(tree, PresentMode), undefined);
    } finally {
      harness.cleanup();
    }
  });

  test("a rejected deck fetch recovers with a friendly diagnostic dialog, and Close resets state", async () => {
    const harness = createReactRenderHarness();
    try {
      let tree = harness.run(() =>
        PresentButton({
          documentId: "doc-err",
          deckPort: stubDeckPort(async () => {
            throw new Error("connection reset");
          }),
        }),
      );
      await act(async () => {
        await clickPresentButton(tree);
      });
      tree = harness.run(() =>
        PresentButton({
          documentId: "doc-err",
          deckPort: stubDeckPort(async () => {
            throw new Error("connection reset");
          }),
        }),
      );
      // No PresentMode composed while recovering.
      assert.equal(findByType(tree, PresentMode), undefined);
      const recovery = fragmentChildren(tree).find(
        (element) => typeof element.type === "function",
      );
      assert.ok(recovery, "expected the PresentOpenRecovery dialog element");
      const rendered = (recovery!.type as (props: unknown) => ReactNode)(
        recovery!.props,
      );
      const html = renderToStaticMarkup(rendered as ReactElement);
      assert.match(html, /role="dialog"/);
      assert.match(html, /aria-modal="true"/);
      assert.match(html, /Presentation deck could not be opened/);
      assert.match(
        html,
        /Check your connection and retry\.\s*\(connection reset\)/,
      );

      // The Close button in the recovery dialog wires back to onClose.
      const closeButton = collectElements(rendered).find(
        (element) => element.type === "button",
      );
      assert.ok(closeButton);
      act(() => {
        (closeButton!.props.onClick as () => void)();
      });
      tree = harness.run(() =>
        PresentButton({
          documentId: "doc-err",
          deckPort: stubDeckPort(async () => {
            throw new Error("connection reset");
          }),
        }),
      );
      assert.equal(fragmentChildren(tree).length, 1);
    } finally {
      harness.cleanup();
    }
  });
});
