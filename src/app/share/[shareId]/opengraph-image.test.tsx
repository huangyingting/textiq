/**
 * Direct contracts for the shared-document Open Graph image route (#1945).
 *
 * Covers two layers:
 *   1. `resolveOgTextContent` — the pure title/description derivation seam
 *      extracted from the default `Image()` export: metadata-mode gating
 *      (generic/title/title-excerpt), the empty-title fallback, description
 *      derivation from `contentJson`, and long-title truncation.
 *   2. The default `Image()` export's *wiring*: that an abuse-budget
 *      exhaustion short-circuits before ever calling `resolvePublicRender`,
 *      that a denied/not-found/non-metadata result renders the same safe
 *      generic fallback card as a budget rejection (so private documents
 *      never leak from a fingerprintable difference), that the resolved
 *      `shareId` and `passcodeUnlocked` callback are wired through to
 *      `resolvePublicRender`'s params, and that the rendered `ImageResponse`
 *      element/options carry the resolved title/description text and the
 *      exported `size`/`alt`/`contentType`/`runtime` contract.
 *
 * `opengraph-image.tsx` imports `next/og` (`ImageResponse`, which performs
 * real satori/resvg rendering — too slow/opaque to assert on rendered text),
 * `@/app/public-abuse`, `@/lib/public-render/resolver`, and
 * `@/lib/share-passcode-server` (each independently covered by their own
 * test files and each importing `next/headers`/`server-only`, which throw
 * outside a live request). Following the module-hooks pattern already used
 * by `src/lib/document-editor/loader.test.ts` and
 * `src/app/app/settings/page.test.tsx` (for the element-tree-capture idea),
 * this stubs all four specifiers: `next/og`'s `ImageResponse` captures the
 * JSX element + options synchronously onto `globalThis` instead of
 * rendering, and the other three are driven by mutable `globalThis` test
 * state so each test controls budget/resolver/passcode behavior directly.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

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

interface CapturedOgRender {
  element: ReactElement;
  options: Record<string, unknown>;
}

declare global {
  var __ogTestBudgetExceeded: boolean;
  var __ogTestResolverResult: unknown;
  var __ogTestResolverCalls: unknown[][];
  var __ogTestCaptured: CapturedOgRender | undefined;
}

globalThis.__ogTestBudgetExceeded = false;
globalThis.__ogTestResolverResult = null;
globalThis.__ogTestResolverCalls = [];
globalThis.__ogTestCaptured = undefined;

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const NEXT_OG_STUB = "next-og:opengraph-image-test";
const PUBLIC_ABUSE_STUB = "app-public-abuse:opengraph-image-test";
const RESOLVER_STUB = "lib-public-render-resolver:opengraph-image-test";
const SHARE_PASSCODE_SERVER_STUB =
  "lib-share-passcode-server:opengraph-image-test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/og") {
      return { url: NEXT_OG_STUB, shortCircuit: true };
    }
    if (specifier === "@/app/public-abuse") {
      return { url: PUBLIC_ABUSE_STUB, shortCircuit: true };
    }
    if (specifier === "@/lib/public-render/resolver") {
      return { url: RESOLVER_STUB, shortCircuit: true };
    }
    if (specifier === "@/lib/share-passcode-server") {
      return { url: SHARE_PASSCODE_SERVER_STUB, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === NEXT_OG_STUB) {
      return {
        format: "commonjs" as const,
        source: `class ImageResponse {
  constructor(element, options) {
    globalThis.__ogTestCaptured = { element, options };
  }
}
module.exports = { ImageResponse };`,
        shortCircuit: true,
      };
    }
    if (url === PUBLIC_ABUSE_STUB) {
      return {
        format: "commonjs" as const,
        source: `module.exports = {
  publicShareBudgetExceeded: async () => globalThis.__ogTestBudgetExceeded,
};`,
        shortCircuit: true,
      };
    }
    if (url === RESOLVER_STUB) {
      return {
        format: "commonjs" as const,
        source: `module.exports = {
  resolvePublicRender: async (input) => {
    globalThis.__ogTestResolverCalls.push([input]);
    return globalThis.__ogTestResolverResult;
  },
};`,
        shortCircuit: true,
      };
    }
    if (url === SHARE_PASSCODE_SERVER_STUB) {
      return {
        format: "commonjs" as const,
        source: `module.exports = {
  isPublicSharePasscodeUnlocked: async () => false,
};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

type OgModule = typeof import("./opengraph-image");
let ogModule: OgModule;

before(async () => {
  ogModule = await import("./opengraph-image");
});

beforeEach(() => {
  globalThis.__ogTestBudgetExceeded = false;
  globalThis.__ogTestResolverResult = null;
  globalThis.__ogTestResolverCalls = [];
  globalThis.__ogTestCaptured = undefined;
});

function metadataResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    projection: "metadata",
    metadata: {
      title: "Q3 Roadmap",
      contentJson: {
        root: {
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "Ship the new dashboard." }],
            },
          ],
        },
      },
      slug: "q3-roadmap",
      shareId: "share123",
      metadataMode: "generic",
      discoverable: false,
      ...overrides,
    },
  };
}

describe("resolveOgTextContent", () => {
  it("falls back to the generic title and empty description for a null document", () => {
    const content = ogModule.resolveOgTextContent(null);
    assert.equal(content.displayTitle, "Shared document");
    assert.equal(content.description, "");
  });

  it("uses the generic fallback title even when a title/contentJson are present under generic mode", () => {
    const content = ogModule.resolveOgTextContent({
      title: "Secret Plan",
      contentJson: {},
      metadataMode: "generic",
    });
    assert.equal(content.displayTitle, "Shared document");
    assert.equal(content.description, "");
  });

  it("renders the real title (but no description) under title mode", () => {
    const content = ogModule.resolveOgTextContent({
      title: "Q3 Roadmap",
      contentJson: {},
      metadataMode: "title",
    });
    assert.equal(content.displayTitle, "Q3 Roadmap");
    assert.equal(content.description, "");
  });

  it("renders both the title and a derived excerpt under title-excerpt mode", () => {
    const content = ogModule.resolveOgTextContent({
      title: "Q3 Roadmap",
      contentJson: {
        root: {
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "Ship the new dashboard." }],
            },
          ],
        },
      },
      metadataMode: "title-excerpt",
    });
    assert.equal(content.displayTitle, "Q3 Roadmap");
    assert.equal(content.description, "Ship the new dashboard.");
  });

  it("falls back to the generic title when the document's title is empty/whitespace under title mode", () => {
    const content = ogModule.resolveOgTextContent({
      title: "   ",
      contentJson: {},
      metadataMode: "title",
    });
    assert.equal(content.displayTitle, "Shared document");
  });

  it("truncates a long title to 90 characters plus an ellipsis", () => {
    const longTitle = "A".repeat(120);
    const content = ogModule.resolveOgTextContent({
      title: longTitle,
      contentJson: {},
      metadataMode: "title",
    });
    assert.equal(content.displayTitle.length, 91);
    assert.ok(content.displayTitle.endsWith("…"));
    assert.equal(content.displayTitle.slice(0, 90), "A".repeat(90));
  });

  it("leaves a title at or under the 90-character limit untouched", () => {
    const exactTitle = "B".repeat(90);
    const content = ogModule.resolveOgTextContent({
      title: exactTitle,
      contentJson: {},
      metadataMode: "title",
    });
    assert.equal(content.displayTitle, exactTitle);
  });
});

describe("Image (default export)", () => {
  it("exposes the static Next.js opengraph-image metadata contract", () => {
    assert.deepEqual(ogModule.size, { width: 1200, height: 630 });
    assert.equal(ogModule.alt, "Shared document preview");
    assert.equal(ogModule.contentType, "image/png");
    assert.equal(ogModule.runtime, "nodejs");
  });

  it("short-circuits to the generic fallback card without calling resolvePublicRender when the abuse budget is exceeded", async () => {
    globalThis.__ogTestBudgetExceeded = true;

    await ogModule.default({
      params: Promise.resolve({ shareId: "share123" }),
    });

    assert.equal(globalThis.__ogTestResolverCalls.length, 0);
    assert.ok(globalThis.__ogTestCaptured);
    const html = renderToStaticMarkup(globalThis.__ogTestCaptured!.element);
    assert.ok(html.includes("Shared document"));
  });

  it("passes the awaited shareId, og mode, metadata projection, and passcode callback through to resolvePublicRender", async () => {
    globalThis.__ogTestResolverResult = metadataResult();

    await ogModule.default({
      params: Promise.resolve({ shareId: "share-xyz" }),
    });

    assert.equal(globalThis.__ogTestResolverCalls.length, 1);
    const [input] = globalThis.__ogTestResolverCalls[0] as [
      {
        params: { shareId: string };
        mode: string;
        projection: string;
        passcodeUnlocked: unknown;
      },
    ];
    assert.deepEqual(input.params, { shareId: "share-xyz" });
    assert.equal(input.mode, "og");
    assert.equal(input.projection, "metadata");
    assert.equal(typeof input.passcodeUnlocked, "function");
  });

  it("renders the generic fallback card when resolvePublicRender denies access", async () => {
    globalThis.__ogTestResolverResult = {
      ok: false,
      projection: "metadata",
    };

    await ogModule.default({
      params: Promise.resolve({ shareId: "share123" }),
    });

    const html = renderToStaticMarkup(globalThis.__ogTestCaptured!.element);
    assert.ok(html.includes("Shared document"));
  });

  it("renders the generic fallback card when the result projection is not metadata (defensive mismatch)", async () => {
    globalThis.__ogTestResolverResult = {
      ok: true,
      projection: "document",
      document: { title: "Should not leak", contentJson: {} },
    };

    await ogModule.default({
      params: Promise.resolve({ shareId: "share123" }),
    });

    const html = renderToStaticMarkup(globalThis.__ogTestCaptured!.element);
    assert.ok(html.includes("Shared document"));
    assert.ok(!html.includes("Should not leak"));
  });

  it("renders the resolved title and excerpt for a successful title-excerpt metadata result", async () => {
    globalThis.__ogTestResolverResult = metadataResult({
      metadataMode: "title-excerpt",
    });

    await ogModule.default({
      params: Promise.resolve({ shareId: "share123" }),
    });

    const html = renderToStaticMarkup(globalThis.__ogTestCaptured!.element);
    assert.ok(html.includes("Q3 Roadmap"));
    assert.ok(html.includes("Ship the new dashboard."));
  });

  it("renders the TextIQ brand initial on the public OG card", async () => {
    globalThis.__ogTestResolverResult = metadataResult({
      metadataMode: "title",
    });

    await ogModule.default({
      params: Promise.resolve({ shareId: "share123" }),
    });

    const html = renderToStaticMarkup(globalThis.__ogTestCaptured!.element);
    assert.ok(html.includes(">T</div>"));
    assert.ok(!html.includes(">N</div>"));
  });

  it("renders the ImageResponse with the exported size options", async () => {
    globalThis.__ogTestResolverResult = metadataResult({
      metadataMode: "title",
    });

    await ogModule.default({
      params: Promise.resolve({ shareId: "share123" }),
    });

    assert.deepEqual(globalThis.__ogTestCaptured!.options, {
      width: 1200,
      height: 630,
    });
  });
});
