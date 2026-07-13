/**
 * Direct render coverage for the public `/embed/[shareId]` document page
 * (`page.tsx`) (#1960).
 *
 * `page.tsx` calls three server-only boundaries before it can render:
 * `@/app/public-abuse`'s abuse-budget check, `@/lib/public-render/resolver`'s
 * Prisma-backed `resolvePublicRender`, and `@/lib/share-passcode-server`'s
 * cookie-reading passcode check (which itself imports `next/headers`). All
 * three throw or hit a real database outside a live Next.js request, so —
 * following the module-hooks pattern already used by
 * `src/app/share/[shareId]/opengraph-image.test.tsx` and
 * `src/app/forgot-password/page.test.tsx` — this stubs all three specifiers
 * plus `next/navigation`'s `notFound` (observable instead of throwing Next's
 * internal `NEXT_HTTP_ERROR_FALLBACK` control-flow signal). `@/components/
 * lexical/lexical-read-only`, `@/components/made-with-badge`, and
 * `@/components/share/share-passcode-gate` are imported for real (each
 * independently covered by its own test file) so the page's actual rendered
 * markup — not just its composition — can be asserted.
 *
 * Coverage here: the embed-specific page title; the abuse-budget
 * short-circuit (notFound before ever calling the resolver); the resolved
 * shareId/mode/projection/passcode-callback wiring into `resolvePublicRender`;
 * the passcode-required gate (including the invalid/limited/no-error query
 * variants, and the resolved `shareId` vs. raw-param `returnTo` distinction);
 * notFound() for any other deny reason and for a defensive ok/projection
 * mismatch; and the successful read-only render (content + the attribution
 * badge's present/absent states).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, it } from "node:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildEditorState, buildParagraphNode } from "@/test/builders/lexical";

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

type EmbedPageTestState = {
  budgetExceeded: boolean;
  resolverCalls: unknown[][];
  resolverResult: Record<string, unknown> | null;
  notFoundCalls: unknown[][];
};

const globalForPage = globalThis as typeof globalThis & {
  __embedPageTestState: EmbedPageTestState;
};

function createDefaultState(): EmbedPageTestState {
  return {
    budgetExceeded: false,
    resolverCalls: [],
    resolverResult: null,
    notFoundCalls: [],
  };
}

globalForPage.__embedPageTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-embed-page-test:";
const stubbedModules = new Map<string, string>([
  [
    "next/navigation",
    `
      export function notFound() {
        globalThis.__embedPageTestState.notFoundCalls.push([]);
        throw new Error("NEXT_NOT_FOUND");
      }
    `,
  ],
  [
    "@/app/public-abuse",
    `
      export async function publicShareBudgetExceeded() {
        return globalThis.__embedPageTestState.budgetExceeded;
      }
    `,
  ],
  [
    "@/lib/public-render/resolver",
    `
      export async function resolvePublicRender(input) {
        globalThis.__embedPageTestState.resolverCalls.push([input]);
        return globalThis.__embedPageTestState.resolverResult;
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
let EmbedPage: PageModule["default"];
let metadata: PageModule["metadata"];

before(async () => {
  const mod = await import("./page");
  EmbedPage = mod.default;
  metadata = mod.metadata;
});

beforeEach(() => {
  globalForPage.__embedPageTestState = createDefaultState();
});

function state(): EmbedPageTestState {
  return globalForPage.__embedPageTestState;
}

function documentResult(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ok: true,
    mode: "embed",
    projection: "document",
    shareId: "resolved-share-1",
    document: {
      id: "doc-1",
      title: "Q3 Roadmap",
      contentJson: buildEditorState([
        buildParagraphNode("Read-only embed body."),
      ]),
      ownerName: "Ava",
      showAttribution: true,
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
    projection: "document",
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

function renderEmbedPage(
  params: { shareId: string },
  searchParams?: { passcode?: string },
): Promise<ReactElement> {
  return EmbedPage({
    params: Promise.resolve(params),
    searchParams: searchParams ? Promise.resolve(searchParams) : undefined,
  }) as Promise<ReactElement>;
}

describe("EmbedPage", () => {
  it("exposes the embed-specific page title", () => {
    assert.equal(metadata.title, "Embedded Document — TextIQ");
  });

  it("calls notFound() without ever calling resolvePublicRender when the abuse budget is exceeded", async () => {
    state().budgetExceeded = true;

    await assert.rejects(
      () => renderEmbedPage({ shareId: "share-1" }),
      /NEXT_NOT_FOUND/,
    );

    assert.equal(state().resolverCalls.length, 0);
    assert.equal(state().notFoundCalls.length, 1);
  });

  it("passes the awaited shareId, embed mode, document projection, and passcode callback through to resolvePublicRender", async () => {
    state().resolverResult = documentResult();

    await renderEmbedPage({ shareId: "share-xyz" });

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
    assert.equal(input.projection, "document");
    assert.equal(typeof input.passcodeUnlocked, "function");
  });

  it("renders the SharePasscodeGate using the resolved shareId (not the raw param) and the raw-param returnTo when passcode-required", async () => {
    state().resolverResult = deniedResult("passcode-required");

    const tree = await renderEmbedPage({ shareId: "raw-share-1" });
    const html = renderToStaticMarkup(tree);

    assert.match(html, /Passcode required/);
    assert.match(html, /name="mode" value="embed"/);
    assert.match(html, /name="returnTo" value="\/embed\/raw-share-1"/);
    assert.match(html, /name="shareId" value="resolved-share-1"/);
  });

  it("surfaces the invalid-passcode alert only for a passcode=invalid query", async () => {
    state().resolverResult = deniedResult("passcode-required");

    const html = renderToStaticMarkup(
      await renderEmbedPage({ shareId: "share-1" }, { passcode: "invalid" }),
    );

    assert.match(html, /role="alert"/);
    assert.match(html, /Incorrect passcode/);
  });

  it("surfaces the too-many-attempts alert only for a passcode=limited query", async () => {
    state().resolverResult = deniedResult("passcode-required");

    const html = renderToStaticMarkup(
      await renderEmbedPage({ shareId: "share-1" }, { passcode: "limited" }),
    );

    assert.match(html, /role="alert"/);
    assert.match(html, /Too many attempts/);
  });

  it("renders no alert when the passcode query is absent or an unrecognized value", async () => {
    state().resolverResult = deniedResult("passcode-required");

    const withoutQuery = renderToStaticMarkup(
      await renderEmbedPage({ shareId: "share-1" }),
    );
    const withUnknownQuery = renderToStaticMarkup(
      await renderEmbedPage({ shareId: "share-1" }, { passcode: "other" }),
    );

    assert.doesNotMatch(withoutQuery, /role="alert"/);
    assert.doesNotMatch(withUnknownQuery, /role="alert"/);
  });

  it("calls notFound() for a non-passcode deny reason", async () => {
    state().resolverResult = deniedResult("share-revoked");

    await assert.rejects(
      () => renderEmbedPage({ shareId: "share-1" }),
      /NEXT_NOT_FOUND/,
    );
    assert.equal(state().notFoundCalls.length, 1);
  });

  it("calls notFound() when ok is true but the projection is not document (defensive mismatch)", async () => {
    state().resolverResult = {
      ok: true,
      mode: "embed",
      projection: "metadata",
      shareId: "share-1",
      decision: {
        allow: true,
        resource: { kind: "share" },
        capability: "embed",
      },
    };

    await assert.rejects(
      () => renderEmbedPage({ shareId: "share-1" }),
      /NEXT_NOT_FOUND/,
    );
  });

  it("renders the document content read-only and the attribution badge when showAttribution is true", async () => {
    state().resolverResult = documentResult({ showAttribution: true });

    const html = renderToStaticMarkup(
      await renderEmbedPage({ shareId: "share-1" }),
    );

    assert.match(html, /Read-only embed body\./);
    assert.match(html, /Made with TextIQ/);
  });

  it("omits the attribution badge when showAttribution is false", async () => {
    state().resolverResult = documentResult({ showAttribution: false });

    const html = renderToStaticMarkup(
      await renderEmbedPage({ shareId: "share-1" }),
    );

    assert.match(html, /Read-only embed body\./);
    assert.doesNotMatch(html, /Made with TextIQ/);
  });
});
