/**
 * Direct render coverage for `VerifyEmailPage` (`src/app/verify-email/[token]/page.tsx`,
 * issue #1962) — the async Server Component that consumes an email
 * verification token and renders the verified/failed outcome.
 *
 * `consumeEmailVerificationToken` (`@/lib/auth/email-verification-service`)
 * is already exhaustively covered by
 * `src/lib/auth/email-verification-service.test.ts` (including every
 * `VERIFICATION_TOKEN_REJECTION_MESSAGE` variant: not-found, expired,
 * already-used), so this stubs that module via `node:module`'s
 * `registerHooks` (matching `src/app/forgot-password/page.test.tsx`'s
 * pattern) instead of re-testing the DB-backed token evaluation itself —
 * only the page's own render/wiring contract (which outcome maps to which
 * heading/role/message, and that the token is decoded before being passed
 * along) is in scope here.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

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

type VerifyOutcome =
  { status: "verified" } | { status: "error"; message: string };

type VerifyEmailPageTestState = {
  calls: unknown[][];
  outcome: VerifyOutcome;
};

const globalForPage = globalThis as typeof globalThis & {
  __verifyEmailPageTestState: VerifyEmailPageTestState;
};

function createDefaultState(): VerifyEmailPageTestState {
  return {
    calls: [],
    outcome: { status: "verified" },
  };
}

globalForPage.__verifyEmailPageTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-verify-email-page-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/lib/auth/email-verification-service",
    `
      export async function consumeEmailVerificationToken(token) {
        globalThis.__verifyEmailPageTestState.calls.push(["consumeEmailVerificationToken", token]);
        return globalThis.__verifyEmailPageTestState.outcome;
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

type PageModule = typeof import("./page");

let VerifyEmailPage: PageModule["default"];
let metadata: PageModule["metadata"];

before(async () => {
  const mod = await import("./page");
  VerifyEmailPage = mod.default;
  metadata = mod.metadata;
});

beforeEach(() => {
  globalForPage.__verifyEmailPageTestState = createDefaultState();
});

function state(): VerifyEmailPageTestState {
  return globalForPage.__verifyEmailPageTestState;
}

function renderPage(token: string) {
  return VerifyEmailPage({ params: Promise.resolve({ token }) });
}

describe("VerifyEmailPage", () => {
  it("exposes the verify-email page title", () => {
    assert.equal(metadata.title, "Verify your email — TextIQ");
  });

  it("decodes the token before handing it to consumeEmailVerificationToken", async () => {
    await renderPage("abc%20def");
    assert.deepEqual(state().calls, [
      ["consumeEmailVerificationToken", "abc def"],
    ]);
  });

  it("renders a verified heading and non-alert confirmation text on success", async () => {
    state().outcome = { status: "verified" };

    const tree = await renderPage("good-token");
    const html = renderToStaticMarkup(tree);

    assert.match(html, /Email verified/);
    assert.match(html, /Thanks — your email address is now verified\./);
    assert.doesNotMatch(html, /role="alert"/);
    assert.match(html, /Back to settings/);
    assert.match(html, /href="\/app\/settings"/);
  });

  for (const [reason, expectedMessage] of [
    [
      "not_found",
      "This verification link is invalid. Request a new one from settings.",
    ],
    [
      "expired",
      "This verification link has expired. Request a new one from settings.",
    ],
    ["used", "This email has already been verified."],
  ] as const) {
    it(`renders a "Verification failed" alert with the service's message for a(n) ${reason} token`, async () => {
      state().outcome = { status: "error", message: expectedMessage };

      const tree = await renderPage("bad-token");
      const html = renderToStaticMarkup(tree);

      assert.match(html, /Verification failed/);
      assert.match(html, /role="alert"/);
      assert.match(
        html,
        new RegExp(expectedMessage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
      assert.match(html, /Back to settings/);
    });
  }
});
