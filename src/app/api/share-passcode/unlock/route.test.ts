/**
 * Behavioral tests for POST /api/share-passcode/unlock (issue #1852).
 *
 * Coverage goals:
 *   - Malformed / missing shareId → redirect with ?passcode=invalid
 *   - Rate-limit budget exceeded   → redirect with ?passcode=limited
 *   - Non-existent document        → plain redirect (no status param)
 *   - Document with no passcode protection → plain redirect
 *   - Share access denied (not shared) → redirect with ?passcode=invalid
 *   - Wrong passcode               → redirect with ?passcode=invalid
 *   - Missing AUTH_SECRET          → redirect with ?passcode=invalid
 *   - Correct passcode + secret    → redirect + unlock cookie set
 *
 * Module-hook approach (mirrors server-actions.test.ts):
 *   `@/app/public-abuse` is stubbed because it calls `headers()` from
 *   next/headers, which is unavailable outside a live Next.js request context.
 *   `@/lib/prisma` is imported directly and patched per-test (matches the
 *   pattern in src/lib/workspace/service.test.ts).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, test } from "node:test";

import { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  hashSharePasscode,
  sharePasscodeCookieName,
} from "@/lib/share-passcode";

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

type AbuseTestState = {
  budgetExceeded: boolean;
  budgetChecks: number;
};

const globalForAbuse = globalThis as typeof globalThis & {
  __sharePasscodeAbuseState: AbuseTestState;
};

globalForAbuse.__sharePasscodeAbuseState = {
  budgetExceeded: false,
  budgetChecks: 0,
};

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-share-passcode-unlock-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/app/public-abuse",
    `
      export async function publicSharePasscodeBudgetExceeded() {
        globalThis.__sharePasscodeAbuseState.budgetChecks += 1;
        return globalThis.__sharePasscodeAbuseState.budgetExceeded;
      }
    `,
  ],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (stubbedModules.has(specifier)) {
      return {
        url: `${stubPrefix}${encodeURIComponent(specifier)}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(stubPrefix)) {
      const specifier = decodeURIComponent(url.slice(stubPrefix.length));
      return {
        format: "module",
        source: stubbedModules.get(specifier) ?? "",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

type RouteModule = typeof import("./route");
let POST: RouteModule["POST"];

/** Pre-computed bcrypt hash of the test passcode. */
let PASSCODE_HASH: string;
const TEST_PASSCODE = "correctpasscode";
const SHARE_ID = "test-share-abc123";
const RETURN_TO = "/share/abc123";
const CANONICAL_APP_URL = "https://textiq.test";
const previousAppUrl = process.env.NEXT_PUBLIC_APP_URL;

before(async () => {
  const mod = await import("./route");
  POST = mod.POST;
  PASSCODE_HASH = await hashSharePasscode(TEST_PASSCODE);
});

beforeEach(() => {
  globalForAbuse.__sharePasscodeAbuseState = {
    budgetExceeded: false,
    budgetChecks: 0,
  };
  process.env.AUTH_SECRET = "ci-placeholder";
  process.env.NEXT_PUBLIC_APP_URL = CANONICAL_APP_URL;
});

after(() => {
  if (previousAppUrl === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = previousAppUrl;
  }
});

/** A document row that passes all share-access checks and has a passcode. */
function makeSharedDocument(overrides: Record<string, unknown> = {}) {
  return {
    shareId: SHARE_ID,
    isShared: true,
    deletedAt: null,
    shareExpiresAt: null,
    shareEmbedEnabled: true,
    sharePresentEnabled: true,
    sharePasscodeHash: PASSCODE_HASH,
    shareMetadataMode: "generic",
    shareDiscoverable: false,
    ...overrides,
  };
}

function mutablePrisma(): Record<string, unknown> {
  return prisma as unknown as Record<string, unknown>;
}

function replacePrismaDocument(
  t: { after(callback: () => void): void },
  impl: (args: unknown) => Promise<unknown>,
) {
  const target = mutablePrisma();
  const original = target["document"];
  target["document"] = {
    ...(original as object),
    async findFirst(args: unknown) {
      return impl(args);
    },
  };
  t.after(() => {
    target["document"] = original;
  });
}

function makeRequest(formFields: Record<string, string> = {}): NextRequest {
  const form = new URLSearchParams(formFields);
  return new NextRequest("http://localhost/api/share-passcode/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

function makeMultipartRequest(
  formFields: Record<string, string> = {},
): NextRequest {
  const form = new FormData();
  for (const [key, value] of Object.entries(formFields)) {
    form.set(key, value);
  }
  return new NextRequest("http://localhost/api/share-passcode/unlock", {
    method: "POST",
    body: form,
  });
}

function redirectLocation(response: Response): string {
  return response.headers.get("location") ?? "";
}

// ---------------------------------------------------------------------------
// Malformed input — missing / blank shareId
// ---------------------------------------------------------------------------

test("#1852: missing shareId redirects to /share?passcode=invalid", async (t) => {
  replacePrismaDocument(t, async () => null);
  const response = await POST(makeRequest({ returnTo: RETURN_TO }));
  assert.strictEqual(response.status, 303);
  const location = redirectLocation(response);
  assert.ok(
    location.includes("passcode=invalid"),
    `expected passcode=invalid in ${location}`,
  );
  assert.ok(
    location.includes("/share"),
    `expected /share default path in ${location}`,
  );
});

test("#1852: empty shareId string redirects with invalid status", async (t) => {
  replacePrismaDocument(t, async () => null);
  const response = await POST(
    makeRequest({ shareId: "   ", returnTo: RETURN_TO }),
  );
  assert.strictEqual(response.status, 303);
  assert.ok(redirectLocation(response).includes("passcode=invalid"));
});

test("#2097: oversized form body returns 413 before rate limit or document lookup", async (t) => {
  replacePrismaDocument(t, async () => {
    assert.fail("oversized unlock forms must not query documents");
  });
  const response = await POST(
    new NextRequest("http://localhost/api/share-passcode/unlock", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": String(9 * 1024),
      },
      body: "shareId=ignored",
    }),
  );

  assert.strictEqual(response.status, 413);
  assert.strictEqual(globalForAbuse.__sharePasscodeAbuseState.budgetChecks, 0);
});

test("#2097: malformed form body returns 400 before rate limit or document lookup", async (t) => {
  replacePrismaDocument(t, async () => {
    assert.fail("malformed unlock forms must not query documents");
  });
  const response = await POST(
    new NextRequest("http://localhost/api/share-passcode/unlock", {
      method: "POST",
      body: "not form data",
    }),
  );

  assert.strictEqual(response.status, 400);
  assert.strictEqual(globalForAbuse.__sharePasscodeAbuseState.budgetChecks, 0);
});

// ---------------------------------------------------------------------------
// Rate-limit budget exceeded
// ---------------------------------------------------------------------------

test("#1852: rate-limit budget exceeded redirects with ?passcode=limited", async (t) => {
  replacePrismaDocument(t, async () => makeSharedDocument());
  globalForAbuse.__sharePasscodeAbuseState.budgetExceeded = true;

  const response = await POST(
    makeRequest({ shareId: SHARE_ID, returnTo: RETURN_TO }),
  );
  assert.strictEqual(response.status, 303);
  const location = redirectLocation(response);
  assert.ok(
    location.includes("passcode=limited"),
    `expected passcode=limited in ${location}`,
  );
});

// ---------------------------------------------------------------------------
// Non-existent / unprotected share
// ---------------------------------------------------------------------------

test("#1852: non-existent document redirects to returnTo without status param", async (t) => {
  replacePrismaDocument(t, async () => null);
  const response = await POST(
    makeRequest({ shareId: SHARE_ID, returnTo: RETURN_TO }),
  );
  assert.strictEqual(response.status, 303);
  const location = redirectLocation(response);
  assert.ok(
    !location.includes("passcode="),
    `expected no passcode param in ${location}`,
  );
  assert.ok(
    location.includes("/share/abc123"),
    `expected returnTo in ${location}`,
  );
});

test("#1852: document with no passcode hash redirects to returnTo without status param", async (t) => {
  replacePrismaDocument(t, async () =>
    makeSharedDocument({ sharePasscodeHash: null }),
  );
  const response = await POST(
    makeRequest({ shareId: SHARE_ID, returnTo: RETURN_TO }),
  );
  assert.strictEqual(response.status, 303);
  const location = redirectLocation(response);
  assert.ok(!location.includes("passcode="));
  assert.ok(location.includes("/share/abc123"));
});

// ---------------------------------------------------------------------------
// Share access denied
// ---------------------------------------------------------------------------

test("#1852: inactive share (isShared=false) redirects with ?passcode=invalid", async (t) => {
  replacePrismaDocument(t, async () => makeSharedDocument({ isShared: false }));
  const response = await POST(
    makeRequest({ shareId: SHARE_ID, returnTo: RETURN_TO }),
  );
  assert.strictEqual(response.status, 303);
  assert.ok(redirectLocation(response).includes("passcode=invalid"));
});

// ---------------------------------------------------------------------------
// Wrong passcode
// ---------------------------------------------------------------------------

test("#1852: wrong passcode redirects with ?passcode=invalid", async (t) => {
  replacePrismaDocument(t, async () => makeSharedDocument());
  const response = await POST(
    makeRequest({
      shareId: SHARE_ID,
      passcode: "totally-wrong-passcode",
      returnTo: RETURN_TO,
    }),
  );
  assert.strictEqual(response.status, 303);
  assert.strictEqual(
    redirectLocation(response),
    `${CANONICAL_APP_URL}${RETURN_TO}?passcode=invalid`,
  );
});

test("#2097: missing FormData passcode redirects invalid without setting an unlock cookie", async (t) => {
  replacePrismaDocument(t, async () => makeSharedDocument());
  const response = await POST(
    makeMultipartRequest({
      shareId: SHARE_ID,
      returnTo: RETURN_TO,
    }),
  );

  assert.strictEqual(response.status, 303);
  assert.ok(redirectLocation(response).includes("passcode=invalid"));
  assert.strictEqual(response.headers.get("set-cookie"), null);
  assert.strictEqual(globalForAbuse.__sharePasscodeAbuseState.budgetChecks, 1);
});

test("#2097: incorrect FormData passcode redirects invalid without setting an unlock cookie", async (t) => {
  replacePrismaDocument(t, async () => makeSharedDocument());
  const response = await POST(
    makeMultipartRequest({
      shareId: SHARE_ID,
      passcode: "totally-wrong-passcode",
      returnTo: RETURN_TO,
    }),
  );

  assert.strictEqual(response.status, 303);
  assert.ok(redirectLocation(response).includes("passcode=invalid"));
  assert.strictEqual(response.headers.get("set-cookie"), null);
  assert.strictEqual(globalForAbuse.__sharePasscodeAbuseState.budgetChecks, 1);
});

// ---------------------------------------------------------------------------
// Missing AUTH_SECRET
// ---------------------------------------------------------------------------

test("#1852: missing AUTH_SECRET redirects with ?passcode=invalid even when passcode correct", async (t) => {
  const saved = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  t.after(() => {
    if (saved !== undefined) {
      process.env.AUTH_SECRET = saved;
    }
  });

  replacePrismaDocument(t, async () => makeSharedDocument());
  const response = await POST(
    makeRequest({
      shareId: SHARE_ID,
      passcode: TEST_PASSCODE,
      returnTo: RETURN_TO,
    }),
  );
  assert.strictEqual(response.status, 303);
  assert.ok(redirectLocation(response).includes("passcode=invalid"));
});

// ---------------------------------------------------------------------------
// Successful unlock — cookie set
// ---------------------------------------------------------------------------

test("#1852: correct passcode + secret sets unlock cookie and redirects to returnTo", async (t) => {
  replacePrismaDocument(t, async () => makeSharedDocument());
  const response = await POST(
    makeRequest({
      shareId: SHARE_ID,
      passcode: TEST_PASSCODE,
      returnTo: RETURN_TO,
    }),
  );

  assert.strictEqual(response.status, 303);

  const location = redirectLocation(response);
  assert.ok(
    !location.includes("passcode="),
    `unexpected passcode param in success redirect: ${location}`,
  );
  assert.ok(location.includes("/share/abc123"));

  const cookieName = sharePasscodeCookieName(SHARE_ID);
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.ok(
    setCookie.includes(cookieName),
    `expected cookie '${cookieName}' in set-cookie header: ${setCookie}`,
  );
  assert.ok(setCookie.includes("HttpOnly"), "unlock cookie must be HttpOnly");
});

test("#1852: unlock cookie for a safe returnTo path uses the full return path", async (t) => {
  replacePrismaDocument(t, async () => makeSharedDocument());
  const response = await POST(
    makeRequest({
      shareId: SHARE_ID,
      passcode: TEST_PASSCODE,
      returnTo: "/present/abc123",
    }),
  );
  assert.strictEqual(response.status, 303);
  assert.ok(redirectLocation(response).includes("/present/abc123"));
});

test("#2097: correct FormData passcode sets unlock cookie", async (t) => {
  replacePrismaDocument(t, async () => makeSharedDocument());
  const response = await POST(
    makeMultipartRequest({
      shareId: SHARE_ID,
      passcode: TEST_PASSCODE,
      returnTo: RETURN_TO,
    }),
  );

  assert.strictEqual(response.status, 303);
  assert.ok(!redirectLocation(response).includes("passcode="));
  assert.ok(
    (response.headers.get("set-cookie") ?? "").includes(
      sharePasscodeCookieName(SHARE_ID),
    ),
  );
  assert.strictEqual(globalForAbuse.__sharePasscodeAbuseState.budgetChecks, 1);
});
