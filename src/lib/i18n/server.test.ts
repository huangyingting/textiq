/**
 * Behavioral tests for `getLocale()` (#1906).
 *
 * `next/headers` cannot be imported outside a request scope, so it is
 * stubbed via a module hook (same pattern as `src/lib/i18n/actions.test.ts`
 * and `src/app/api/brand/route.test.ts`). `globalThis.__localeServerCookie`
 * controls what the stubbed cookie store returns for the `textiq-locale`
 * cookie so each test can cover the supported / unsupported / missing cases
 * without a real request scope, while `normaliseLocale` runs for real.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, test } from "node:test";

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

const globalForLocaleServer = globalThis as typeof globalThis & {
  __localeServerCookie: string | undefined;
};
globalForLocaleServer.__localeServerCookie = undefined;

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const NEXT_HEADERS_STUB = "next-headers:locale-server-stub";

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
    get: (name) => {
      if (name !== "textiq-locale") return undefined;
      const value = globalThis.__localeServerCookie;
      return value === undefined ? undefined : { name, value };
    },
  }),
};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

type ServerModule = typeof import("./server");

let server: ServerModule;

before(async () => {
  server = await import("./server");
});

beforeEach(() => {
  globalForLocaleServer.__localeServerCookie = undefined;
});

test("LOCALE_COOKIE exposes the canonical cookie name", () => {
  assert.equal(server.LOCALE_COOKIE, "textiq-locale");
});

test("getLocale returns the cookie value when it is a supported locale", async () => {
  globalForLocaleServer.__localeServerCookie = "es";
  assert.equal(await server.getLocale(), "es");
});

test("getLocale normalises an unsupported cookie value to the default locale", async () => {
  globalForLocaleServer.__localeServerCookie = "fr";
  assert.equal(await server.getLocale(), "en");
});

test("getLocale falls back to the default locale when the cookie is missing", async () => {
  globalForLocaleServer.__localeServerCookie = undefined;
  assert.equal(await server.getLocale(), "en");
});

test("getLocale strips BCP-47 region subtags from the cookie value", async () => {
  globalForLocaleServer.__localeServerCookie = "en-GB";
  assert.equal(await server.getLocale(), "en");
});
