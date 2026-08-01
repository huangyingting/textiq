import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { createApplicationReadinessProbe } from "./readiness";

test("readiness fails closed on missing or throwing required configuration", async () => {
  let databaseChecks = 0;
  const missing = createApplicationReadinessProbe({
    checkDatabase: async () => {
      databaseChecks += 1;
    },
    isConfigurationReady: () => false,
  });
  const throwing = createApplicationReadinessProbe({
    checkDatabase: async () => {
      databaseChecks += 1;
    },
    isConfigurationReady: () => {
      throw new Error("config unavailable");
    },
  });

  assert.equal(await missing(), false);
  assert.equal(await throwing(), false);
  assert.equal(databaseChecks, 0);
});

test("readiness caches successful database checks", async () => {
  let databaseChecks = 0;
  const probe = createApplicationReadinessProbe({
    checkDatabase: async () => {
      databaseChecks += 1;
    },
    isConfigurationReady: () => true,
  });

  assert.equal(await probe(), true);
  assert.equal(await probe(), true);
  assert.equal(databaseChecks, 1);
});

test("readiness caches database failures without throwing", async () => {
  let databaseChecks = 0;
  const probe = createApplicationReadinessProbe({
    checkDatabase: async () => {
      databaseChecks += 1;
      throw new Error("database unavailable");
    },
    isConfigurationReady: () => true,
  });

  assert.equal(await probe(), false);
  assert.equal(await probe(), false);
  assert.equal(databaseChecks, 1);
});

test("readiness shares one in-flight database check across callers", async () => {
  let databaseChecks = 0;
  let resolveDatabase: (() => void) | undefined;
  const database = new Promise<void>((resolve) => {
    resolveDatabase = resolve;
  });
  const probe = createApplicationReadinessProbe({
    checkDatabase: async () => {
      databaseChecks += 1;
      await database;
    },
    isConfigurationReady: () => true,
  });

  const first = probe();
  const second = probe();
  await Promise.resolve();
  assert.equal(databaseChecks, 1);

  resolveDatabase?.();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
});

test("readiness times out without starting duplicate database work", async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ["setTimeout"] });
  let databaseChecks = 0;
  const never = new Promise<void>(() => {});
  const probe = createApplicationReadinessProbe({
    checkDatabase: async () => {
      databaseChecks += 1;
      await never;
    },
    isConfigurationReady: () => true,
  });

  const first = probe();
  await Promise.resolve();
  mock.timers.tick(2_000);
  assert.equal(await first, false);

  const second = probe();
  mock.timers.tick(2_000);
  assert.equal(await second, false);
  assert.equal(databaseChecks, 1);
});

test("required configuration is rechecked even after a cached success", async () => {
  let configurationReady = true;
  const probe = createApplicationReadinessProbe({
    checkDatabase: async () => {},
    isConfigurationReady: () => configurationReady,
  });

  assert.equal(await probe(), true);
  configurationReady = false;
  assert.equal(await probe(), false);
});
