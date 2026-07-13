/**
 * Direct render coverage for `NotFoundFallback` (#1960).
 *
 * `NotFoundFallback` was previously only exercised indirectly — imported
 * and rendered through `src/app/not-found.tsx`'s own
 * `not-found.test.tsx` (#1948) — never imported and asserted on directly.
 * It is a synchronous, prop-less Server/Client-safe component with no data
 * loading, so it renders straight through `react-dom/server`'s
 * `renderToStaticMarkup`: safe because its only dependency, `next/link`,
 * never runs client-only effects during SSR.
 *
 * Coverage: the "404" glyph, heading, and message copy; the
 * `aria-labelledby` wiring between the `<main>` landmark and the heading
 * `id`; and both recovery links' destinations and labels ("Go home" → `/`,
 * "Go to dashboard" → `/app`).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { NotFoundFallback } from "./not-found-fallback";

describe("NotFoundFallback", () => {
  test("renders the 404 glyph, heading, and recovery message", () => {
    const html = renderToStaticMarkup(NotFoundFallback());

    assert.match(html, />404</);
    assert.match(html, /Page not found/);
    assert.match(
      html,
      /The page you.re looking for doesn.t exist or may have been moved\./,
    );
  });

  test("labels the main landmark via aria-labelledby pointing at the heading id", () => {
    const html = renderToStaticMarkup(NotFoundFallback());

    assert.match(html, /aria-labelledby="not-found-title"/);
    assert.match(html, /id="not-found-title"[^>]*>\s*Page not found/);
  });

  test("renders a 'Go home' link to / and a 'Go to dashboard' link to /app", () => {
    const html = renderToStaticMarkup(NotFoundFallback());

    assert.match(html, /href="\/">Go home</);
    assert.match(html, /href="\/app">Go to dashboard</);
  });
});
