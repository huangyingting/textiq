import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  focusFirstMenuCommand,
  getMenuCommandItems,
  getNextMenuCommandIndex,
  moveMenuCommandFocus,
} from "./menu-command-semantics";

class MockMenuItem {
  private readonly attributes = new Map<string, string>();
  focusCalls = 0;

  constructor(options?: { disabled?: boolean; ariaDisabled?: boolean }) {
    if (options?.disabled) this.attributes.set("disabled", "");
    if (options?.ariaDisabled) this.attributes.set("aria-disabled", "true");
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  focus() {
    this.focusCalls += 1;
  }

  addEventListener(): void {}

  dispatchEvent(): boolean {
    return true;
  }

  removeEventListener(): void {}
}

function parentNodeFixture(value: unknown): ParentNode {
  return value as unknown as ParentNode;
}

function createContainer(items: MockMenuItem[]): ParentNode {
  return parentNodeFixture({
    querySelectorAll: () => items,
  });
}

describe("menu command semantics helpers", () => {
  test("filters disabled menu commands", () => {
    const enabled = new MockMenuItem();
    const disabled = new MockMenuItem({ disabled: true });
    const ariaDisabled = new MockMenuItem({ ariaDisabled: true });
    const items = getMenuCommandItems(
      createContainer([enabled, disabled, ariaDisabled]),
    );

    assert.deepEqual(items, [enabled]);
  });

  test("selects first and last command indices for Home/End and wraps arrows", () => {
    assert.equal(getNextMenuCommandIndex("Home", 1, 3), 0);
    assert.equal(getNextMenuCommandIndex("End", 1, 3), 2);
    assert.equal(getNextMenuCommandIndex("ArrowDown", 2, 3), 0);
    assert.equal(getNextMenuCommandIndex("ArrowUp", 0, 3), 2);
    assert.equal(getNextMenuCommandIndex("ArrowDown", -1, 3), 0);
    assert.equal(getNextMenuCommandIndex("ArrowUp", -1, 3), 2);
  });

  test("moves focus across commands with arrow keys", () => {
    const first = new MockMenuItem();
    const second = new MockMenuItem();
    const third = new MockMenuItem();
    const container = createContainer([first, second, third]);

    const movedForward = moveMenuCommandFocus({
      container,
      key: "ArrowDown",
      currentTarget: first,
    });
    const movedBackward = moveMenuCommandFocus({
      container,
      key: "ArrowUp",
      currentTarget: first,
    });

    assert.equal(movedForward, true);
    assert.equal(movedBackward, true);
    assert.equal(second.focusCalls, 1);
    assert.equal(third.focusCalls, 1);
  });

  test("focuses the first enabled command when opened", () => {
    const first = new MockMenuItem({ disabled: true });
    const second = new MockMenuItem();
    const focused = focusFirstMenuCommand(createContainer([first, second]));

    assert.equal(focused, true);
    assert.equal(first.focusCalls, 0);
    assert.equal(second.focusCalls, 1);
  });
});
