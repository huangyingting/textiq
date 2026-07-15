/**
 * Direct contract coverage for `Switch` (`src/components/ui/switch.tsx`,
 * #1965) — the accessible toggle: `role="switch"` + `aria-checked`
 * semantics, `checked`-driven track/thumb styling, `onCheckedChange`
 * callback wiring (including the disabled no-op case), `disabled` state
 * forwarding, `ref` forwarding, and arbitrary `ButtonHTMLAttributes`
 * passthrough (e.g. keyboard-related props like `onKeyDown`, `aria-label`)
 * for a11y.
 *
 * `Switch` has never been directly imported by a test file before this: its
 * only production consumer, `share-button.tsx`, is exercised end-to-end via
 * `share-button.test.tsx`'s "toggling the switch on" scenario, which finds
 * the rendered `<button role="switch">` structurally and calls its
 * `onClick` — it never asserts `Switch`'s own prop contract (e.g. that
 * `disabled` suppresses the callback, or that `ref`/extra attributes are
 * forwarded).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, createRef } from "react";
import { act, create } from "react-test-renderer";

import { Switch } from "@/components/ui/switch";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function mountSwitch(props: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  [key: string]: unknown;
}) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(Switch, props));
  });
  return renderer;
}

test("renders role=switch with aria-checked=false and the off-state track/thumb classes when checked is false", () => {
  const renderer = mountSwitch({ checked: false, onCheckedChange: () => {} });
  const button = renderer.root.findByType("button");
  assert.equal(button.props.role, "switch");
  assert.equal(button.props["aria-checked"], false);
  assert.equal(button.props.type, "button");
  assert.match(button.props.className as string, /bg-ds-state-active/);
  assert.match(
    button.props.className as string,
    /motion-reduce:transition-none/,
  );
  const thumb = renderer.root.findByType("span");
  assert.match(thumb.props.className as string, /translate-x-1/);
  assert.match(
    thumb.props.className as string,
    /motion-reduce:transition-none/,
  );
});

test("renders aria-checked=true and the on-state track/thumb classes when checked is true", () => {
  const renderer = mountSwitch({ checked: true, onCheckedChange: () => {} });
  const button = renderer.root.findByType("button");
  assert.equal(button.props["aria-checked"], true);
  assert.match(button.props.className as string, /bg-ds-control(?!-)/);
  const thumb = renderer.root.findByType("span");
  assert.match(thumb.props.className as string, /translate-x-6/);
});

test("clicking calls onCheckedChange with the inverse of the current checked value", () => {
  const calls: boolean[] = [];
  const renderer = mountSwitch({
    checked: false,
    onCheckedChange: (next) => calls.push(next),
  });
  const button = renderer.root.findByType("button");
  act(() => {
    (button.props.onClick as () => void)();
  });
  assert.deepEqual(calls, [true]);
});

test("clicking a checked=true switch calls onCheckedChange(false)", () => {
  const calls: boolean[] = [];
  const renderer = mountSwitch({
    checked: true,
    onCheckedChange: (next) => calls.push(next),
  });
  const button = renderer.root.findByType("button");
  act(() => {
    (button.props.onClick as () => void)();
  });
  assert.deepEqual(calls, [false]);
});

test("disabled switch sets the disabled attribute and never invokes onCheckedChange when clicked", () => {
  const calls: boolean[] = [];
  const renderer = mountSwitch({
    checked: false,
    disabled: true,
    onCheckedChange: (next) => calls.push(next),
  });
  const button = renderer.root.findByType("button");
  assert.equal(button.props.disabled, true);
  act(() => {
    (button.props.onClick as () => void)();
  });
  assert.deepEqual(
    calls,
    [],
    "expected the click handler's disabled guard to suppress the callback",
  );
});

test("forwards a caller className alongside the default track classes", () => {
  const renderer = mountSwitch({
    checked: false,
    onCheckedChange: () => {},
    className: "ml-2",
  });
  const button = renderer.root.findByType("button");
  assert.match(button.props.className as string, /ml-2/);
  assert.match(button.props.className as string, /rounded-full/);
});

test("forwards arbitrary ButtonHTMLAttributes (aria-label, onKeyDown, data-testid) to the underlying button", () => {
  const keyEvents: string[] = [];
  const renderer = mountSwitch({
    checked: false,
    onCheckedChange: () => {},
    "aria-label": "Public link sharing",
    "data-testid": "share-switch",
    onKeyDown: (event: { key: string }) => keyEvents.push(event.key),
  });
  const button = renderer.root.findByType("button");
  assert.equal(button.props["aria-label"], "Public link sharing");
  assert.equal(button.props["data-testid"], "share-switch");
  act(() => {
    (button.props.onKeyDown as (event: { key: string }) => void)({
      key: "Enter",
    });
  });
  assert.deepEqual(keyEvents, ["Enter"]);
});

test("forwards the ref to the underlying button DOM node", () => {
  const ref = createRef<HTMLButtonElement>();
  const nodeMock = { tagName: "BUTTON" };
  act(() => {
    create(
      createElement(Switch, {
        checked: false,
        onCheckedChange: () => {},
        ref,
      }),
      { createNodeMock: () => nodeMock },
    );
  });
  assert.equal(ref.current, nodeMock);
});
