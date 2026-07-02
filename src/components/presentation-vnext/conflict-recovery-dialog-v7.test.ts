import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE } from "@/lib/presentation-vnext/conflict-recovery-reload-v7";
import type { DeckV7 } from "@/lib/presentation-vnext/schema";
import { buildMinimalDeckV7 } from "@/test/builders/deck-v7";
import { createReactHookRenderer } from "@/test/react-server-renderer";
import { ConflictRecoveryDialogV7 } from "./conflict-recovery-dialog-v7";

type ElementLike = ReactElement<Record<string, unknown>>;

function createHookRenderer() {
  return createReactHookRenderer({
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

function renderDialog(
  hookRenderer: ReturnType<typeof createHookRenderer>,
  {
    deck = buildMinimalDeckV7(),
    onKeepMine = async () => undefined,
    onUseTheirs = async () => undefined,
    onDismiss = () => undefined,
  }: {
    deck?: DeckV7;
    onKeepMine?: (
      localDeck: DeckV7,
      serverRevisionToken: string | null,
    ) => Promise<void>;
    onUseTheirs?: () => Promise<void>;
    onDismiss?: () => void;
  } = {},
): ReactNode {
  return hookRenderer.run(() =>
    ConflictRecoveryDialogV7({
      open: true,
      localDeck: deck,
      serverRevisionToken: "server-rev-2",
      onKeepMine,
      onUseTheirs,
      onDismiss,
    }),
  );
}

describe("ConflictRecoveryDialogV7", () => {
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
    let keepMineCalls = 0;

    let tree = renderDialog(hookRenderer, {
      onKeepMine: async () => {
        keepMineCalls += 1;
        throw new Error("network down");
      },
    });
    const keepMineButton = findButtonByLabel(tree, "Keep my version");
    const clickKeepMine = keepMineButton?.props.onClick as
      | (() => void)
      | undefined;
    assert.equal(typeof clickKeepMine, "function");
    clickKeepMine?.();
    await waitForAsyncDrain();

    tree = renderDialog(hookRenderer);
    assert.equal(keepMineCalls, 1);
    assert.match(
      flattenText(tree),
      /Couldn't save your version\. Check your connection and retry\./,
    );
  });

  test("surfaces use-theirs reload failure state", async () => {
    const hookRenderer = createHookRenderer();
    let useTheirsCalls = 0;

    let tree = renderDialog(hookRenderer, {
      onUseTheirs: async () => {
        useTheirsCalls += 1;
        throw new Error("reload failed");
      },
    });
    const useTheirsButton = findButtonByLabel(tree, "Use server version");
    const clickUseTheirs = useTheirsButton?.props.onClick as
      | (() => void)
      | undefined;
    assert.equal(typeof clickUseTheirs, "function");
    clickUseTheirs?.();
    await waitForAsyncDrain();

    tree = renderDialog(hookRenderer);
    assert.equal(useTheirsCalls, 1);
    assert.match(
      flattenText(tree),
      new RegExp(CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE),
    );
  });
});
