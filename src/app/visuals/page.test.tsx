/**
 * Direct render coverage for the visual gallery page (`page.tsx`) (#1948).
 *
 * `VisualGalleryPage` is a synchronous Server Component with no data
 * loading, so it renders directly with `react-dom/server`'s
 * `renderToStaticMarkup` — safe here because `VisualRenderer` has no
 * `"use client"` directive/hooks-with-effects and no server-only imports.
 *
 * This file exercises the page against the real `FIXTURE_LIST`. The
 * `visual.title ?? KIND_LABEL[visual.type]` fallback branch (every real
 * fixture carries a `title`, so it's otherwise unreachable) is covered
 * separately in `page-kind-label-fallback.test.tsx`, which stubs
 * `@/lib/visual/fixtures` via `node:module` `registerHooks` — kept in its
 * own file/process so the stub never shadows the real fixtures used here.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

describe("VisualGalleryPage", () => {
  let VisualGalleryPage: typeof import("./page").default;
  let metadata: typeof import("./page").metadata;
  let FIXTURE_LIST: typeof import("@/lib/visual/fixtures").FIXTURE_LIST;

  before(async () => {
    const [pageMod, fixturesMod] = await Promise.all([
      import("./page"),
      import("@/lib/visual/fixtures"),
    ]);
    VisualGalleryPage = pageMod.default;
    metadata = pageMod.metadata;
    FIXTURE_LIST = fixturesMod.FIXTURE_LIST;
  });

  it("exposes the visual-gallery page title/description", () => {
    assert.equal(metadata.title, "Visual gallery — TextIQ");
    assert.match(
      String(metadata.description),
      /Sample renderings of every visual type the engine supports/,
    );
  });

  it("renders one accessible <section> per fixture, in FIXTURE_LIST order", () => {
    const html = renderToStaticMarkup(VisualGalleryPage());

    assert.equal(FIXTURE_LIST.length, 13, "expected all 13 visual kinds");
    let lastIndex = -1;
    for (const visual of FIXTURE_LIST) {
      assert.match(
        html,
        new RegExp(`data-visual-type="${visual.type}"`),
        `expected a card for ${visual.type}`,
      );
      const index = html.indexOf(`data-visual-type="${visual.type}"`);
      assert.ok(
        index > lastIndex,
        `expected ${visual.type} to appear after the previous fixture`,
      );
      lastIndex = index;
    }
  });

  it("labels every card's aria-label/heading with the fixture's own title", () => {
    const html = renderToStaticMarkup(VisualGalleryPage());
    for (const visual of FIXTURE_LIST) {
      assert.ok(
        visual.title,
        `expected fixture ${visual.type} to carry a title`,
      );
      const cardStart = html.indexOf(`data-visual-type="${visual.type}"`);
      const cardEnd = html.indexOf("</section>", cardStart);
      const card = html.slice(cardStart, cardEnd);
      // React escapes apostrophes/quotes when serializing text nodes, so
      // compare against the same HTML-escaped form rather than a regex
      // built from the raw (possibly apostrophe-containing) title.
      const escapedTitle = String(visual.title).replace(/'/g, "&#x27;");
      assert.ok(
        card.includes(`>${escapedTitle}<`),
        `expected the heading for ${visual.type} to read "${visual.title}"`,
      );
    }
  });
});
