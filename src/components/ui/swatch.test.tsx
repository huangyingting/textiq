import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { Swatch, type SwatchProps } from "@/components/ui/swatch";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function mountSwatch(props: SwatchProps) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(Swatch, props));
  });
  return renderer.root.findByType("button");
}

test("selected state owns aria-pressed over a conflicting caller attribute", () => {
  const button = mountSwatch({
    color: "#0ea5e9",
    selected: true,
    "aria-label": "Sky",
    "aria-pressed": false,
  });

  assert.equal(button.props["aria-pressed"], true);
});

test("caller aria-pressed is preserved when selected state is omitted", () => {
  const button = mountSwatch({
    color: "#0ea5e9",
    "aria-label": "Sky",
    "aria-pressed": "mixed",
  });

  assert.equal(button.props["aria-pressed"], "mixed");
});

test("caller styles are merged without replacing the swatch color", () => {
  const button = mountSwatch({
    color: "#0ea5e9",
    "aria-label": "Sky",
    style: { backgroundColor: "#dc2626", opacity: 0.5 },
  });

  assert.deepEqual(button.props.style, {
    backgroundColor: "#0ea5e9",
    opacity: 0.5,
  });
});
