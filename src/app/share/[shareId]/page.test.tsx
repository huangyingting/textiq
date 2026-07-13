/**
 * Direct render coverage for the public `/share/[shareId]` read-only shared
 * document page (`page.tsx`) (#1960).
 *
 * Uses the same module-hooks strategy as the embed/present pages: stubs
 * `next/navigation`, `@/app/public-abuse`, `@/lib/public-render/resolver`,
 * and `@/lib/share-passcode-server`. `@/lib/public-render/metadata` (pure,
 * covered directly by its own `metadata.test.ts`), `@/components/lexical/
 * lexical-read-only`, `./share-lightbox` (covered directly by its own
 * `share-lightbox.test.tsx`), and `@/components/made-with-badge` are
 * imported for real so the page's actual composed header/document/badge
 * markup can be asserted via `renderToStaticMarkup` (no interactive
 * lightbox state is exercised here — that belongs to share-lightbox's own
 * test).
 *
 * Coverage here: `generateMetadata`'s resolver call-argument wiring
 * (mode="view", projection="metadata") for both a resolved document and a
 * denied/anonymous fallback; the default export's abuse-budget short-
 * circuit; the document-projection resolver call wiring; the passcode-
 * required gate (view mode/returnTo, resolved shareId, invalid/limited query
 * variants); notFound() for other deny reasons and a defensive projection
 * mismatch; and the successful render (read-only badge, owner attribution,
 * title, document content wrapped in the lightbox, and the attribution
 * badge present/absent).
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

type SharePageTestState = {
  budgetExceeded: boolean;
  resolverCalls: unknown[][];
  resolverResult: Record<string, unknown> | null;
  notFoundCalls: unknown[][];
};

const globalForPage = globalThis as typeof globalThis & {
  __sharePageTestState: SharePageTestState;
};

function createDefaultState(): SharePageTestState {
  return {
    budgetExceeded: false,
    resolverCalls: [],
    resolverResult: null,
    notFoundCalls: [],
  };
}

globalForPage.__sharePageTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-share-page-test:";
const stubbedModules = new Map<string, string>([
  [
    "next/navigation",
    `
      export function notFound() {
        globalThis.__sharePageTestState.notFoundCalls.push([]);
        throw new Error("NEXT_NOT_FOUND");
      }
    `,
  ],
  [
    "@/app/public-abuse",
    `
      export async function publicShareBudgetExceeded() {
        return globalThis.__sharePageTestState.budgetExceeded;
      }
    `,
  ],
  [
    "@/lib/public-render/resolver",
    `
      export async function resolvePublicRender(input) {
        globalThis.__sharePageTestState.resolverCalls.push([input]);
        return globalThis.__sharePageTestState.resolverResult;
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
let SharedDocumentPage: PageModule["default"];
let generateMetadata: PageModule["generateMetadata"];

before(async () => {
  const mod = await import("./page");
  SharedDocumentPage = mod.default;
  generateMetadata = mod.generateMetadata;
});

beforeEach(() => {
  globalForPage.__sharePageTestState = createDefaultState();
});

function state(): SharePageTestState {
  return globalForPage.__sharePageTestState;
}

function documentResult(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ok: true,
    mode: "view",
    projection: "document",
    shareId: "resolved-share-1",
    document: {
      id: "doc-1",
      title: "Q3 Report",
      contentJson: buildEditorState([
        buildParagraphNode("Read-only share body."),
      ]),
      ownerName: "Ava",
      showAttribution: true,
      ...overrides,
    },
    decision: {
      allow: true,
      resource: { kind: "share" },
      capability: "view",
    },
  };
}

function deniedResult(reason: string): Record<string, unknown> {
  return {
    ok: false,
    mode: "view",
    projection: "document",
    shareId: "resolved-share-1",
    decision: {
      allow: false,
      resource: { kind: "share" },
      capability: "view",
      reason,
      status: reason === "passcode-required" ? 401 : 404,
      safeMessage: "Shared document not found.",
      concealResource: true,
    },
  };
}

function renderSharePage(
  params: { shareId: string },
  searchParams?: { passcode?: string },
): Promise<ReactElement> {
  return SharedDocumentPage({
    params: Promise.resolve(params),
    searchParams: searchParams ? Promise.resolve(searchParams) : undefined,
  }) as Promise<ReactElement>;
}

describe("SharedDocumentPage generateMetadata", () => {
  it("resolves with mode view and projection metadata, then builds share-surface metadata for a resolved document", async () => {
    state().resolverResult = {
      ok: true,
      mode: "view",
      projection: "metadata",
      shareId: "resolved-share-1",
      metadata: {
        title: "Q3 Report",
        contentJson: null,
        slug: "q3-report",
        shareId: "resolved-share-1",
        metadataMode: "title-excerpt",
        discoverable: true,
      },
      decision: {
        allow: true,
        resource: { kind: "share" },
        capability: "view",
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
    assert.equal(input.mode, "view");
    assert.equal(input.projection, "metadata");

    assert.equal(metadata.title, "Q3 Report — TextIQ");
    assert.deepEqual(metadata.robots, { index: true, follow: true });
    assert.equal(metadata.other, undefined);
  });

  it("falls back to the anonymous shared-document title and noindex robots when denied or projection mismatched", async () => {
    state().resolverResult = deniedResult("share-revoked");

    const metadata = await generateMetadata({
      params: Promise.resolve({ shareId: "share-1" }),
    });

    assert.equal(metadata.title, "Shared Document — TextIQ");
    assert.deepEqual(metadata.robots, { index: false, follow: false });
  });
});

describe("SharedDocumentPage (default export)", () => {
  it("calls notFound() without ever calling resolvePublicRender when the abuse budget is exceeded", async () => {
    state().budgetExceeded = true;

    await assert.rejects(
      () => renderSharePage({ shareId: "share-1" }),
      /NEXT_NOT_FOUND/,
    );

    assert.equal(state().resolverCalls.length, 0);
    assert.equal(state().notFoundCalls.length, 1);
  });

  it("passes the awaited shareId, view mode, and document projection through to resolvePublicRender", async () => {
    state().resolverResult = documentResult();

    await renderSharePage({ shareId: "share-xyz" });

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
    assert.equal(input.mode, "view");
    assert.equal(input.projection, "document");
    assert.equal(typeof input.passcodeUnlocked, "function");
  });

  it("renders the SharePasscodeGate in view mode using the resolved shareId and the raw-param returnTo when passcode-required", async () => {
    state().resolverResult = deniedResult("passcode-required");

    const html = renderToStaticMarkup(
      await renderSharePage({ shareId: "raw-share-1" }),
    );

    assert.match(html, /Passcode required/);
    assert.match(html, /name="mode" value="view"/);
    assert.match(html, /name="returnTo" value="\/share\/raw-share-1"/);
    assert.match(html, /name="shareId" value="resolved-share-1"/);
  });

  it("surfaces the invalid/limited passcode alerts from the query string", async () => {
    state().resolverResult = deniedResult("passcode-required");

    const invalidHtml = renderToStaticMarkup(
      await renderSharePage({ shareId: "share-1" }, { passcode: "invalid" }),
    );
    const limitedHtml = renderToStaticMarkup(
      await renderSharePage({ shareId: "share-1" }, { passcode: "limited" }),
    );
    const noQueryHtml = renderToStaticMarkup(
      await renderSharePage({ shareId: "share-1" }),
    );

    assert.match(invalidHtml, /Incorrect passcode/);
    assert.match(limitedHtml, /Too many attempts/);
    assert.doesNotMatch(noQueryHtml, /role="alert"/);
  });

  it("calls notFound() for a non-passcode deny reason", async () => {
    state().resolverResult = deniedResult("share-revoked");

    await assert.rejects(
      () => renderSharePage({ shareId: "share-1" }),
      /NEXT_NOT_FOUND/,
    );
    assert.equal(state().notFoundCalls.length, 1);
  });

  it("calls notFound() when ok is true but the projection is not document (defensive mismatch)", async () => {
    state().resolverResult = {
      ok: true,
      mode: "view",
      projection: "metadata",
      shareId: "share-1",
      decision: {
        allow: true,
        resource: { kind: "share" },
        capability: "view",
      },
    };

    await assert.rejects(
      () => renderSharePage({ shareId: "share-1" }),
      /NEXT_NOT_FOUND/,
    );
  });

  it("renders the read-only header, owner attribution, title, document content, and attribution badge for a successful resolution", async () => {
    state().resolverResult = documentResult();

    const html = renderToStaticMarkup(
      await renderSharePage({ shareId: "share-1" }),
    );

    assert.match(html, /Read-only/);
    assert.match(html, /Shared by Ava/);
    assert.match(html, /Q3 Report/);
    assert.match(html, /Read-only share body\./);
    assert.match(html, /Made with TextIQ/);
  });

  it("omits the attribution badge when showAttribution is false", async () => {
    state().resolverResult = documentResult({ showAttribution: false });

    const html = renderToStaticMarkup(
      await renderSharePage({ shareId: "share-1" }),
    );

    assert.doesNotMatch(html, /Made with TextIQ/);
  });
});
