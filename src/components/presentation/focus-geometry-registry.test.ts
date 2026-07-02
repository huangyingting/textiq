import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createFocusGeometryRegistry,
  focusGeometryTargets,
} from "./focus-geometry-registry";

function fakeElement(
  onFocus: (options?: FocusOptions) => void = () => undefined,
): HTMLElement {
  const rect = {
    bottom: 20,
    height: 10,
    left: 1,
    right: 11,
    top: 10,
    width: 10,
    x: 1,
    y: 10,
    toJSON: () => ({}),
  } as DOMRectReadOnly;

  return {
    focus: onFocus,
    getBoundingClientRect: () => rect,
  } as HTMLElement;
}

describe("focus geometry registry", () => {
  test("focuses and measures registered elements by stable target key", () => {
    const registry = createFocusGeometryRegistry();
    const focusOptions: Array<FocusOptions | undefined> = [];
    const key = focusGeometryTargets.filmstripSlideButton(2);
    const element = fakeElement((options) => focusOptions.push(options));

    registry.register(key, element);

    assert.deepEqual(registry.keys(), [key]);
    assert.equal(registry.getElement(key), element);
    assert.equal(registry.focus(key, { preventScroll: true }), true);
    assert.deepEqual(focusOptions, [{ preventScroll: true }]);
    assert.equal(registry.measure(key)?.width, 10);

    registry.unregister(key);

    assert.equal(registry.getElement(key), null);
    assert.equal(registry.focus(key), false);
    assert.equal(registry.measure(key), null);
  });

  test("creates callback refs that register and clear the same target", () => {
    const registry = createFocusGeometryRegistry();
    const key = focusGeometryTargets.filmstripSlideButton(0);
    const ref = registry.createRef(key);
    const element = fakeElement();

    ref(element);
    assert.equal(registry.getElement(key), element);

    ref(null);
    assert.equal(registry.getElement(key), null);
  });

  test("uses stable stage node targets for editor focus restoration", () => {
    const registry = createFocusGeometryRegistry();
    const key = focusGeometryTargets.stageNode('node-"quoted"');
    const focusOptions: Array<FocusOptions | undefined> = [];
    const element = fakeElement((options) => focusOptions.push(options));

    registry.register(key, element);

    assert.equal(key, 'stage:node:node-"quoted"');
    assert.equal(registry.focus(key, { preventScroll: true }), true);
    assert.deepEqual(focusOptions, [{ preventScroll: true }]);
  });
});
