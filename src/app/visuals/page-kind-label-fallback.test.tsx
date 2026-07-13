/**
 * Direct coverage for the visual gallery page's title fallback branch
 * (`visual.title ?? KIND_LABEL[visual.type]` in `page.tsx`) (#1948).
 *
 * Kept in its own file (`node --test` isolates each test file in its own
 * process) so stubbing `@/lib/visual/fixtures` here can never shadow the
 * real fixture list `page.test.tsx` asserts against. Module-hook strategy
 * matches `src/app/app/trash/actions.test.ts`: every real fixture in
 * `FIXTURE_LIST` carries a `title`, so this substitutes a single fixture
 * without one to exercise the `KIND_LABEL` fallback deterministically.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, it } from "node:test";
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

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-visuals-fallback-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/lib/visual/fixtures",
    `
      export const FIXTURE_LIST = [
        {
          version: 1,
          type: "flowchart",
          // Deliberately no \`title\` — exercises the KIND_LABEL fallback.
          width: 10,
          height: 10,
          style: {},
          nodes: [],
          edges: [],
        },
      ];
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

describe("VisualGalleryPage KIND_LABEL fallback", () => {
  let VisualGalleryPage: typeof import("./page").default;

  before(async () => {
    const pageMod = await import("./page");
    VisualGalleryPage = pageMod.default;
  });

  it("falls back to the KIND_LABEL when a fixture has no title", () => {
    const html = renderToStaticMarkup(VisualGalleryPage());
    assert.match(html, /data-visual-type="flowchart"/);
    // No fixture title is supplied, so both the heading and the aria-label
    // must fall back to KIND_LABEL.flowchart ("Flowchart").
    assert.match(html, />Flowchart</);
    assert.match(html, /aria-label="Flowchart"/);
  });
});
