/**
 * Behavioral tests for the `setLocaleCookie` server action (#1906).
 *
 * `next/headers` cannot be imported outside a request scope, so this module
 * is stubbed via a module hook (same pattern as
 * `src/app/api/brand/route.test.ts`). The stub's `cookies()` returns an
 * object whose `set()` calls are recorded on `globalThis.__localeActionCalls`
 * so each test can assert exactly what was persisted, while `normaliseLocale`
 * runs for real so the action's input-normalisation contract is asserted
 * end to end rather than mocked away.
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
};
globalForLocaleAction.__localeActionCalls = [];

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
  cookies: async () => ({
    set: (name, value, options) => {
      globalThis.__localeActionCalls.push([name, value, options]);
    },
  }),
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
});

test("setLocaleCookie persists a supported locale unchanged", async () => {
  await actions.setLocaleCookie("es");

  assert.equal(globalForLocaleAction.__localeActionCalls.length, 1);
  const [name, value] = globalForLocaleAction.__localeActionCalls[0];
  assert.equal(name, "textiq-locale");
  assert.equal(value, "es");
});

test("setLocaleCookie normalises an unsupported locale to the default before writing", async () => {
  await actions.setLocaleCookie(
    "fr" as unknown as Parameters<typeof actions.setLocaleCookie>[0],
  );

  const [, value] = globalForLocaleAction.__localeActionCalls[0];
  assert.equal(value, "en");
});

test("setLocaleCookie writes cookie options required for optimistic client reads", async () => {
  await actions.setLocaleCookie("en");

  const [, , options] = globalForLocaleAction.__localeActionCalls[0];
  assert.deepEqual(options, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
    httpOnly: false,
  });
});
