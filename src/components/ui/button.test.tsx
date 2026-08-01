import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, createRef } from "react";
import { act, create } from "react-test-renderer";

import { Button, IconButton } from "@/components/ui/button";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

test("Button defaults to type=button while preserving an explicit submit type", () => {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      createElement(
        "div",
        null,
        createElement(Button, null, "Default"),
        createElement(Button, { type: "submit" }, "Submit"),
      ),
    );
  });

  assert.deepEqual(
    renderer.root.findAllByType("button").map((button) => button.props.type),
    ["button", "submit"],
  );
});

test("IconButton active state owns aria-pressed over a conflicting caller attribute", () => {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      createElement(
        IconButton,
        {
          active: true,
          "aria-label": "Pin item",
          "aria-pressed": false,
        },
        "P",
      ),
    );
  });

  assert.equal(renderer.root.findByType("button").props["aria-pressed"], true);
});

test("IconButton preserves caller aria-pressed when active is omitted", () => {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      createElement(
        IconButton,
        { "aria-label": "Pin item", "aria-pressed": "mixed" },
        "P",
      ),
    );
  });

  assert.equal(
    renderer.root.findByType("button").props["aria-pressed"],
    "mixed",
  );
});

test("Button and IconButton forward refs to their host controls", () => {
  const buttonRef = createRef<HTMLButtonElement>();
  const iconRef = createRef<HTMLButtonElement>();
  const nodes = [{ id: "button" }, { id: "icon" }];
  let nodeIndex = 0;

  act(() => {
    create(
      createElement(
        "div",
        null,
        createElement(Button, { ref: buttonRef }, "Default"),
        createElement(IconButton, { ref: iconRef, "aria-label": "Icon" }, "I"),
      ),
      {
        createNodeMock(element) {
          if (element.type !== "button") return {};
          const node = nodes[nodeIndex];
          nodeIndex += 1;
          return node;
        },
      },
    );
  });

  assert.equal(buttonRef.current, nodes[0]);
  assert.equal(iconRef.current, nodes[1]);
});
