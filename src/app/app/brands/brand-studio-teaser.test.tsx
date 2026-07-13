/**
 * Direct contract coverage for `BrandStudioTeaser` (issue #1956) — the
 * read-only Brand Studio preview shown to free users who lack the
 * `brandStyles` entitlement.
 *
 * The component takes no props and renders a fixed `SAMPLE_BRAND` fixture,
 * so `renderToStaticMarkup` is enough to assert the upgrade CTA, the
 * disabled/inert overlay, and the sample swatches/preview without any DOM
 * polyfill or module-hook stubbing.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SAMPLE_BRAND } from "@/lib/brand/sample-visual";
import { brandPreviewStyle } from "@/lib/brand/transforms";

import { BrandStudioTeaser } from "./brand-studio-teaser";

describe("BrandStudioTeaser", () => {
  test("renders the upgrade CTA linking to the billing page", () => {
    const html = renderToStaticMarkup(<BrandStudioTeaser />);
    assert.match(html, /Brand Styles require Plus or Pro/);
    assert.match(html, /href="\/app\/settings\/billing"/);
    assert.match(html, />Upgrade plan</);
  });

  test("renders the read-only sample brand card with a disabled overlay", () => {
    const html = renderToStaticMarkup(<BrandStudioTeaser />);
    // The pointer-blocking overlay is present and marked decorative.
    assert.match(
      html,
      /<div class="[^"]*cursor-not-allowed[^"]*" aria-hidden="true">/,
    );
    assert.match(html, new RegExp(SAMPLE_BRAND.name));
  });

  test("renders the sample brand's swatch labels and colors", () => {
    const html = renderToStaticMarkup(<BrandStudioTeaser />);
    for (const label of [
      "Background",
      "Node fill",
      "Node stroke",
      "Node text",
      "Edge",
    ]) {
      assert.match(html, new RegExp(`>${label}<`));
    }
    const preview = brandPreviewStyle(SAMPLE_BRAND);
    assert.match(
      html,
      new RegExp(`background-color:\\s*${preview.background}`),
    );
  });

  test("renders the sample visual preview with a static, non-interactive title", () => {
    const html = renderToStaticMarkup(<BrandStudioTeaser />);
    assert.match(html, /Applied to a sample visual/);
    assert.match(html, /Sample brand applied to a visual/);
  });

  test("exposes no interactive controls other than the upgrade link", () => {
    const html = renderToStaticMarkup(<BrandStudioTeaser />);
    assert.doesNotMatch(html, /<button/);
    assert.doesNotMatch(html, /<input/);
    // Exactly one anchor: the upgrade CTA.
    assert.equal((html.match(/<a /g) ?? []).length, 1);
  });
});
