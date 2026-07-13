/**
 * Unit coverage for the descriptor capture/restore primitives shared by
 * `@/test/react-render-harness`'s `withDefaultDom` and `@/test/portal-dom`'s
 * `withPortalDom` (#1981). These run against a plain synthetic target
 * (never `globalThis`) so they can freely exercise descriptor shapes —
 * including a non-configurable property — that would otherwise be
 * impossible to clean up if applied to a real global.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  captureOwnPropertyDescriptors,
  restoreOwnPropertyDescriptors,
} from "@/test/global-property-descriptors";

test("captures an absent property and restore() deletes it if later added", () => {
  const target: { value?: string } = {};
  const snapshot = captureOwnPropertyDescriptors(target, ["value"]);
  assert.equal(snapshot.get("value"), undefined);
  assert.equal(snapshot.has("value"), true);

  target.value = "installed";
  assert.equal(Object.prototype.hasOwnProperty.call(target, "value"), true);

  restoreOwnPropertyDescriptors(target, snapshot);
  assert.equal(Object.prototype.hasOwnProperty.call(target, "value"), false);
});

test("restores a present default-shape data property to its original value", () => {
  const target = { value: "original" };
  const snapshot = captureOwnPropertyDescriptors(target, ["value"]);

  target.value = "mutated";
  assert.equal(target.value, "mutated");

  restoreOwnPropertyDescriptors(target, snapshot);
  assert.equal(target.value, "original");
  const descriptor = Object.getOwnPropertyDescriptor(target, "value");
  assert.equal(descriptor?.writable, true);
  assert.equal(descriptor?.enumerable, true);
  assert.equal(descriptor?.configurable, true);
});

test("restores non-default writable/enumerable/configurable flags exactly", () => {
  const target = {};
  const sentinel = { marker: "non-default" };
  Object.defineProperty(target, "value", {
    value: sentinel,
    writable: false,
    enumerable: false,
    configurable: true,
  });
  const snapshot = captureOwnPropertyDescriptors(target, ["value"]);

  // Redefine (allowed since configurable: true) to something else entirely.
  Object.defineProperty(target, "value", {
    value: "different",
    writable: true,
    enumerable: true,
    configurable: true,
  });

  restoreOwnPropertyDescriptors(target, snapshot);
  const descriptor = Object.getOwnPropertyDescriptor(target, "value");
  assert.equal(descriptor?.value, sentinel);
  assert.equal(descriptor?.writable, false);
  assert.equal(descriptor?.enumerable, false);
  assert.equal(descriptor?.configurable, true);
});

test("restores accessor (get/set) descriptors, preserving the exact functions", () => {
  const target: Record<string, unknown> = {};
  let backing = "initial";
  const get = () => backing;
  const set = (next: unknown) => {
    backing = String(next);
  };
  Object.defineProperty(target, "value", {
    get,
    set,
    enumerable: true,
    configurable: true,
  });
  const snapshot = captureOwnPropertyDescriptors(target, ["value"]);

  Object.defineProperty(target, "value", {
    value: "plain data now",
    writable: true,
    enumerable: true,
    configurable: true,
  });

  restoreOwnPropertyDescriptors(target, snapshot);
  const descriptor = Object.getOwnPropertyDescriptor(target, "value");
  assert.equal(descriptor?.get, get);
  assert.equal(descriptor?.set, set);
  target.value = "through the setter";
  assert.equal(backing, "through the setter");
  assert.equal(target.value, "through the setter");
});

test("reinstalls an identical descriptor on a non-configurable property without throwing", () => {
  const target = {};
  const sentinel = { marker: "locked" };
  Object.defineProperty(target, "value", {
    value: sentinel,
    writable: false,
    enumerable: false,
    configurable: false,
  });
  const snapshot = captureOwnPropertyDescriptors(target, ["value"]);

  // A non-configurable property can't be deleted or redefined to a
  // different shape, but redefining it to an identical descriptor is a
  // legal no-op per spec — restore must rely on exactly that.
  assert.doesNotThrow(() => restoreOwnPropertyDescriptors(target, snapshot));
  const descriptor = Object.getOwnPropertyDescriptor(target, "value");
  assert.equal(descriptor?.value, sentinel);
  assert.equal(descriptor?.configurable, false);
});

test("captures and restores multiple keys independently, mixing present and absent", () => {
  const target: { present?: string; absent?: string } = {
    present: "kept",
  };
  const snapshot = captureOwnPropertyDescriptors(target, ["present", "absent"]);

  target.present = "changed";
  target.absent = "should be removed";

  restoreOwnPropertyDescriptors(target, snapshot);
  assert.equal(target.present, "kept");
  assert.equal(Object.prototype.hasOwnProperty.call(target, "absent"), false);
});
