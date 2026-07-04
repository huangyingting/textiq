import assert from "node:assert/strict";
import test from "node:test";

import * as documentActions from "./actions";

test("deck actions barrel exposes only supported deck save entry points", () => {
  assert.equal(typeof documentActions.saveDeckJson, "function");
  assert.equal("saveDeckPatch" in documentActions, false);
  assert.equal("saveDeckCommand" in documentActions, false);
});
