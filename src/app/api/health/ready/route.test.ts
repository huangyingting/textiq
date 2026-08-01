import assert from "node:assert/strict";
import test from "node:test";

import { createReadinessHandler } from "./handler";
import { dynamic, GET, runtime } from "./route";

test("readiness route is dynamic and exposes the configured handler", () => {
  assert.equal(runtime, "nodejs");
  assert.equal(dynamic, "force-dynamic");
  assert.equal(typeof GET, "function");
});

test("readiness returns a non-cacheable minimal success", async () => {
  const handler = createReadinessHandler(async () => true);

  const response = await handler();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ready" });
});

test("readiness returns a minimal 503 without leaking dependency details", async () => {
  const handler = createReadinessHandler(async () => false);

  const response = await handler();

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { status: "not_ready" });
});
