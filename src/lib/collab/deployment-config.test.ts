import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildHealthSummary,
  resolveDeploymentConfig,
} from "./deployment-config";
import { resolveDeploymentConfig as resolveDeploymentConfigMjs } from "../../../scripts/collab-deployment-config.mjs";

// ---------------------------------------------------------------------------
// resolveDeploymentConfig — mode / warnings / healthy from env vars
// ---------------------------------------------------------------------------

test("resolveDeploymentConfig: COLLAB_SINGLE_INSTANCE=1 → single-instance, no warnings, healthy", () => {
  const cfg = resolveDeploymentConfig({ COLLAB_SINGLE_INSTANCE: "1" });
  assert.equal(cfg.mode, "single-instance");
  assert.deepEqual(cfg.warnings, []);
  assert.equal(cfg.healthy, true);
});

test("resolveDeploymentConfig: COLLAB_SINGLE_INSTANCE=true → single-instance, no warnings, healthy", () => {
  const cfg = resolveDeploymentConfig({ COLLAB_SINGLE_INSTANCE: "true" });
  assert.equal(cfg.mode, "single-instance");
  assert.deepEqual(cfg.warnings, []);
  assert.equal(cfg.healthy, true);
});

test("resolveDeploymentConfig: multi-instance without sticky routing → unconfigured, unhealthy, divergence warning", () => {
  const cfg = resolveDeploymentConfig({ COLLAB_INSTANCE_COUNT: "3" });
  assert.equal(cfg.mode, "unconfigured");
  assert.equal(cfg.healthy, false);
  assert.equal(cfg.warnings.length, 1);
  assert.match(cfg.warnings[0], /COLLAB_INSTANCE_COUNT=3/);
  assert.match(cfg.warnings[0], /COLLAB_STICKY_ROUTING/);
});

test("resolveDeploymentConfig: multi-instance with sticky routing → unconfigured, healthy, no warnings", () => {
  const cfg = resolveDeploymentConfig({
    COLLAB_INSTANCE_COUNT: "3",
    COLLAB_STICKY_ROUTING: "1",
  });
  assert.equal(cfg.mode, "unconfigured");
  assert.equal(cfg.healthy, true);
  assert.deepEqual(cfg.warnings, []);
});

test("resolveDeploymentConfig: defaults (empty env) → unconfigured, healthy, soft advisory warning", () => {
  const cfg = resolveDeploymentConfig({});
  assert.equal(cfg.mode, "unconfigured");
  assert.equal(cfg.healthy, true);
  assert.equal(cfg.warnings.length, 1);
  assert.match(cfg.warnings[0], /COLLAB_SINGLE_INSTANCE/);
});

test("resolveDeploymentConfig: COLLAB_INSTANCE_COUNT=1 (explicit but default) → unconfigured, healthy, soft advisory", () => {
  const cfg = resolveDeploymentConfig({ COLLAB_INSTANCE_COUNT: "1" });
  assert.equal(cfg.mode, "unconfigured");
  assert.equal(cfg.healthy, true);
  assert.equal(cfg.warnings.length, 1);
});

test("resolveDeploymentConfig parity: TypeScript and plain-ESM surfaces stay identical across representative env modes", () => {
  const cases = [
    {
      name: "declared single instance",
      env: { COLLAB_SINGLE_INSTANCE: "1" },
    },
    {
      name: "multi-instance without sticky routing",
      env: { COLLAB_INSTANCE_COUNT: "3" },
    },
    {
      name: "multi-instance with sticky routing",
      env: { COLLAB_INSTANCE_COUNT: "3", COLLAB_STICKY_ROUTING: "true" },
    },
    {
      name: "default advisory",
      env: {},
    },
    {
      name: "invalid COLLAB_INSTANCE_COUNT normalizes to default advisory",
      env: { COLLAB_INSTANCE_COUNT: "banana" },
    },
    {
      name: "non-positive COLLAB_INSTANCE_COUNT clamps to 1",
      env: { COLLAB_INSTANCE_COUNT: "0", COLLAB_STICKY_ROUTING: "1" },
    },
  ] as const;

  for (const testCase of cases) {
    const tsResult = resolveDeploymentConfig(testCase.env);
    const mjsResult = resolveDeploymentConfigMjs(testCase.env);
    assert.deepEqual(
      mjsResult,
      tsResult,
      `deployment config mismatch for case: ${testCase.name}`,
    );
  }
});

// ---------------------------------------------------------------------------
// buildHealthSummary — shape and field composition
// ---------------------------------------------------------------------------

test("buildHealthSummary: produces correct shape from stats + config", () => {
  const config = resolveDeploymentConfig({ COLLAB_SINGLE_INSTANCE: "1" });
  const summary = buildHealthSummary({ rooms: 4, connections: 12 }, config);

  assert.equal(summary.ok, true);
  assert.equal(summary.rooms, 4);
  assert.equal(summary.connections, 12);
  assert.equal(summary.mode, "single-instance");
  assert.deepEqual(summary.warnings, []);
  assert.equal(summary.healthy, true);
});

test("buildHealthSummary: unhealthy config sets ok=false", () => {
  const config = resolveDeploymentConfig({ COLLAB_INSTANCE_COUNT: "2" });
  const summary = buildHealthSummary({ rooms: 0, connections: 0 }, config);

  assert.equal(summary.ok, false);
  assert.equal(summary.healthy, false);
  assert.equal(summary.warnings.length, 1);
});
