import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildDeck,
  buildSlide,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import { deleteActiveSlideFromToolbar } from "./slide-editor-toolbar-actions";
import { SlideEditorCloseConfirmDialog, SlideEditor } from "./slide-editor";

function editorDeck() {
  return buildDeck([
    buildSlide("content", [buildTextNode({ id: "text-one" })], {
      id: "slide-one",
      name: "First",
    }),
    buildSlide("content", [buildTextNode({ id: "text-two" })], {
      id: "slide-two",
      name: "Second",
    }),
  ]);
}

test("deleteActiveSlideFromToolbar covers empty, minimum, and successful delete branches", () => {
  const twoSlideDeck = editorDeck();
  const noActive = deleteActiveSlideFromToolbar(twoSlideDeck, undefined);
  assert.equal(noActive.deleted, false);
  assert.equal(noActive.nextDeck, twoSlideDeck);
  assert.equal(noActive.nextIndex, 0);

  const oneSlideDeck = buildDeck([twoSlideDeck.slides[0]]);
  const minimum = deleteActiveSlideFromToolbar(oneSlideDeck, "slide-one");
  assert.equal(minimum.deleted, false);
  assert.equal(minimum.nextDeck, oneSlideDeck);
  assert.match(minimum.statusMessage ?? "", /at least one slide/);

  const deleted = deleteActiveSlideFromToolbar(twoSlideDeck, "slide-one");
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.nextDeck.slides.length, 1);
  assert.equal(deleted.nextDeck.slides[0]?.id, "slide-two");
  assert.equal(deleted.nextIndex, 0);
});

test("SlideEditor renders optional-toolbar fallbacks without optional actions", () => {
  const html = renderToStaticMarkup(
    createElement(SlideEditor, {
      documentId: "doc-remaining-render",
      deck: editorDeck(),
      hasUnsavedWork: true,
      saveStatus: "saved",
      saveStatusLabel: "Saved locally",
      onDeckChange: () => undefined,
    }),
  );

  assert.match(html, /Deck tools/);
  assert.match(html, /Saved locally/);
  assert.doesNotMatch(html, /Close slide editor/);
  assert.doesNotMatch(html, /Export as PPTX/);
});

test("SlideEditorCloseConfirmDialog routes cancel and discard button callbacks", () => {
  const calls: string[] = [];
  const dialog = SlideEditorCloseConfirmDialog({
    onCancel: () => calls.push("cancel"),
    onDiscard: () => calls.push("discard"),
  });
  const buttons = (dialog.props as { children: unknown[] }).children
    .flatMap((child) =>
      typeof child === "object" && child && "props" in child
        ? ((child as { props: { children?: unknown } }).props
            .children as unknown)
        : [],
    )
    .flatMap((child) => (Array.isArray(child) ? child : [child]))
    .filter(
      (child): child is { props: { onClick?: () => void } } =>
        typeof child === "object" &&
        child !== null &&
        "props" in child &&
        typeof (child as { props: { onClick?: unknown } }).props.onClick ===
          "function",
    );

  for (const button of buttons) button.props.onClick?.();
  assert.deepEqual(calls, ["cancel", "discard"]);
});
