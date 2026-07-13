/**
 * Direct contract coverage for the Brand Studio page composition (issue
 * #1956).
 *
 * `renderBrandsPageView` is the pure view-model -> markup decision extracted
 * from the async `BrandsPage` default export so the entitlement-gated
 * `BrandStudio`/`BrandStudioTeaser` branch and the header/back-link wiring
 * are unit-testable without exercising `requireUser`/
 * `loadBrandStudioViewModel`, which require a live session and database.
 *
 * `page.tsx` imports `@/lib/brand-studio/loader`, which carries `import
 * "server-only"` and throws outside a Next.js Server Component build.
 * Following the module-hooks pattern already used by
 * `src/app/app/settings/page.test.tsx`, this stubs the `server-only`
 * specifier to an empty module before dynamically importing `./page`.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { BrandStyle } from "@/lib/brand/schema";
import type { BrandStudioViewModel } from "@/lib/brand-studio/view-model";

import { BrandStudio } from "./brand-studio";
import { BrandStudioTeaser } from "./brand-studio-teaser";

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

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;
const serverOnlyStubUrl = "server-only:brands-page-test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: serverOnlyStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === serverOnlyStubUrl) {
      return { format: "commonjs", source: "", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

type PageModule = typeof import("./page");
let renderBrandsPageView: PageModule["renderBrandsPageView"];

before(async () => {
  const mod = await import("./page");
  renderBrandsPageView = mod.renderBrandsPageView;
});

type ElementLike = ReactElement<Record<string, unknown>>;

/**
 * Collects every element in the tree, expanding host (string-type) elements'
 * children so headings/links are visible to assertions. Function components
 * are recorded as leaves — NOT invoked — because `BrandStudio` calls
 * `useState`/`useCallback`, which would throw "Invalid hook call" if called
 * directly outside of a real React render pass.
 */
function collectElements(node: ReactNode, collected: ElementLike[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  collected.push(element);
  if (typeof element.type === "function") {
    return collected;
  }
  const props = element.props as { children?: ReactNode };
  collectElements(props.children, collected);
  return collected;
}

function firstElement(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
): ElementLike {
  const element = collectElements(node).find(predicate);
  assert.ok(element, "expected a matching element");
  return element;
}

function buildBrand(overrides: Partial<BrandStyle> = {}): BrandStyle {
  return {
    id: "brand-1",
    name: "Acme",
    ownerId: "user-1",
    palette: ["#111111"],
    background: "#ffffff",
    nodeFill: "#eef2ff",
    nodeStroke: "#4f46e5",
    nodeText: "#312e81",
    edgeColor: "#a5b4fc",
    fontFamily: null,
    fontAssetId: null,
    logoAssetId: null,
    fontAssetUrl: null,
    logoAssetUrl: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildViewModel(
  overrides: Partial<BrandStudioViewModel> = {},
): BrandStudioViewModel {
  return {
    brands: [buildBrand()],
    canUseBrandStyles: true,
    canUploadFont: false,
    ...overrides,
  };
}

describe("renderBrandsPageView", () => {
  test("entitled: renders BrandStudio wired with the view model's brands and font-upload flag", () => {
    const brands = [buildBrand({ id: "b1" }), buildBrand({ id: "b2" })];
    const tree = renderBrandsPageView(
      buildViewModel({ brands, canUseBrandStyles: true, canUploadFont: true }),
    );
    const studio = firstElement(
      tree,
      (element) => element.type === BrandStudio,
    );
    assert.equal(studio.props.initialBrands, brands);
    assert.equal(studio.props.canFontUpload, true);
    const teasers = collectElements(tree).filter(
      (element) => element.type === BrandStudioTeaser,
    );
    assert.equal(teasers.length, 0);
  });

  test("not entitled: renders the read-only BrandStudioTeaser instead of BrandStudio", () => {
    const tree = renderBrandsPageView(
      buildViewModel({ canUseBrandStyles: false }),
    );
    firstElement(tree, (element) => element.type === BrandStudioTeaser);
    const studios = collectElements(tree).filter(
      (element) => element.type === BrandStudio,
    );
    assert.equal(studios.length, 0);
  });

  test("renders the heading, description, and back-to-documents link", () => {
    const tree = renderBrandsPageView(buildViewModel());
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Brand Studio/);
    assert.match(
      html,
      /Create and manage saved brand styles — colors, fonts, and logos\./,
    );
    assert.match(html, /href="\/app"/);
    assert.match(html, /Back to documents/);
  });

  test("empty brands list still renders BrandStudio (empty-state handling lives in BrandStudio itself)", () => {
    const tree = renderBrandsPageView(
      buildViewModel({ brands: [], canUseBrandStyles: true }),
    );
    const studio = firstElement(
      tree,
      (element) => element.type === BrandStudio,
    );
    assert.deepEqual(studio.props.initialBrands, []);
  });
});
