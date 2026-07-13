/**
 * Direct render coverage for the public `/present/[shareId]/embed` chrome-
 * free presentation viewer page (`page.tsx`) (#1960).
 *
 * Mirrors the `/embed/[shareId]` document page's module-hooks strategy:
 * `next/navigation`'s `notFound`, `@/app/public-abuse`'s abuse-budget check,
 * `@/lib/public-render/resolver`'s Prisma-backed `resolvePublicRender`, and
 * `@/lib/share-passcode-server`'s cookie-reading passcode check are stubbed
 * (each throws or hits a real database/request outside a live Next.js
 * request). `@/lib/public-render/present-embed-route` (a pure input-builder,
 * covered by its own `present-embed-route.test.ts`),
 * `@/lib/public-render/presentation`'s `publicPresentationRecoveryForViewer`
 * (pure, covered by `presentation.test.ts`), and
 * `@/components/presentation/public-present-viewer` (covered by its own
 * render-state tests) are imported for real so the page's actual composed
 * markup — a real multi-slide deck rendered chrome-free — can be asserted,
 * not just a mocked child element.
 *
 * Coverage here: the embed-specific page title; the abuse-budget short-
 * circuit; `buildPresentEmbedRenderInput`'s embed-mode/presentation-
 * projection wiring into `resolvePublicRender` alongside the passcode
 * callback; the passcode-required gate (embed mode/returnTo, resolved
 * shareId, and the invalid/limited query variants); notFound() for any
 * other deny reason and for a defensive ok/projection mismatch; and the
 * successful chrome-free render (no top HUD, real slide content, deck
 * `embed` prop wired through, and the attribution badge's presence).
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

type PresentEmbedPageTestState = {
  budgetExceeded: boolean;
  resolverCalls: unknown[][];
  resolverResult: Record<string, unknown> | null;
  notFoundCalls: unknown[][];
};

const globalForPage = globalThis as typeof globalThis & {
  __presentEmbedPageTestState: PresentEmbedPageTestState;
};

function createDefaultState(): PresentEmbedPageTestState {
  return {
    budgetExceeded: false,
    resolverCalls: [],
    resolverResult: null,
    notFoundCalls: [],
  };
}

globalForPage.__presentEmbedPageTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-present-embed-page-test:";
const stubbedModules = new Map<string, string>([
  [
    "next/navigation",
    `
      export function notFound() {
        globalThis.__presentEmbedPageTestState.notFoundCalls.push([]);
        throw new Error("NEXT_NOT_FOUND");
      }
    `,
  ],
  [
    "@/app/public-abuse",
    `
      export async function publicShareBudgetExceeded() {
        return globalThis.__presentEmbedPageTestState.budgetExceeded;
      }
    `,
  ],
  [
    "@/lib/public-render/resolver",
    `
      export async function resolvePublicRender(input) {
        globalThis.__presentEmbedPageTestState.resolverCalls.push([input]);
        return globalThis.__presentEmbedPageTestState.resolverResult;
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
let PresentEmbedPage: PageModule["default"];
let metadata: PageModule["metadata"];

before(async () => {
  const mod = await import("./page");
  PresentEmbedPage = mod.default;
  metadata = mod.metadata;
});

beforeEach(() => {
  globalForPage.__presentEmbedPageTestState = createDefaultState();
});

function state(): PresentEmbedPageTestState {
  return globalForPage.__presentEmbedPageTestState;
}

function presentationResult(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ok: true,
    mode: "embed",
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
      capability: "embed",
    },
  };
}

function deniedResult(reason: string): Record<string, unknown> {
  return {
    ok: false,
    mode: "embed",
    projection: "presentation",
    shareId: "resolved-share-1",
    decision: {
      allow: false,
      resource: { kind: "share" },
      capability: "embed",
      reason,
      status: reason === "passcode-required" ? 401 : 404,
      safeMessage: "Shared document not found.",
      concealResource: true,
    },
  };
}

function renderPresentEmbedPage(
  params: { shareId: string },
  searchParams?: { passcode?: string },
): Promise<ReactElement> {
  return PresentEmbedPage({
    params: Promise.resolve(params),
    searchParams: searchParams ? Promise.resolve(searchParams) : undefined,
  }) as Promise<ReactElement>;
}

describe("PresentEmbedPage", () => {
  it("exposes the presentation-specific page title", () => {
    assert.equal(metadata.title, "Presentation — TextIQ");
  });

  it("calls notFound() without ever calling resolvePublicRender when the abuse budget is exceeded", async () => {
    state().budgetExceeded = true;

    await assert.rejects(
      () => renderPresentEmbedPage({ shareId: "share-1" }),
      /NEXT_NOT_FOUND/,
    );

    assert.equal(state().resolverCalls.length, 0);
    assert.equal(state().notFoundCalls.length, 1);
  });

  it("passes buildPresentEmbedRenderInput's embed mode/presentation projection plus the passcode callback through to resolvePublicRender", async () => {
    state().resolverResult = presentationResult();

    await renderPresentEmbedPage({ shareId: "share-xyz" });

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
    assert.equal(input.mode, "embed");
    assert.equal(input.projection, "presentation");
    assert.equal(typeof input.passcodeUnlocked, "function");
  });

  it("renders the SharePasscodeGate in embed mode using the resolved shareId and the raw-param returnTo when passcode-required", async () => {
    state().resolverResult = deniedResult("passcode-required");

    const tree = await renderPresentEmbedPage({ shareId: "raw-share-1" });
    const html = renderToStaticMarkup(tree);

    assert.match(html, /Passcode required/);
    assert.match(html, /name="mode" value="embed"/);
    assert.match(html, /name="returnTo" value="\/present\/raw-share-1\/embed"/);
    assert.match(html, /name="shareId" value="resolved-share-1"/);
  });

  it("surfaces the invalid/limited passcode alerts from the query string", async () => {
    state().resolverResult = deniedResult("passcode-required");

    const invalidHtml = renderToStaticMarkup(
      await renderPresentEmbedPage(
        { shareId: "share-1" },
        { passcode: "invalid" },
      ),
    );
    const limitedHtml = renderToStaticMarkup(
      await renderPresentEmbedPage(
        { shareId: "share-1" },
        { passcode: "limited" },
      ),
    );
    const noQueryHtml = renderToStaticMarkup(
      await renderPresentEmbedPage({ shareId: "share-1" }),
    );

    assert.match(invalidHtml, /Incorrect passcode/);
    assert.match(limitedHtml, /Too many attempts/);
    assert.doesNotMatch(noQueryHtml, /role="alert"/);
  });

  it("calls notFound() for a non-passcode deny reason", async () => {
    state().resolverResult = deniedResult("share-revoked");

    await assert.rejects(
      () => renderPresentEmbedPage({ shareId: "share-1" }),
      /NEXT_NOT_FOUND/,
    );
    assert.equal(state().notFoundCalls.length, 1);
  });

  it("calls notFound() when ok is true but the projection is not presentation (defensive mismatch)", async () => {
    state().resolverResult = {
      ok: true,
      mode: "embed",
      projection: "document",
      shareId: "share-1",
      decision: {
        allow: true,
        resource: { kind: "share" },
        capability: "embed",
      },
    };

    await assert.rejects(
      () => renderPresentEmbedPage({ shareId: "share-1" }),
      /NEXT_NOT_FOUND/,
    );
  });

  it("renders the deck chrome-free (embed) with real slide content and the attribution badge", async () => {
    state().resolverResult = presentationResult();

    const html = renderToStaticMarkup(
      await renderPresentEmbedPage({ shareId: "share-1" }),
    );

    assert.match(html, /aria-label="Presentation: Q3 Deck"/);
    assert.match(html, /My Presentation Title/);
    assert.doesNotMatch(html, /aria-label="Presentation controls"/);
    assert.match(html, /Made with TextIQ/);
  });

  it("passes the viewer-filtered recovery through (a derived fallback is hidden, a real recovery is shown)", async () => {
    state().resolverResult = presentationResult({
      recovery: {
        error: "Deck JSON failed validation",
        validationErrors: ["slides must not be empty"],
        diagnostics: [],
        fallback: "derived",
      },
    });
    const derivedHtml = renderToStaticMarkup(
      await renderPresentEmbedPage({ shareId: "share-1" }),
    );
    assert.doesNotMatch(derivedHtml, /Presentation deck could not be opened/);
    assert.match(derivedHtml, /My Presentation Title/);

    state().resolverResult = presentationResult({
      recovery: {
        error: "Deck JSON failed validation",
        validationErrors: ["slides must not be empty"],
        diagnostics: [],
        fallback: "none",
      },
    });
    const failedHtml = renderToStaticMarkup(
      await renderPresentEmbedPage({ shareId: "share-1" }),
    );
    assert.match(failedHtml, /Presentation deck could not be opened/);
    assert.match(failedHtml, /Deck JSON failed validation/);
  });
});
