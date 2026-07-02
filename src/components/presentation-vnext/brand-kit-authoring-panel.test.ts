import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createDefaultBrandKitDraft } from "./brand-kit-authoring-controller";
import { BrandKitAuthoringPanel } from "./brand-kit-authoring-panel";

test("BrandKitAuthoringPanel renders authoring controls and compiler diagnostics", () => {
  const invalidDraft = {
    ...createDefaultBrandKitDraft({
      ownerId: "user-1",
      now: "2026-01-01T00:00:00.000Z",
    }),
    slug: "Invalid Slug",
  };

  const html = renderToStaticMarkup(
    createElement(BrandKitAuthoringPanel, {
      ownerId: "user-1",
      initialDraft: invalidDraft,
      onClose: () => undefined,
    }),
  );

  assert.match(html, /Author brand kit/);
  assert.match(html, /Palette roles/);
  assert.match(html, /Typography roles/);
  assert.match(html, /Logo token/);
  assert.match(html, /Decorations/);
  assert.match(html, /slug must be lower-case kebab-case/);
  assert.match(html, /Save action unavailable|compiler error/);
});
