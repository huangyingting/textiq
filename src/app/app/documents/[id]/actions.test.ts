import assert from "node:assert/strict";
import test from "node:test";

const serverOnlyPath = require.resolve("server-only");
(require as NodeJS.Require).cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
  isPreloading: false,
  path: serverOnlyPath,
  require: require as NodeJS.Require,
  parent: null,
} as unknown as NodeJS.Module;

/* eslint-disable @typescript-eslint/no-require-imports */
const documentActions = require("./actions") as typeof import("./actions");
/* eslint-enable @typescript-eslint/no-require-imports */

test("deck actions barrel exposes only supported deck save entry points", () => {
  assert.equal(typeof documentActions.saveDeckJson, "function");
  assert.equal("saveDeckPatch" in documentActions, false);
  assert.equal("saveDeckCommand" in documentActions, false);
});
