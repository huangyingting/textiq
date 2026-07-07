import assert from "node:assert/strict";
import { test } from "node:test";

import { createHeadlessEditor } from "@lexical/headless";

import {
  installTableObserverReadGuard,
  isBenignTableObserverError,
} from "./table-observer-guard";

test("isBenignTableObserverError matches only TableObserver expected invariants", () => {
  assert.equal(
    isBenignTableObserverError(
      new Error("TableObserver: Expected tableNodeKey 122 to be a TableNode"),
    ),
    true,
  );
  assert.equal(
    isBenignTableObserverError(
      new Error(
        "TableObserver: Expected to find TableElement in DOM for key 46",
      ),
    ),
    true,
  );
  assert.equal(
    isBenignTableObserverError(new Error("Some other error")),
    false,
  );
  assert.equal(isBenignTableObserverError("not an error"), false);
});

test("installTableObserverReadGuard swallows benign table reads and rethrows others", () => {
  const editor = createHeadlessEditor({
    namespace: "table-observer-guard-test",
    onError(error) {
      throw error;
    },
  });

  const restore = installTableObserverReadGuard(editor);
  try {
    const swallowed = editor.read(() => {
      throw new Error(
        "TableObserver: Expected tableNodeKey 1 to be a TableNode",
      );
    });
    assert.equal(swallowed, undefined);

    assert.throws(
      () =>
        editor.read(() => {
          throw new Error("unrelated failure");
        }),
      /unrelated failure/,
    );

    assert.equal(
      editor.read(() => 42),
      42,
    );
  } finally {
    restore();
  }

  assert.throws(
    () =>
      editor.read(() => {
        throw new Error(
          "TableObserver: Expected tableNodeKey 2 to be a TableNode",
        );
      }),
    /TableObserver/,
  );
});

test("installTableObserverReadGuard is idempotent per editor instance", () => {
  const editor = createHeadlessEditor({
    namespace: "table-observer-guard-idempotent-test",
    onError(error) {
      throw error;
    },
  });

  const restore = installTableObserverReadGuard(editor);
  const guardedRead = editor.read;
  // A second install must not stack another wrapper.
  const noop = installTableObserverReadGuard(editor);
  assert.equal(editor.read, guardedRead);

  // The redundant disposer is a no-op and leaves the guard intact.
  noop();
  assert.equal(
    editor.read(() => {
      throw new Error("TableObserver: Expected to find TableElement in DOM");
    }),
    undefined,
  );

  restore();
  assert.throws(
    () =>
      editor.read(() => {
        throw new Error("TableObserver: Expected to find TableElement in DOM");
      }),
    /TableObserver/,
  );
});
