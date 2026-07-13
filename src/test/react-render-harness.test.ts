/**
 * Focused coverage for `withDefaultDom`'s global-teardown contract (#1981):
 * a fake `document`/`window` must never leak past the call that installed
 * it, whether that call finishes synchronously, throws synchronously,
 * resolves asynchronously, rejects asynchronously, or nests inside another
 * `withDefaultDom` call. `withDefaultDom` itself is otherwise internal to
 * `@/test/react-render-harness` (used by `runInAct`), so it's exported
 * solely for this file.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import { withDefaultDom } from "@/test/react-render-harness";
import {
  captureOwnPropertyDescriptors,
  restoreOwnPropertyDescriptors,
  type PropertyDescriptorSnapshot,
} from "@/test/global-property-descriptors";

const DOM_KEYS = ["document", "window"] as const;
type DomKey = (typeof DOM_KEYS)[number];

/**
 * Safety net around every test below: snapshots whatever `document`/`window`
 * looked like before the test and restores it after, independent of the
 * `withDefaultDom` behavior under test, so a bug in that behavior can't leak
 * a stray global into a later test in this file.
 */
let outerSnapshot: PropertyDescriptorSnapshot;

beforeEach(() => {
  outerSnapshot = captureOwnPropertyDescriptors(globalThis, DOM_KEYS);
});

afterEach(() => {
  restoreOwnPropertyDescriptors(globalThis, outerSnapshot);
});

function hasOwn(key: DomKey): boolean {
  return Object.prototype.hasOwnProperty.call(globalThis, key);
}

function descriptorOf(key: DomKey): PropertyDescriptor | undefined {
  return Object.getOwnPropertyDescriptor(globalThis, key);
}

describe("withDefaultDom", () => {
  test("sync success: installs fake document/window and fully removes them afterward", () => {
    assert.equal(hasOwn("document"), false);
    assert.equal(hasOwn("window"), false);

    const result = withDefaultDom(() => {
      assert.equal(hasOwn("document"), true);
      assert.equal(hasOwn("window"), true);
      const documentDescriptor = descriptorOf("document");
      const windowDescriptor = descriptorOf("window");
      assert.equal(documentDescriptor?.configurable, true);
      assert.equal(documentDescriptor?.writable, true);
      assert.equal(documentDescriptor?.enumerable, false);
      assert.equal(windowDescriptor?.configurable, true);
      assert.equal(windowDescriptor?.writable, true);
      assert.equal(windowDescriptor?.enumerable, false);
      return 42;
    });

    assert.equal(result, 42);
    assert.equal(hasOwn("document"), false);
    assert.equal(hasOwn("window"), false);
  });

  test("sync throw: still removes the temporary globals and rethrows", () => {
    assert.throws(
      () =>
        withDefaultDom(() => {
          assert.equal(hasOwn("document"), true);
          throw new Error("boom");
        }),
      /boom/,
    );
    assert.equal(hasOwn("document"), false);
    assert.equal(hasOwn("window"), false);
  });

  test("async resolve: keeps the fake globals installed until the returned promise settles", async () => {
    const promise = withDefaultDom(async () => {
      assert.equal(hasOwn("document"), true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(hasOwn("document"), true);
      return "ok";
    });

    // Restoration must wait for the promise to settle, not run immediately
    // after the synchronous portion of the async callback returns.
    assert.equal(hasOwn("document"), true);
    assert.equal(hasOwn("window"), true);

    const value = await promise;
    assert.equal(value, "ok");
    assert.equal(hasOwn("document"), false);
    assert.equal(hasOwn("window"), false);
  });

  test("async reject: removes the temporary globals and rethrows the rejection", async () => {
    const promise = withDefaultDom(async () => {
      assert.equal(hasOwn("document"), true);
      await Promise.resolve();
      throw new Error("async boom");
    });

    await assert.rejects(promise, /async boom/);
    assert.equal(hasOwn("document"), false);
    assert.equal(hasOwn("window"), false);
  });

  test("nested calls: an inner call reuses the outer call's fake and only the outer call removes it", () => {
    withDefaultDom(() => {
      const outerDescriptor = descriptorOf("document");
      assert.notEqual(outerDescriptor, undefined);

      withDefaultDom(() => {
        assert.equal(descriptorOf("document")?.value, outerDescriptor?.value);
        return "inner";
      });

      // The inner call's restore reinstalled the outer call's fake, not
      // deleted it, because the outer fake was "previously present" from
      // the inner call's point of view.
      assert.equal(hasOwn("document"), true);
      assert.equal(descriptorOf("document")?.value, outerDescriptor?.value);
      return "outer";
    });

    assert.equal(hasOwn("document"), false);
    assert.equal(hasOwn("window"), false);
  });

  test("pre-existing global: a global that already exists is left untouched and is never deleted", () => {
    const sentinelDocument = { marker: "pre-existing-document" };
    // Non-default shape: enumerable and non-writable, unlike the harness's
    // own (non-enumerable, writable) installed fakes.
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      enumerable: true,
      writable: false,
      value: sentinelDocument,
    });
    const beforeDescriptor = descriptorOf("document");

    withDefaultDom(() => {
      const duringDescriptor = descriptorOf("document");
      assert.equal(duringDescriptor?.value, sentinelDocument);
      assert.equal(duringDescriptor?.configurable, true);
      assert.equal(duringDescriptor?.enumerable, true);
      assert.equal(duringDescriptor?.writable, false);
      // `window` still gets installed as usual since only `document`
      // pre-existed.
      assert.equal(hasOwn("window"), true);
      return null;
    });

    const afterDescriptor = descriptorOf("document");
    assert.equal(afterDescriptor?.value, sentinelDocument);
    assert.equal(afterDescriptor?.configurable, beforeDescriptor?.configurable);
    assert.equal(afterDescriptor?.enumerable, beforeDescriptor?.enumerable);
    assert.equal(afterDescriptor?.writable, beforeDescriptor?.writable);
    assert.equal(hasOwn("window"), false);
  });
});
