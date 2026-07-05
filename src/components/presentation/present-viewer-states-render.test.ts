import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildPublicPresentationModel,
  publicPresentationRecoveryForViewer,
} from "@/lib/public-render/presentation";
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

test("PublicPresentViewer renders a derived public fallback instead of recovery details", () => {
  const model = buildPublicPresentationModel({
    title: "Derived public deck",
    contentJson: {
      root: {
        type: "root",
        children: [
          {
            type: "heading",
            tag: "h1",
            children: [{ type: "text", text: "Visitor-safe fallback" }],
          },
          {
            type: "paragraph",
            children: [{ type: "text", text: "Read-only derived slide text." }],
          },
        ],
      },
    },
    deckJson: { schemaVersion: -1 },
    owner: { name: "Ava", plan: "free" },
  });
  const html = renderToStaticMarkup(
    createElement(PublicPresentViewer, {
      deck: model.deck,
      themePackage: model.themePackage,
      visuals: model.visuals,
      title: model.title,
      recovery: publicPresentationRecoveryForViewer(model.recovery),
    }),
  );

  assert.equal(model.recovery?.fallback, "derived");
  assert.match(html, /Read-only derived slide text/);
  assert.doesNotMatch(html, /Presentation deck could not be opened/);
  assert.doesNotMatch(html, /Unrecognised deck schema/);
});
