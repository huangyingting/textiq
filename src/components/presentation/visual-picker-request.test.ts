import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createPendingVisualPickerRequest,
  settlePendingVisualPickerRequest,
  type PendingVisualPickerRequest,
} from "./visual-picker-request";

test("settlePendingVisualPickerRequest only settles the request that still owns the boundary", async () => {
  type Pick = { visualId: string };
  const first = createPendingVisualPickerRequest<Pick>();
  const second = createPendingVisualPickerRequest<Pick>();
  const requestRef: { current: PendingVisualPickerRequest<Pick> | null } = {
    current: second,
  };
  let firstSettled = false;
  void first.promise.then(() => {
    firstSettled = true;
  });

  assert.equal(
    settlePendingVisualPickerRequest(requestRef, first, undefined),
    false,
  );
  assert.equal(requestRef.current, second);
  assert.equal(firstSettled, false);

  const picked = { visualId: "visual-current" };
  assert.equal(
    settlePendingVisualPickerRequest(requestRef, second, picked),
    true,
  );
  assert.equal(requestRef.current, null);
  assert.deepEqual(await second.promise, picked);
  assert.equal(firstSettled, false);
});
