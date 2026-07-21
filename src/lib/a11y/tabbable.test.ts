import assert from "node:assert/strict";
import test from "node:test";

// NOTE: The module under test does not exist yet — these tests are written
// first and expected to fail until `tabbable.ts` is implemented.
import { getTabbableElements, nextFocusIndex } from "./tabbable";

// ---------------------------------------------------------------------------
// Minimal DOM stub that exercises real selector/filter logic.
// ---------------------------------------------------------------------------

type Attrs = Record<string, string>;

interface StubElement {
  tagName: string;
  attrs: Attrs;
  parentElement: StubElement | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  matches(selector: string): boolean;
}

interface StubContainer {
  querySelectorAll(selector: string): StubElement[];
  children: StubElement[];
}

function makeElement(
  tagName: string,
  attrs: Attrs = {},
  parent?: StubElement,
): StubElement {
  const el: StubElement = {
    tagName: tagName.toUpperCase(),
    attrs,
    parentElement: parent ?? null,
    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    },
    hasAttribute(name: string) {
      return name in this.attrs;
    },
    matches(_selector: string) {
      // Stub; getTabbableElements should not rely on element.matches
      return false;
    },
  };
  return el;
}

function makeContainer(children: StubElement[]): StubContainer {
  return {
    children,
    querySelectorAll(_selector: string): StubElement[] {
      // Return all children flat — the module should apply its own filtering.
      return children;
    },
  };
}

// ---------------------------------------------------------------------------
// getTabbableElements — element inclusion/exclusion contract
// ---------------------------------------------------------------------------

test("getTabbableElements: includes enabled button", () => {
  const btn = makeElement("button");
  const container = makeContainer([btn]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 1);
});

test("getTabbableElements: excludes disabled button", () => {
  const btn = makeElement("button", { disabled: "" });
  const container = makeContainer([btn]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 0);
});

test("getTabbableElements: includes enabled input", () => {
  const input = makeElement("input", { type: "text" });
  const container = makeContainer([input]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 1);
});

test("getTabbableElements: excludes disabled input", () => {
  const input = makeElement("input", { type: "text", disabled: "" });
  const container = makeContainer([input]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 0);
});

test("getTabbableElements: excludes input[type=hidden]", () => {
  const input = makeElement("input", { type: "hidden" });
  const container = makeContainer([input]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 0);
});

test("getTabbableElements: includes enabled select", () => {
  const sel = makeElement("select");
  const container = makeContainer([sel]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 1);
});

test("getTabbableElements: excludes disabled select", () => {
  const sel = makeElement("select", { disabled: "" });
  const container = makeContainer([sel]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 0);
});

test("getTabbableElements: includes enabled textarea", () => {
  const ta = makeElement("textarea");
  const container = makeContainer([ta]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 1);
});

test("getTabbableElements: excludes disabled textarea", () => {
  const ta = makeElement("textarea", { disabled: "" });
  const container = makeContainer([ta]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 0);
});

test("getTabbableElements: includes anchor with href", () => {
  const a = makeElement("a", { href: "/page" });
  const container = makeContainer([a]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 1);
});

test("getTabbableElements: excludes anchor without href", () => {
  const a = makeElement("a");
  const container = makeContainer([a]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 0);
});

test("getTabbableElements: includes area with href", () => {
  const area = makeElement("area", { href: "/zone" });
  const container = makeContainer([area]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 1);
});

test("getTabbableElements: excludes area without href", () => {
  const area = makeElement("area");
  const container = makeContainer([area]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 0);
});

test("getTabbableElements: includes element with tabindex=0", () => {
  const div = makeElement("div", { tabindex: "0" });
  const container = makeContainer([div]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 1);
});

test("getTabbableElements: excludes element with tabindex=-1", () => {
  const div = makeElement("div", { tabindex: "-1" });
  const container = makeContainer([div]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 0);
});

test("getTabbableElements: excludes native control with tabindex=-1", () => {
  // A button with tabindex=-1 must be excluded even though buttons are
  // normally tabbable — the explicit tabindex override takes priority.
  const btn = makeElement("button", { tabindex: "-1" });
  const container = makeContainer([btn]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 0);
});

test("getTabbableElements: includes contenteditable=true", () => {
  const div = makeElement("div", { contenteditable: "true" });
  const container = makeContainer([div]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 1);
});

test("getTabbableElements: excludes contenteditable=false", () => {
  const div = makeElement("div", { contenteditable: "false" });
  const container = makeContainer([div]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 0);
});

test("getTabbableElements: includes iframe", () => {
  const iframe = makeElement("iframe");
  const container = makeContainer([iframe]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 1);
});

test("getTabbableElements: includes object", () => {
  const obj = makeElement("object");
  const container = makeContainer([obj]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 1);
});

test("getTabbableElements: includes embed", () => {
  const embed = makeElement("embed");
  const container = makeContainer([embed]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 1);
});

// ---------------------------------------------------------------------------
// getTabbableElements — hidden ancestor filtering
// ---------------------------------------------------------------------------

test("getTabbableElements: excludes element inside [hidden] ancestor", () => {
  const parent = makeElement("div", { hidden: "" });
  const btn = makeElement("button", {}, parent);
  const container = makeContainer([btn]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 0);
});

test("getTabbableElements: excludes element inside [aria-hidden=true] ancestor", () => {
  const parent = makeElement("div", { "aria-hidden": "true" });
  const btn = makeElement("button", {}, parent);
  const container = makeContainer([btn]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 0);
});

test("getTabbableElements: excludes element inside [inert] ancestor", () => {
  const parent = makeElement("div", { inert: "" });
  const btn = makeElement("button", {}, parent);
  const container = makeContainer([btn]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 0);
});

test("getTabbableElements: excludes element with own aria-hidden=true", () => {
  const btn = makeElement("button", { "aria-hidden": "true" });
  const container = makeContainer([btn]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 0);
});

test("getTabbableElements: excludes element with own hidden attribute", () => {
  const btn = makeElement("button", { hidden: "" });
  const container = makeContainer([btn]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 0);
});

test("getTabbableElements: excludes element with own inert attribute", () => {
  const btn = makeElement("button", { inert: "" });
  const container = makeContainer([btn]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 0);
});

// ---------------------------------------------------------------------------
// getTabbableElements — empty/single/multiple lists
// ---------------------------------------------------------------------------

test("getTabbableElements: empty container returns empty array", () => {
  const container = makeContainer([]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.deepEqual(result, []);
});

test("getTabbableElements: single valid element returns array of one", () => {
  const btn = makeElement("button");
  const container = makeContainer([btn]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 1);
});

test("getTabbableElements: multiple mixed elements filters correctly", () => {
  const btn = makeElement("button");
  const disabledBtn = makeElement("button", { disabled: "" });
  const hiddenInput = makeElement("input", { type: "hidden" });
  const link = makeElement("a", { href: "/x" });
  const tabNeg = makeElement("div", { tabindex: "-1" });
  const iframe = makeElement("iframe");
  const container = makeContainer([
    btn,
    disabledBtn,
    hiddenInput,
    link,
    tabNeg,
    iframe,
  ]);
  const result = getTabbableElements(container as unknown as HTMLElement);
  assert.equal(result.length, 3); // btn, link, iframe
});

// ---------------------------------------------------------------------------
// nextFocusIndex — wrapping helper
// ---------------------------------------------------------------------------

test("nextFocusIndex: returns -1 for empty list", () => {
  assert.equal(nextFocusIndex(0, -1, false), -1);
  assert.equal(nextFocusIndex(0, -1, true), -1);
});

test("nextFocusIndex: single element forward stays at 0", () => {
  assert.equal(nextFocusIndex(1, 0, false), 0);
});

test("nextFocusIndex: single element backward stays at 0", () => {
  assert.equal(nextFocusIndex(1, 0, true), 0);
});

test("nextFocusIndex: forward increments within bounds", () => {
  assert.equal(nextFocusIndex(3, 0, false), 1);
  assert.equal(nextFocusIndex(3, 1, false), 2);
});

test("nextFocusIndex: forward wraps from last to first", () => {
  assert.equal(nextFocusIndex(3, 2, false), 0);
  assert.equal(nextFocusIndex(5, 4, false), 0);
});

test("nextFocusIndex: backward decrements within bounds", () => {
  assert.equal(nextFocusIndex(3, 2, true), 1);
  assert.equal(nextFocusIndex(3, 1, true), 0);
});

test("nextFocusIndex: backward wraps from first to last", () => {
  assert.equal(nextFocusIndex(3, 0, true), 2);
  assert.equal(nextFocusIndex(5, 0, true), 4);
});

test("nextFocusIndex: forward from -1 (no current focus) lands at 0", () => {
  assert.equal(nextFocusIndex(3, -1, false), 0);
});

test("nextFocusIndex: backward from -1 (no current focus) wraps to last", () => {
  assert.equal(nextFocusIndex(3, -1, true), 2);
});
