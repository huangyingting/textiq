/**
 * Direct contract coverage for `isPublicSharePasscodeUnlocked` (#1945).
 *
 * `share-passcode-server.ts` carries `import "server-only"` (throws outside
 * a Next.js Server Component build) and calls `cookies()` from
 * `next/headers` (throws outside a live request scope). Following the
 * module-hooks pattern used by `src/lib/document-editor/loader.test.ts` and
 * `src/lib/i18n/actions.test.ts`, this stubs both specifiers: `server-only`
 * to an empty module, and `next/headers`'s `cookies()` to a controllable
 * fake cookie jar. `isSharePasscodeUnlockTokenValid` / `sharePasscodeCookieName`
 * / `createSharePasscodeUnlockToken` run for real (from `@/lib/share-passcode`,
 * already unit-tested independently) so the HMAC signature/expiry contract
 * is exercised authentically rather than mocked away. `AUTH_SECRET` is
 * toggled directly via `process.env` since `auth.secret()` reads it live.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, before, test } from "node:test";

import {
  createSharePasscodeUnlockToken,
  sharePasscodeCookieName,
} from "@/lib/share-passcode";
import type { ShareAccessFields } from "@/lib/share-access";

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

const globalForSharePasscode = globalThis as typeof globalThis & {
  __sharePasscodeServerCookies: Map<string, string>;
  __sharePasscodeServerCookieGetCalls: string[];
};

globalForSharePasscode.__sharePasscodeServerCookies = new Map();
globalForSharePasscode.__sharePasscodeServerCookieGetCalls = [];

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const serverOnlyStubUrl = "server-only:share-passcode-server-test";
const nextHeadersStubUrl = "next-headers:share-passcode-server-test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: serverOnlyStubUrl, shortCircuit: true };
    }
    if (specifier === "next/headers") {
      return { url: nextHeadersStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === serverOnlyStubUrl) {
      return { format: "commonjs", source: "", shortCircuit: true };
    }
    if (url === nextHeadersStubUrl) {
      return {
        format: "module",
        source: `
          export async function cookies() {
            return {
              get(name) {
                globalThis.__sharePasscodeServerCookieGetCalls.push(name);
                const value = globalThis.__sharePasscodeServerCookies.get(name);
                return value === undefined ? undefined : { value };
              },
            };
          }
        `,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

type ShareServerModule = typeof import("./share-passcode-server");
let isPublicSharePasscodeUnlocked: ShareServerModule["isPublicSharePasscodeUnlocked"];

before(async () => {
  const mod = await import("./share-passcode-server");
  isPublicSharePasscodeUnlocked = mod.isPublicSharePasscodeUnlocked;
});

const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;

afterEach(() => {
  globalForSharePasscode.__sharePasscodeServerCookies = new Map();
  globalForSharePasscode.__sharePasscodeServerCookieGetCalls = [];
  if (ORIGINAL_AUTH_SECRET === undefined) {
    delete process.env.AUTH_SECRET;
  } else {
    process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
  }
});

function setUnlockCookie(shareId: string, token: string) {
  globalForSharePasscode.__sharePasscodeServerCookies.set(
    sharePasscodeCookieName(shareId),
    token,
  );
}

function shareAccessRow(
  overrides: Partial<ShareAccessFields> = {},
): ShareAccessFields {
  return {
    shareId: "share-1",
    isShared: true,
    deletedAt: null,
    shareExpiresAt: null,
    shareEmbedEnabled: true,
    sharePresentEnabled: true,
    sharePasscodeHash: null,
    ...overrides,
  };
}

test("returns true without reading any cookie when the document has no passcode protection", async () => {
  const unlocked = await isPublicSharePasscodeUnlocked(
    shareAccessRow({ sharePasscodeHash: null }),
    "share-1",
  );

  assert.equal(unlocked, true);
  assert.equal(
    globalForSharePasscode.__sharePasscodeServerCookieGetCalls.length,
    0,
  );
});

test("returns false without reading any cookie when AUTH_SECRET is unset", async () => {
  delete process.env.AUTH_SECRET;

  const unlocked = await isPublicSharePasscodeUnlocked(
    shareAccessRow({ sharePasscodeHash: "hashed-passcode" }),
    "share-1",
  );

  assert.equal(unlocked, false);
  assert.equal(
    globalForSharePasscode.__sharePasscodeServerCookieGetCalls.length,
    0,
  );
});

test("returns false when no unlock cookie is present for the share's cookie name", async () => {
  process.env.AUTH_SECRET = "test-secret";

  const unlocked = await isPublicSharePasscodeUnlocked(
    shareAccessRow({ sharePasscodeHash: "hashed-passcode" }),
    "share-1",
  );

  assert.equal(unlocked, false);
  assert.deepEqual(globalForSharePasscode.__sharePasscodeServerCookieGetCalls, [
    sharePasscodeCookieName("share-1"),
  ]);
});

test("returns true for a cookie token signed for this shareId and passcode hash", async () => {
  process.env.AUTH_SECRET = "test-secret";
  const token = createSharePasscodeUnlockToken({
    shareId: "share-1",
    passcodeHash: "hashed-passcode",
    secret: "test-secret",
  });
  setUnlockCookie("share-1", token);

  const unlocked = await isPublicSharePasscodeUnlocked(
    shareAccessRow({ sharePasscodeHash: "hashed-passcode" }),
    "share-1",
  );

  assert.equal(unlocked, true);
});

test("returns false when the cookie token was signed for a different shareId", async () => {
  process.env.AUTH_SECRET = "test-secret";
  const tokenForOtherShare = createSharePasscodeUnlockToken({
    shareId: "share-other",
    passcodeHash: "hashed-passcode",
    secret: "test-secret",
  });
  // Placed under this document's own cookie name, simulating a forged/replayed token.
  setUnlockCookie("share-1", tokenForOtherShare);

  const unlocked = await isPublicSharePasscodeUnlocked(
    shareAccessRow({ sharePasscodeHash: "hashed-passcode" }),
    "share-1",
  );

  assert.equal(unlocked, false);
});

test("returns false when the cookie token was signed with a different secret", async () => {
  process.env.AUTH_SECRET = "test-secret";
  const token = createSharePasscodeUnlockToken({
    shareId: "share-1",
    passcodeHash: "hashed-passcode",
    secret: "a-different-secret",
  });
  setUnlockCookie("share-1", token);

  const unlocked = await isPublicSharePasscodeUnlocked(
    shareAccessRow({ sharePasscodeHash: "hashed-passcode" }),
    "share-1",
  );

  assert.equal(unlocked, false);
});

test("returns false once the unlock token has expired", async () => {
  process.env.AUTH_SECRET = "test-secret";
  const now = Date.now();
  const token = createSharePasscodeUnlockToken({
    shareId: "share-1",
    passcodeHash: "hashed-passcode",
    secret: "test-secret",
    // Sign as though issued far enough in the past that it is already expired.
    now: now - 24 * 60 * 60 * 1000,
  });
  setUnlockCookie("share-1", token);

  const unlocked = await isPublicSharePasscodeUnlocked(
    shareAccessRow({ sharePasscodeHash: "hashed-passcode" }),
    "share-1",
  );

  assert.equal(unlocked, false);
});

test("returns false when the passcode hash on the cookie-signing side changed since the cookie was issued", async () => {
  process.env.AUTH_SECRET = "test-secret";
  const token = createSharePasscodeUnlockToken({
    shareId: "share-1",
    passcodeHash: "old-passcode-hash",
    secret: "test-secret",
  });
  setUnlockCookie("share-1", token);

  const unlocked = await isPublicSharePasscodeUnlocked(
    shareAccessRow({ sharePasscodeHash: "rotated-passcode-hash" }),
    "share-1",
  );

  assert.equal(unlocked, false);
});
