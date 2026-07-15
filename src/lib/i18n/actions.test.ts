/**
 * Behavioral tests for the `setLocaleCookie` server action (#1906).
 *
 * `next/headers` cannot be imported outside a request scope, so this module
 * is stubbed via a module hook (same pattern as
 * `src/app/api/brand/route.test.ts`). The stub's `cookies()` returns an
 * object whose `set()` calls are recorded on `globalThis.__localeActionCalls`
 * so each test can assert exactly what was persisted, while the canonical
 * strict locale guard runs for real so invalid input is rejected before the
 * request cookie store is accessed.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { beforeEach, before, test } from "node:test";

type ModuleHooks = {
  registerHooks(hooks: {
    resolve(
      specifier: string,
      context: unknown,
      nextResolve: (specifier: string, context: unknown) => unknown,
    ): unknown;
    load(
      url: string,
      context: unknown,
      nextLoad: (url: string, context: unknown) => unknown,
    ): unknown;
  }): void;
};

type SetCall = [name: string, value: string, options: Record<string, unknown>];

const globalForLocaleAction = globalThis as typeof globalThis & {
  __localeActionCalls: SetCall[];
  __localeActionCookieCalls: number;
  __localeActionSetFailure: Error | null;
};
globalForLocaleAction.__localeActionCalls = [];
globalForLocaleAction.__localeActionCookieCalls = 0;
globalForLocaleAction.__localeActionSetFailure = null;

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const NEXT_HEADERS_STUB = "next-headers:locale-action-stub";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") {
      return { url: NEXT_HEADERS_STUB, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === NEXT_HEADERS_STUB) {
      return {
        format: "commonjs" as const,
        source: `module.exports = {
  cookies: async () => {
    globalThis.__localeActionCookieCalls += 1;
    return {
      set: (name, value, options) => {
        if (globalThis.__localeActionSetFailure) {
          throw globalThis.__localeActionSetFailure;
        }
        globalThis.__localeActionCalls.push([name, value, options]);
      },
    };
  },
};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

type ActionsModule = typeof import("./actions");

let actions: ActionsModule;

before(async () => {
  actions = await import("./actions");
});

beforeEach(() => {
  globalForLocaleAction.__localeActionCalls = [];
  globalForLocaleAction.__localeActionCookieCalls = 0;
  globalForLocaleAction.__localeActionSetFailure = null;
});

test("setLocaleCookie persists a supported locale unchanged", async () => {
  const result = await actions.setLocaleCookie("es");

  assert.deepEqual(result, { ok: true, data: undefined });
  assert.equal(globalForLocaleAction.__localeActionCookieCalls, 1);
  assert.equal(globalForLocaleAction.__localeActionCalls.length, 1);
  const [name, value] = globalForLocaleAction.__localeActionCalls[0];
  assert.equal(name, "textiq-locale");
  assert.equal(value, "es");
});

test("setLocaleCookie rejects unsupported and non-exact locale strings before reading cookies", async () => {
  for (const locale of ["fr", "en-US", "es_MX", "EN", ""]) {
    const result = await actions.setLocaleCookie(locale);
    assert.deepEqual(result, {
      ok: false,
      error: "Invalid language selection.",
    });
  }

  assert.equal(globalForLocaleAction.__localeActionCookieCalls, 0);
  assert.deepEqual(globalForLocaleAction.__localeActionCalls, []);
});

test("setLocaleCookie rejects non-string action input before reading cookies", async () => {
  for (const locale of [42, null, undefined, {}, ["es"]]) {
    const result = await actions.setLocaleCookie(locale);
    assert.deepEqual(result, {
      ok: false,
      error: "Invalid language selection.",
    });
  }

  assert.equal(globalForLocaleAction.__localeActionCookieCalls, 0);
  assert.deepEqual(globalForLocaleAction.__localeActionCalls, []);
});

test("setLocaleCookie writes the shared server-owned cookie policy", async () => {
  await actions.setLocaleCookie("en");

  const [, , options] = globalForLocaleAction.__localeActionCalls[0];
  assert.deepEqual(options, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
    httpOnly: true,
  });
});

test("setLocaleCookie returns a user-facing failure when cookie persistence fails", async () => {
  globalForLocaleAction.__localeActionSetFailure = new Error(
    "cookie write failed",
  );

  const result = await actions.setLocaleCookie("es");

  assert.deepEqual(result, {
    ok: false,
    error: "Unable to save your language preference. Please try again.",
  });
  assert.equal(globalForLocaleAction.__localeActionCookieCalls, 1);
  assert.deepEqual(globalForLocaleAction.__localeActionCalls, []);
});
