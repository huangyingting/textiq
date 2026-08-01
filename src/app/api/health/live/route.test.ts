import assert from "node:assert/strict";
import test from "node:test";

import { dynamic, GET, runtime } from "./route";

test("liveness is dynamic, dependency-free, and non-cacheable", async () => {
  const response = GET();

  assert.equal(runtime, "nodejs");
  assert.equal(dynamic, "force-dynamic");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ok" });
});
