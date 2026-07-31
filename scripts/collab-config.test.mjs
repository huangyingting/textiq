import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveInternalAppOrigin,
  resolveInlineCollabConfig,
  resolveStandaloneCollabConfig,
} from "./collab-config.mjs";

test("resolveInlineCollabConfig defaults to inline collaboration on app port 4000", () => {
  assert.deepEqual(resolveInlineCollabConfig({}), {
    port: 4000,
    hostname: "0.0.0.0",
    inlineCollab: true,
  });
});

test("resolveInlineCollabConfig preserves explicit process values", () => {
  assert.deepEqual(
    resolveInlineCollabConfig({
      PORT: "5000",
      HOST: "127.0.0.1",
      COLLAB_INLINE: "0",
    }),
    {
      port: 5000,
      hostname: "127.0.0.1",
      inlineCollab: false,
    },
  );
});

test("resolveInternalAppOrigin targets the HTTP listener behind a reverse proxy", () => {
  assert.equal(
    resolveInternalAppOrigin({ hostname: "0.0.0.0", port: 4000 }),
    "http://127.0.0.1:4000",
  );
  assert.equal(
    resolveInternalAppOrigin({ hostname: "::", port: 4100 }),
    "http://[::1]:4100",
  );
  assert.equal(
    resolveInternalAppOrigin({ hostname: "app.internal", port: 4200 }),
    "http://app.internal:4200",
  );
});

test("resolveStandaloneCollabConfig defaults to standalone port 1234", () => {
  assert.deepEqual(resolveStandaloneCollabConfig({}), {
    port: 1234,
    host: "0.0.0.0",
  });
});

test("resolveStandaloneCollabConfig preserves explicit bind values", () => {
  assert.deepEqual(
    resolveStandaloneCollabConfig({
      COLLAB_PORT: "7000",
      COLLAB_HOST: "127.0.0.1",
    }),
    {
      port: 7000,
      host: "127.0.0.1",
    },
  );
});
