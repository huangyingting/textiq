import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { SelectMenu, type SelectMenuOption } from "@/components/ui/select-menu";
import { createPortalNodeMock, withPortalDom } from "@/test/portal-dom";

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const [message] = args;
  if (
    typeof message === "string" &&
    message.startsWith("react-test-renderer is deprecated")
  ) {
    return;
  }
  originalConsoleError(...args);
};
after(() => {
  console.error = originalConsoleError;
});

type KeyEvent = {
  key: string;
  preventDefault: () => void;
};

type MountedSelect = {
  renderer: ReactTestRenderer;
  changes: string[];
  focusCalls: string[];
  openChanges: boolean[];
};

const OPTIONS: SelectMenuOption[] = [
  { value: "one", label: "One" },
  { value: "two", label: "Two" },
  { value: "three", label: "Three" },
];

function mountSelectMenu(options: SelectMenuOption[] = OPTIONS): MountedSelect {
  const changes: string[] = [];
  const focusCalls: string[] = [];
  const openChanges: boolean[] = [];
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(
      <SelectMenu
        aria-label="Choose item"
        value="one"
        options={options}
        onChange={(value) => changes.push(value)}
        onOpenChange={(open) => openChanges.push(open)}
      />,
      {
        createNodeMock: (element) => {
          const props = element.props as Record<string, unknown>;
          return {
            ...createPortalNodeMock(),
            focus:
              element.type === "button" && props["aria-label"] === "Choose item"
                ? () => focusCalls.push("trigger")
                : () => undefined,
          };
        },
      },
    );
  });

  return { renderer, changes, focusCalls, openChanges };
}

function getTrigger(renderer: ReactTestRenderer) {
  return renderer.root.find(
    (el) => el.type === "button" && el.props["aria-label"] === "Choose item",
  );
}

function getListbox(renderer: ReactTestRenderer) {
  const listboxes = renderer.root.findAll((el) => el.props.role === "listbox");
  return listboxes[0];
}

function pressTriggerKey(renderer: ReactTestRenderer, key: string): void {
  const event: KeyEvent = { key, preventDefault: () => undefined };
  act(() => {
    (getTrigger(renderer).props.onKeyDown as (event: KeyEvent) => void)(event);
  });
}

function pressListboxKey(renderer: ReactTestRenderer, key: string): void {
  const event: KeyEvent = { key, preventDefault: () => undefined };
  act(() => {
    (getListbox(renderer).props.onKeyDown as (event: KeyEvent) => void)(event);
  });
}

describe("SelectMenu keyboard interaction", () => {
  test("ArrowDown opens, moves the active option, and Enter selects it from the focused trigger", () => {
    withPortalDom(() => {
      const { renderer, changes, focusCalls } = mountSelectMenu();

      pressTriggerKey(renderer, "ArrowDown");
      pressTriggerKey(renderer, "ArrowDown");
      assert.match(
        getListbox(renderer).props["aria-activedescendant"] as string,
        /-two$/,
      );

      pressTriggerKey(renderer, "Enter");

      assert.deepEqual(changes, ["two"]);
      assert.equal(
        renderer.root.findAll((el) => el.props.role === "listbox").length,
        0,
      );
      assert.deepEqual(focusCalls, ["trigger"]);
    });
  });

  test("Space selects the active option while focus remains on the trigger", () => {
    withPortalDom(() => {
      const { renderer, changes } = mountSelectMenu();

      pressTriggerKey(renderer, "ArrowDown");
      pressTriggerKey(renderer, "ArrowDown");
      pressTriggerKey(renderer, "ArrowDown");
      assert.match(
        getListbox(renderer).props["aria-activedescendant"] as string,
        /-three$/,
      );

      pressTriggerKey(renderer, " ");

      assert.deepEqual(changes, ["three"]);
      assert.equal(
        renderer.root.findAll((el) => el.props.role === "listbox").length,
        0,
      );
    });
  });

  test("trigger arrow navigation skips disabled options before Enter selection", () => {
    withPortalDom(() => {
      const { renderer, changes } = mountSelectMenu([
        { value: "one", label: "One" },
        { value: "two", label: "Two", disabled: true },
        { value: "three", label: "Three" },
      ]);

      pressTriggerKey(renderer, "ArrowDown");
      pressTriggerKey(renderer, "ArrowDown");

      assert.match(
        getListbox(renderer).props["aria-activedescendant"] as string,
        /-three$/,
      );

      pressTriggerKey(renderer, "Enter");

      assert.deepEqual(changes, ["three"]);
    });
  });

  test("Escape closes the listbox and restores focus to the trigger", () => {
    withPortalDom(() => {
      const { renderer, changes, focusCalls, openChanges } = mountSelectMenu();

      pressTriggerKey(renderer, "ArrowDown");
      assert.equal(getTrigger(renderer).props["aria-expanded"], true);
      assert.notEqual(getListbox(renderer), undefined);

      pressListboxKey(renderer, "Escape");

      assert.deepEqual(changes, []);
      assert.equal(getTrigger(renderer).props["aria-expanded"], false);
      assert.equal(
        renderer.root.findAll((el) => el.props.role === "listbox").length,
        0,
      );
      assert.deepEqual(focusCalls, ["trigger"]);
      assert.deepEqual(openChanges, [true, false]);
    });
  });
});
