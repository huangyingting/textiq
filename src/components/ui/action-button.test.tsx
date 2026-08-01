import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { ActionButton } from "@/components/ui/action-button";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

test("renders descriptor label, tooltip, and canonical shortcut metadata", () => {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      createElement(ActionButton, {
        action: {
          id: "help",
          label: "Help",
          description: "Show available shortcuts",
          shortcutId: "global.help",
        },
      }),
    );
  });
  const button = renderer.root.findByType("button");

  assert.deepEqual(button.children, ["Help"]);
  assert.equal(button.props.title, "Show available shortcuts");
  assert.equal(button.props["aria-keyshortcuts"], "?");
  assert.equal(button.props.disabled, false);
});

test("disabledReason authoritatively disables the action and explains why", () => {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      createElement(
        ActionButton,
        {
          action: {
            id: "delete",
            label: "Delete",
            description: "Delete this item",
            disabledReason: "Deletion is already in progress",
          },
          disabled: false,
        },
        "Deleting…",
      ),
    );
  });
  const button = renderer.root.findByType("button");

  assert.equal(button.props.disabled, true);
  assert.equal(button.props.title, "Deletion is already in progress");
  assert.deepEqual(button.children, ["Deleting…"]);
});

test("icon-only actions expose the descriptor label to assistive technology", () => {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      createElement(
        ActionButton,
        {
          iconOnly: true,
          action: {
            id: "help",
            label: "Help",
            tooltip: "Open help",
            shortcutId: "global.help",
          },
        },
        "?",
      ),
    );
  });
  const button = renderer.root.findByType("button");

  assert.equal(button.props["aria-label"], "Help");
  assert.equal(button.props["aria-keyshortcuts"], "?");
  assert.equal(button.props.title, "Open help");
});

test("preserves owning-surface activation and submit semantics", () => {
  let activations = 0;
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      createElement(
        ActionButton,
        {
          action: { id: "confirm", label: "Confirm" },
          type: "submit",
          onClick: () => {
            activations += 1;
          },
        },
        "Confirm deletion",
      ),
    );
  });
  const button = renderer.root.findByType("button");

  assert.equal(button.props.type, "submit");
  act(() => {
    button.props.onClick();
  });
  assert.equal(activations, 1);
});
