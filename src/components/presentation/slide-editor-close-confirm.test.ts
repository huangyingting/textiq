import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isValidElement, type ReactNode } from "react";

import {
  handleCloseConfirmAction,
  routeCloseRequest,
  setupBeforeUnloadGuard,
  SlideEditorCloseConfirmDialog,
} from "./slide-editor";

interface TestElement {
  type: unknown;
  props: Record<string, unknown>;
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

function findElement(
  node: ReactNode,
  predicate: (element: TestElement) => boolean,
): TestElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate);
      if (match) return match;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const element: TestElement = {
    type: node.type,
    props: node.props as Record<string, unknown>,
  };
  if (predicate(element)) return element;
  return findElement(element.props.children as ReactNode, predicate);
}

function findButtonClickHandler(
  node: ReactNode,
  label: string,
): (() => void) | null {
  const button = findElement(
    node,
    (element) =>
      element.type === "button" &&
      textContent(element.props.children as ReactNode).trim() === label,
  );
  if (!button || typeof button.props.onClick !== "function") return null;
  return button.props.onClick as () => void;
}

describe("slide editor presentation close confirm flow", () => {
  test("routes close request to dialog when there is unsaved work", () => {
    const calls: string[] = [];
    routeCloseRequest(true, {
      openCloseConfirmDialog: () => calls.push("confirm"),
      closeEditor: () => calls.push("close"),
    });

    assert.deepEqual(calls, ["confirm"]);
  });

  test("closes immediately when there is no unsaved work", () => {
    const calls: string[] = [];
    routeCloseRequest(false, {
      openCloseConfirmDialog: () => calls.push("confirm"),
      closeEditor: () => calls.push("close"),
    });

    assert.deepEqual(calls, ["close"]);
  });

  test("cancel keeps editor open and discard closes it", () => {
    const calls: string[] = [];

    handleCloseConfirmAction("cancel", {
      closeCloseConfirmDialog: () => calls.push("dismiss-dialog"),
      closeEditor: () => calls.push("close-editor"),
    });

    handleCloseConfirmAction("discard", {
      closeCloseConfirmDialog: () => calls.push("dismiss-dialog"),
      closeEditor: () => calls.push("close-editor"),
    });

    assert.deepEqual(calls, [
      "dismiss-dialog",
      "dismiss-dialog",
      "close-editor",
    ]);
  });

  test("wires cancel and discard actions on the close-confirm dialog", () => {
    const calls: string[] = [];
    const element = SlideEditorCloseConfirmDialog({
      onCancel: () => calls.push("cancel"),
      onDiscard: () => calls.push("discard"),
    });
    const dialogProps = element.props as {
      onClose?: () => void;
      children?: ReactNode;
    };
    const cancel = findButtonClickHandler(dialogProps.children, "Cancel");
    const discard = findButtonClickHandler(
      dialogProps.children,
      "Discard changes",
    );

    assert.ok(cancel);
    assert.ok(discard);
    assert.match(
      textContent(dialogProps.children),
      /You have unsaved slide changes\. Close the editor and discard them\?/,
    );

    dialogProps.onClose?.();
    cancel();
    discard();

    assert.deepEqual(calls, ["cancel", "cancel", "discard"]);
  });

  test("registers and cleans up beforeunload guard for unsaved work", () => {
    const addedListeners: Array<(event: BeforeUnloadEvent) => void> = [];
    const removedListeners: Array<(event: BeforeUnloadEvent) => void> = [];

    const cleanup = setupBeforeUnloadGuard(true, {
      addBeforeUnloadListener: (listener) => addedListeners.push(listener),
      removeBeforeUnloadListener: (listener) => removedListeners.push(listener),
    });

    assert.equal(addedListeners.length, 1);
    assert.equal(typeof cleanup, "function");

    const calls: string[] = [];
    const event = {
      preventDefault: () => calls.push("preventDefault"),
      returnValue: undefined as unknown,
    } as unknown as BeforeUnloadEvent;
    addedListeners[0](event);

    assert.deepEqual(calls, ["preventDefault"]);
    assert.equal(event.returnValue, "");

    cleanup?.();
    assert.deepEqual(removedListeners, [addedListeners[0]]);
  });

  test("skips beforeunload guard when there is no unsaved work", () => {
    const addedListeners: Array<(event: BeforeUnloadEvent) => void> = [];
    const removedListeners: Array<(event: BeforeUnloadEvent) => void> = [];

    const cleanup = setupBeforeUnloadGuard(false, {
      addBeforeUnloadListener: (listener) => addedListeners.push(listener),
      removeBeforeUnloadListener: (listener) => removedListeners.push(listener),
    });

    assert.equal(cleanup, undefined);
    assert.deepEqual(addedListeners, []);
    assert.deepEqual(removedListeners, []);
  });
});
