import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SlideEditor } from "./slide-editor";
import {
  buildMinimalDeck,
  buildMinimalThemePackage,
} from "@/test/builders/presentation-deck";

function renderEditor(
  overrides: Partial<Parameters<typeof SlideEditor>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(SlideEditor, {
      documentId: "doc-save-status",
      deck: buildMinimalDeck(),
      themePackage: buildMinimalThemePackage(),
      onDeckChange: () => undefined,
      ...overrides,
    }),
  );
}

describe("SlideEditor save status announcements", () => {
  test("announces non-error save states via polite status region", () => {
    const html = renderEditor({
      saveStatus: "saving",
      saveStatusLabel: "Saving…",
    });

    assert.match(
      html,
      /<span role="status" aria-live="polite" aria-atomic="true">Saving…<\/span>/,
    );
  });

  test("announces save failures with assertive messaging in editor chrome", () => {
    const html = renderEditor({
      saveStatus: "error",
      saveStatusLabel: "Save failed — Retry",
      saveErrorMessage: "Network timeout",
      onSave: async () => ({ ok: true, data: undefined }),
    });

    assert.match(
      html,
      /<span role="alert" class="sr-only">Save failed — Retry\. Network timeout<\/span>/,
    );
    assert.match(
      html,
      /<span role="status" aria-live="assertive" aria-atomic="true" class="max-w-\[260px\] truncate text-ds-danger-text">Network timeout<\/span>/,
    );
    assert.match(html, />Save failed — Retry<\/button>/);
  });

  test("keeps saving status in the footer without a persistent top save button", () => {
    const html = renderEditor({
      saveStatus: "saving",
      saveStatusLabel: "Saving…",
      onSave: async () => ({ ok: true, data: undefined }),
    });

    assert.match(html, /Saving…/);
    assert.doesNotMatch(html, /aria-label="Save slide deck"/);
  });
});
