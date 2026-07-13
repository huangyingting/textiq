/**
 * Direct render coverage for the App Router not-found fallback
 * (`not-found.tsx`) (#1948).
 *
 * `NotFound` is a synchronous Server Component with no data loading, so it
 * is rendered directly with `react-dom/server`'s `renderToStaticMarkup` —
 * safe here because `NotFoundFallback`'s only interactive dependency,
 * `next/link`, never runs its client-only effects during SSR (there is no
 * hydration/effect phase in `renderToStaticMarkup`).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { NotFoundFallback } from "@/components/not-found-fallback";

import NotFound, { metadata } from "./not-found";

describe("NotFound", () => {
  test("exposes a not-found-specific page title", () => {
    assert.equal(metadata.title, "Page not found — TextIQ");
  });

  test("renders the NotFoundFallback component", () => {
    const tree = NotFound();
    assert.equal(tree.type, NotFoundFallback);
  });

  test("renders the 404 heading and both recovery links", () => {
    const html = renderToStaticMarkup(NotFound());
    assert.match(html, />404</);
    assert.match(html, /Page not found/);
    assert.match(html, /href="\/">Go home</);
    assert.match(html, /href="\/app">Go to dashboard</);
  });
});
