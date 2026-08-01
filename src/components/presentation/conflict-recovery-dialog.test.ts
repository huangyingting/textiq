import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE } from "@/lib/presentation/conflict-recovery-reload";
import type { Deck } from "@/lib/presentation/schema";
import { buildMinimalDeck } from "@/test/builders/presentation-deck";
import { createReactRenderHarness } from "@/test/react-render-harness";
import {
  ConflictRecoveryDialog,
  resolveConflictOperation,
} from "./conflict-recovery-dialog";

type ElementLike = ReactElement<Record<string, unknown>>;

function createHookRenderer() {
  return createReactRenderHarness({
    idPrefix: "fake-react-id",
    preferServerSnapshot: true,
  });
}

function collectElements(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
  collected: ElementLike[] = [],
): ElementLike[] {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, predicate, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  if (predicate(element)) collected.push(element);
  const props = element.props as { children?: ReactNode };
  collectElements(props.children, predicate, collected);
  return collected;
}

function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (!isValidElement(node)) return "";
  const props = node.props as { children?: ReactNode };
  return flattenText(props.children);
}

function findButtonByLabel(
  root: ReactNode,
  label: string,
): ElementLike | undefined {
  return collectElements(root, (element) => {
    if (typeof element.props.onClick !== "function") return false;
    return flattenText(element.props.children as ReactNode).trim() === label;
  })[0];
}

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function renderDialog(
  hookRenderer: ReturnType<typeof createHookRenderer>,
  {
    open = true,
    deck = buildMinimalDeck(),
    onKeepMine = async () => undefined,
    onUseTheirs = async () => undefined,
    onDismiss = () => undefined,
  }: {
    open?: boolean;
    deck?: Deck;
    onKeepMine?: (
      localDeck: Deck,
      serverRevisionToken: string | null,
    ) => Promise<void>;
    onUseTheirs?: () => Promise<void>;
    onDismiss?: () => void;
  } = {},
): ReactNode {
  return hookRenderer.run(() =>
    ConflictRecoveryDialog({
      open,
      localDeck: deck,
      serverRevisionToken: "server-rev-2",
      onKeepMine,
      onUseTheirs,
      onDismiss,
    }),
  );
}

describe("ConflictRecoveryDialog", () => {
  test("renders conflict resolution actions", () => {
    const hookRenderer = createHookRenderer();
    const tree = renderDialog(hookRenderer);
    const text = flattenText(tree);

    assert.match(text, /Save conflict detected/);
    assert.match(text, /Keep my version/);
    assert.match(text, /Use server version/);
    assert.match(text, /Dismiss — keep editing \(conflict may recur\)/);
  });

  test("surfaces keep-mine failure state", async () => {
    const hookRenderer = createHookRenderer();
    const deck = buildMinimalDeck();
    let keepMineCalls = 0;

    let tree = renderDialog(hookRenderer, {
      deck,
      onKeepMine: async () => {
        keepMineCalls += 1;
        throw new Error("network down");
      },
    });
    const keepMineButton = findButtonByLabel(tree, "Keep my version");
    const clickKeepMine = keepMineButton?.props.onClick as
      (() => void) | undefined;
    assert.equal(typeof clickKeepMine, "function");
    clickKeepMine?.();
    await waitForAsyncDrain();

    tree = renderDialog(hookRenderer, { deck });
    assert.equal(keepMineCalls, 1);
    assert.match(
      flattenText(tree),
      /Couldn't save your version\. Check your connection and retry\./,
    );
    (
      findButtonByLabel(tree, "Dismiss")?.props.onClick as
        (() => void) | undefined
    )?.();
    tree = renderDialog(hookRenderer, { deck });
    assert.doesNotMatch(flattenText(tree), /Couldn't save your version/);
  });

  test("surfaces use-theirs reload failure state", async () => {
    const hookRenderer = createHookRenderer();
    const deck = buildMinimalDeck();
    let useTheirsCalls = 0;

    let tree = renderDialog(hookRenderer, {
      deck,
      onUseTheirs: async () => {
        useTheirsCalls += 1;
        throw new Error("reload failed");
      },
    });
    const useTheirsButton = findButtonByLabel(tree, "Use server version");
    const clickUseTheirs = useTheirsButton?.props.onClick as
      (() => void) | undefined;
    assert.equal(typeof clickUseTheirs, "function");
    clickUseTheirs?.();
    await waitForAsyncDrain();

    tree = renderDialog(hookRenderer, { deck });
    assert.equal(useTheirsCalls, 1);
    assert.match(
      flattenText(tree),
      new RegExp(CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE),
    );
  });

  test("one synchronous operation boundary suppresses duplicate and competing resolution actions", async () => {
    const hookRenderer = createHookRenderer();
    const deck = buildMinimalDeck();
    let keepMineCalls = 0;
    let useTheirsCalls = 0;
    let dismissCalls = 0;
    let resolveKeepMine!: () => void;
    const onKeepMine = () => {
      keepMineCalls += 1;
      return new Promise<void>((resolve) => {
        resolveKeepMine = resolve;
      });
    };
    const onUseTheirs = async () => {
      useTheirsCalls += 1;
    };
    const onDismiss = () => {
      dismissCalls += 1;
    };

    let tree = renderDialog(hookRenderer, {
      deck,
      onKeepMine,
      onUseTheirs,
      onDismiss,
    });
    const keepMine = findButtonByLabel(tree, "Keep my version");
    const useTheirs = findButtonByLabel(tree, "Use server version");
    const clickKeepMine = keepMine?.props.onClick as (() => void) | undefined;
    const clickUseTheirs = useTheirs?.props.onClick as (() => void) | undefined;
    clickKeepMine?.();
    clickKeepMine?.();
    clickUseTheirs?.();

    assert.equal(keepMineCalls, 1);
    assert.equal(useTheirsCalls, 0);

    tree = renderDialog(hookRenderer, {
      deck,
      onKeepMine,
      onUseTheirs,
      onDismiss,
    });
    assert.equal((tree as ElementLike).props["aria-busy"], true);
    assert.equal(findButtonByLabel(tree, "Saving…")?.props.disabled, true);
    assert.equal(
      findButtonByLabel(tree, "Use server version")?.props.disabled,
      true,
    );
    ((tree as ElementLike).props.onClose as () => void)();
    assert.equal(dismissCalls, 0);

    resolveKeepMine();
    await waitForAsyncDrain();
    tree = renderDialog(hookRenderer, {
      deck,
      onKeepMine,
      onUseTheirs,
      onDismiss,
    });
    assert.equal((tree as ElementLike).props["aria-busy"], false);
    assert.equal(
      findButtonByLabel(tree, "Keep my version")?.props.disabled,
      false,
    );
  });

  test("closing and reopening invalidates an older pending conflict operation and its late failure", async () => {
    const hookRenderer = createHookRenderer();
    const oldAttempt = deferred<void>();
    const oldDeck = buildMinimalDeck();
    const replacementDeck = buildMinimalDeck();
    let oldCalls = 0;
    const onKeepMine = () => {
      oldCalls += 1;
      return oldAttempt.promise;
    };

    let tree = renderDialog(hookRenderer, { deck: oldDeck, onKeepMine });
    (
      findButtonByLabel(tree, "Keep my version")?.props.onClick as
        (() => void) | undefined
    )?.();
    assert.equal(oldCalls, 1);

    renderDialog(hookRenderer, { open: false, deck: oldDeck, onKeepMine });
    tree = renderDialog(hookRenderer, {
      deck: replacementDeck,
      onKeepMine: async () => undefined,
    });
    const reopenedKeepMine = findButtonByLabel(tree, "Keep my version");
    assert.ok(reopenedKeepMine);
    assert.notEqual(reopenedKeepMine.props.disabled, true);

    oldAttempt.reject(new Error("old conflict failed"));
    await waitForAsyncDrain();
    tree = renderDialog(hookRenderer, {
      deck: replacementDeck,
      onKeepMine: async () => undefined,
    });

    assert.doesNotMatch(
      flattenText(tree),
      /Couldn't save your version\. Check your connection and retry\./,
    );
  });

  test("Next navigation control flow escapes conflict recovery feedback", async () => {
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    await assert.rejects(
      () =>
        resolveConflictOperation(
          () => Promise.reject(redirectError),
          "fallback should not be returned",
        ),
      (error: unknown) => error === redirectError,
    );
  });
});
