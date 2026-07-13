/**
 * Direct render coverage for the public `/present/[shareId]` chrome-on
 * presentation viewer page (`page.tsx`) (#1960).
 *
 * Uses the same module-hooks strategy as `/present/[shareId]/embed`: stubs
 * `next/navigation`, `@/app/public-abuse`, `@/lib/public-render/resolver`,
 * and `@/lib/share-passcode-server` (each touches a live request/database
 * outside of a real Next.js request). `@/lib/public-render/metadata`'s
 * `buildPublicMetadata` (pure, already covered directly by its own
 * `metadata.test.ts`) and `@/components/presentation/public-present-viewer`
 * are imported for real so the actual composed `generateMetadata` output and
 * document markup can be asserted.
 *
 * Coverage here: `generateMetadata`'s resolver call-argument wiring
 * (mode="present", projection="metadata") and its metadata passthrough for
 * both a resolved document and a denied/anonymous fallback; the default
 * export's abuse-budget short-circuit; the presentation-projection resolver
 * call wiring; the passcode-required gate (present mode/returnTo, resolved
 * shareId, invalid/limited query variants); notFound() for other deny
 * reasons and a defensive projection mismatch; and the successful full-chrome
 * render (top HUD present, unlike the embed page) with real slide content
 * and the attribution badge.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, it } from "node:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildDeck } from "@/test/builders/presentation-deck";

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

type PresentPageTestState = {
  budgetExceeded: boolean;
  resolverCalls: unknown[][];
  resolverResult: Record<string, unknown> | null;
  notFoundCalls: unknown[][];
};

const globalForPage = globalThis as typeof globalThis & {
  __presentPageTestState: PresentPageTestState;
};

function createDefaultState(): PresentPageTestState {
  return {
    budgetExceeded: false,
    resolverCalls: [],
    resolverResult: null,
    notFoundCalls: [],
  };
}

globalForPage.__presentPageTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-present-page-test:";
const stubbedModules = new Map<string, string>([
  [
    "next/navigation",
    `
      export function notFound() {
        globalThis.__presentPageTestState.notFoundCalls.push([]);
        throw new Error("NEXT_NOT_FOUND");
      }
    `,
  ],
  [
    "@/app/public-abuse",
    `
      export async function publicShareBudgetExceeded() {
        return globalThis.__presentPageTestState.budgetExceeded;
      }
    `,
  ],
  [
    "@/lib/public-render/resolver",
    `
      export async function resolvePublicRender(input) {
        globalThis.__presentPageTestState.resolverCalls.push([input]);
        return globalThis.__presentPageTestState.resolverResult;
      }
    `,
  ],
  [
    "@/lib/share-passcode-server",
    `
      export async function isPublicSharePasscodeUnlocked() {
        return false;
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
let PresentPage: PageModule["default"];
let generateMetadata: PageModule["generateMetadata"];

before(async () => {
  const mod = await import("./page");
  PresentPage = mod.default;
  generateMetadata = mod.generateMetadata;
});

beforeEach(() => {
  globalForPage.__presentPageTestState = createDefaultState();
});

function state(): PresentPageTestState {
  return globalForPage.__presentPageTestState;
}

function presentationResult(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ok: true,
    mode: "present",
    projection: "presentation",
    shareId: "resolved-share-1",
    presentation: {
      title: "Q3 Deck",
      deck: buildDeck(),
      visuals: {},
      diagnostics: [],
      attribution: { ownerName: "Ava", showAttribution: true },
      ...overrides,
    },
    decision: {
      allow: true,
      resource: { kind: "share" },
      capability: "present",
    },
  };
}

function deniedResult(reason: string): Record<string, unknown> {
  return {
    ok: false,
    mode: "present",
    projection: "presentation",
    shareId: "resolved-share-1",
    decision: {
      allow: false,
      resource: { kind: "share" },
      capability: "present",
      reason,
      status: reason === "passcode-required" ? 401 : 404,
      safeMessage: "Shared document not found.",
      concealResource: true,
    },
  };
}

function renderPresentPage(
  params: { shareId: string },
  searchParams?: { passcode?: string },
): Promise<ReactElement> {
  return PresentPage({
    params: Promise.resolve(params),
    searchParams: searchParams ? Promise.resolve(searchParams) : undefined,
  }) as Promise<ReactElement>;
}

describe("PresentPage generateMetadata", () => {
  it("resolves with mode present and projection metadata, then builds present-surface metadata for a resolved document", async () => {
    state().resolverResult = {
      ok: true,
      mode: "present",
      projection: "metadata",
      shareId: "resolved-share-1",
      metadata: {
        title: "Q3 Deck",
        contentJson: null,
        slug: "q3-deck",
        shareId: "resolved-share-1",
        metadataMode: "title-excerpt",
        discoverable: true,
      },
      decision: {
        allow: true,
        resource: { kind: "share" },
        capability: "present",
      },
    };

    const metadata = await generateMetadata({
      params: Promise.resolve({ shareId: "share-1" }),
    });

    assert.equal(state().resolverCalls.length, 1);
    const [input] = state().resolverCalls[0] as [
      { params: { shareId: string }; mode: string; projection: string },
    ];
    assert.deepEqual(input.params, { shareId: "share-1" });
    assert.equal(input.mode, "present");
    assert.equal(input.projection, "metadata");

    assert.equal(metadata.title, "Q3 Deck — Presentation — TextIQ");
    assert.deepEqual(metadata.robots, { index: true, follow: true });
    assert.equal(
      metadata.other?.["og:see_also"],
      "http://localhost:4000/share/q3-deck-resolved-share-1",
    );
  });

  it("falls back to the anonymous presentation title and noindex robots when denied or projection mismatched", async () => {
    state().resolverResult = deniedResult("share-revoked");

    const metadata = await generateMetadata({
      params: Promise.resolve({ shareId: "share-1" }),
    });

    assert.equal(metadata.title, "Presentation — TextIQ");
    assert.deepEqual(metadata.robots, { index: false, follow: false });
  });
});

describe("PresentPage (default export)", () => {
  it("calls notFound() without ever calling resolvePublicRender when the abuse budget is exceeded", async () => {
    state().budgetExceeded = true;

    await assert.rejects(
      () => renderPresentPage({ shareId: "share-1" }),
      /NEXT_NOT_FOUND/,
    );

    assert.equal(state().resolverCalls.length, 0);
    assert.equal(state().notFoundCalls.length, 1);
  });

  it("passes the awaited shareId, present mode, and presentation projection through to resolvePublicRender", async () => {
    state().resolverResult = presentationResult();

    await renderPresentPage({ shareId: "share-xyz" });

    assert.equal(state().resolverCalls.length, 1);
    const [input] = state().resolverCalls[0] as [
      {
        params: { shareId: string };
        mode: string;
        projection: string;
        passcodeUnlocked: unknown;
      },
    ];
    assert.deepEqual(input.params, { shareId: "share-xyz" });
    assert.equal(input.mode, "present");
    assert.equal(input.projection, "presentation");
    assert.equal(typeof input.passcodeUnlocked, "function");
  });

  it("renders the SharePasscodeGate in present mode using the resolved shareId and the raw-param returnTo when passcode-required", async () => {
    state().resolverResult = deniedResult("passcode-required");

    const html = renderToStaticMarkup(
      await renderPresentPage({ shareId: "raw-share-1" }),
    );

    assert.match(html, /Passcode required/);
    assert.match(html, /name="mode" value="present"/);
    assert.match(html, /name="returnTo" value="\/present\/raw-share-1"/);
    assert.match(html, /name="shareId" value="resolved-share-1"/);
  });

  it("surfaces the invalid/limited passcode alerts from the query string", async () => {
    state().resolverResult = deniedResult("passcode-required");

    const invalidHtml = renderToStaticMarkup(
      await renderPresentPage({ shareId: "share-1" }, { passcode: "invalid" }),
    );
    const limitedHtml = renderToStaticMarkup(
      await renderPresentPage({ shareId: "share-1" }, { passcode: "limited" }),
    );
    const noQueryHtml = renderToStaticMarkup(
      await renderPresentPage({ shareId: "share-1" }),
    );

    assert.match(invalidHtml, /Incorrect passcode/);
    assert.match(limitedHtml, /Too many attempts/);
    assert.doesNotMatch(noQueryHtml, /role="alert"/);
  });

  it("calls notFound() for a non-passcode deny reason", async () => {
    state().resolverResult = deniedResult("share-revoked");

    await assert.rejects(
      () => renderPresentPage({ shareId: "share-1" }),
      /NEXT_NOT_FOUND/,
    );
    assert.equal(state().notFoundCalls.length, 1);
  });

  it("calls notFound() when ok is true but the projection is not presentation (defensive mismatch)", async () => {
    state().resolverResult = {
      ok: true,
      mode: "present",
      projection: "document",
      shareId: "share-1",
      decision: {
        allow: true,
        resource: { kind: "share" },
        capability: "present",
      },
    };

    await assert.rejects(
      () => renderPresentPage({ shareId: "share-1" }),
      /NEXT_NOT_FOUND/,
    );
  });

  it("renders the full-chrome deck (top HUD visible, unlike the embed page) with real slide content and the attribution badge", async () => {
    state().resolverResult = presentationResult();

    const html = renderToStaticMarkup(
      await renderPresentPage({ shareId: "share-1" }),
    );

    assert.match(html, /aria-label="Presentation: Q3 Deck"/);
    assert.match(html, /My Presentation Title/);
    assert.match(html, /aria-label="Presentation controls"/);
    assert.match(html, /Made with TextIQ/);
  });

  it("omits the attribution badge when showAttribution is false", async () => {
    state().resolverResult = presentationResult({
      attribution: { ownerName: "Ava", showAttribution: false },
    });

    const html = renderToStaticMarkup(
      await renderPresentPage({ shareId: "share-1" }),
    );

    assert.doesNotMatch(html, /Made with TextIQ/);
  });
});
