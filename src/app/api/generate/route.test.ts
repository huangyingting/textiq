/**
 * Top-level export/runtime contract for `POST /api/generate` (#1882).
 * Route-specific config wiring is covered by `route-config.test.ts`; the
 * shared handler internals are covered by `generation-route.test.ts`. This
 * file only asserts what the route module itself statically exports.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import * as route from "./route";

test("#1882: generate route pins the Node.js runtime (Azure/node:crypto need it)", () => {
  assert.equal(route.runtime, "nodejs");
});

test("#1882: generate route exports a single POST handler", () => {
  assert.equal(typeof route.POST, "function");
  assert.equal(route.POST.length, 1);
  assert.deepEqual(Object.keys(route).sort(), ["POST", "runtime"]);
});
