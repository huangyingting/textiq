import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildDeck } from "@/test/builders/presentation-deck";
import { PresentMode } from "./present-mode";
import { PublicPresentViewer } from "./public-present-viewer";

test("PresentMode renders an empty deck fallback", () => {
  const html = renderToStaticMarkup(
    createElement(PresentMode, {
      deck: buildDeck([]),
      onClose: () => undefined,
    }),
  );

  assert.match(html, /No slides to present/);
  assert.match(html, /Close/);
});

test("PublicPresentViewer renders recovery and empty deck states", () => {
  const emptyDeck = buildDeck([]);
  const recoveryHtml = renderToStaticMarkup(
    createElement(PublicPresentViewer, {
      deck: emptyDeck,
      title: "Recovery deck",
      showAttribution: true,
      recovery: {
        error: "Deck JSON failed validation",
        validationErrors: ["slides must not be empty"],
        diagnostics: [
          {
            code: "invalid-schema-version",
            category: "validation",
            severity: "error",
            message: "Missing slide content",
            target: { scope: "deck" },
          },
        ],
      },
    }),
  );
  const emptyHtml = renderToStaticMarkup(
    createElement(PublicPresentViewer, {
      deck: emptyDeck,
      title: "Empty deck",
    }),
  );

  assert.match(recoveryHtml, /Presentation deck could not be opened/);
  assert.match(recoveryHtml, /Deck JSON failed validation/);
  assert.match(recoveryHtml, /Missing slide content/);
  assert.match(recoveryHtml, /slides must not be empty/);
  assert.match(emptyHtml, /No slides to display/);
});
