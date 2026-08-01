import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import {
  SegmentedControl,
  type SegmentedOption,
} from "@/components/ui/segmented-control";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type View = "one" | "two" | "three" | "four" | "missing";

const options: ReadonlyArray<SegmentedOption<View>> = [
  { value: "one", label: "One" },
  { value: "two", label: "Two", disabled: true },
  { value: "three", label: "Three" },
];

function mountSegmentedControl({
  value,
  onChange,
  optionList = options,
}: {
  value: View;
  onChange: (value: View) => void;
  optionList?: ReadonlyArray<SegmentedOption<View>>;
}) {
  const focusLog: string[] = [];
  let renderer!: ReactTestRenderer;
  let buttonIndex = 0;

  act(() => {
    renderer = create(
      createElement(SegmentedControl<View>, {
        options: optionList,
        value,
        onChange,
        "aria-label": "View",
      }),
      {
        createNodeMock(element) {
          if (element.type !== "button") return {};
          const label = optionList[buttonIndex]?.label ?? "unknown";
          buttonIndex += 1;
          return {
            focus() {
              focusLog.push(label);
            },
          };
        },
      },
    );
  });

  return { renderer, focusLog };
}

function pressKey(renderer: ReactTestRenderer, label: string, key: string) {
  const button = renderer.root
    .findAllByType("button")
    .find((candidate) => candidate.props.children[1]?.props.children === label);
  assert.ok(button, `expected to find the ${label} segment`);

  let prevented = false;
  act(() => {
    button.props.onKeyDown({
      key,
      preventDefault() {
        prevented = true;
      },
    });
  });
  assert.equal(prevented, true);
}

test("ArrowRight skips a disabled segment and moves selection and focus to the next enabled segment", () => {
  const changes: View[] = [];
  const { renderer, focusLog } = mountSegmentedControl({
    value: "one",
    onChange: (value) => changes.push(value),
  });

  pressKey(renderer, "One", "ArrowRight");

  assert.deepEqual(changes, ["three"]);
  assert.deepEqual(focusLog, ["Three"]);
});

test("the first enabled segment remains tabbable when the controlled value is missing", () => {
  const { renderer } = mountSegmentedControl({
    value: "missing",
    onChange: () => {},
  });
  const buttons = renderer.root.findAllByType("button");

  assert.deepEqual(
    buttons.map((button) => button.props.tabIndex),
    [0, -1, -1],
  );
});

test("the first enabled segment remains tabbable when the selected segment is disabled", () => {
  const { renderer } = mountSegmentedControl({
    value: "two",
    onChange: () => {},
  });
  const buttons = renderer.root.findAllByType("button");

  assert.deepEqual(
    buttons.map((button) => button.props.tabIndex),
    [0, -1, -1],
  );
});

test("Home and End select the first and last enabled segments when edge segments are disabled", () => {
  const edgeDisabledOptions: ReadonlyArray<SegmentedOption<View>> = [
    { value: "one", label: "One", disabled: true },
    { value: "two", label: "Two" },
    { value: "three", label: "Three" },
    { value: "four", label: "Four", disabled: true },
  ];
  const homeChanges: View[] = [];
  const home = mountSegmentedControl({
    value: "three",
    optionList: edgeDisabledOptions,
    onChange: (value) => homeChanges.push(value),
  });
  const endChanges: View[] = [];
  const end = mountSegmentedControl({
    value: "two",
    optionList: edgeDisabledOptions,
    onChange: (value) => endChanges.push(value),
  });

  pressKey(home.renderer, "Three", "Home");
  pressKey(end.renderer, "Two", "End");

  assert.deepEqual(homeChanges, ["two"]);
  assert.deepEqual(home.focusLog, ["Two"]);
  assert.deepEqual(endChanges, ["three"]);
  assert.deepEqual(end.focusLog, ["Three"]);
});
