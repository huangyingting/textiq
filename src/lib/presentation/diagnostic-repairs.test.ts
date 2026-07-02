import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { applyDiagnosticRepairAction } from "./diagnostic-repairs";
import { makeDiagnostic } from "./diagnostics";
import type { SlideChildNode } from "./schema";
import type { StyleBinding } from "./style-schema";
import {
  buildDeck,
  buildTextNode,
  buildCoverSlide,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";

function defaultStyleBindingForNode(_node: SlideChildNode): StyleBinding {
  return { ref: "text.body" };
}

function makeDeckWithStyledNode() {
  resetBuilderCounter();
  const node = buildTextNode({
    id: "text-1",
    style: { ref: "text.title" },
    localStyle: { text: { color: "#111827" } },
  });
  const slide = { ...buildCoverSlide(), id: "slide-1", children: [node] };
  return buildDeck([slide]);
}

describe("applyDiagnosticRepairAction", () => {
  test("resets local overrides through editor commands", () => {
    const deck = makeDeckWithStyledNode();
    const diagnostic = makeDiagnostic(
      "local-style-overrides",
      "info",
      "Override",
      {
        slideId: "slide-1",
        nodeId: "text-1",
        action: { type: "remove-override" },
      },
    );

    const result = applyDiagnosticRepairAction(
      deck,
      diagnostic.action!,
      diagnostic,
      { activeSlideId: "slide-1", defaultStyleBindingForNode },
    );

    assert.equal(result.status, "applied");
    if (result.status !== "applied") return;
    assert.equal(result.deck.slides[0].children[0].localStyle, undefined);
    assert.equal(deck.slides[0].children[0].localStyle?.text?.color, "#111827");
  });

  test("removes only diagnostic-requested override keys", () => {
    resetBuilderCounter();
    const node = buildTextNode({
      id: "text-1",
      style: { ref: "text.title" },
      localStyle: {
        text: { color: "#111827" },
        fill: { type: "solid", color: "#f97316" },
      },
    });
    const deck = buildDeck([
      { ...buildCoverSlide(), id: "slide-1", children: [node] },
    ]);
    const diagnostic = makeDiagnostic(
      "local-style-overrides",
      "info",
      "Override",
      {
        slideId: "slide-1",
        nodeId: "text-1",
        action: { type: "remove-override", payload: { styleKeys: ["fill"] } },
      },
    );

    const result = applyDiagnosticRepairAction(
      deck,
      diagnostic.action!,
      diagnostic,
      { activeSlideId: "slide-1", defaultStyleBindingForNode },
    );

    assert.equal(result.status, "applied");
    if (result.status !== "applied") return;
    assert.equal(result.deck.slides[0].children[0].localStyle?.fill, undefined);
    assert.equal(
      result.deck.slides[0].children[0].localStyle?.text?.color,
      "#111827",
    );
  });

  test("replaces style refs and leaves failed repairs unchanged", () => {
    const deck = makeDeckWithStyledNode();
    const diagnostic = makeDiagnostic(
      "unknown-style-ref",
      "error",
      "Missing style",
      {
        slideId: "slide-1",
        nodeId: "text-1",
        action: { type: "replace-style-ref" },
      },
    );
    const missingTarget = makeDiagnostic(
      "unknown-style-ref",
      "error",
      "Missing style",
      {
        slideId: "slide-1",
        nodeId: "missing-node",
        action: { type: "replace-style-ref" },
      },
    );

    const repaired = applyDiagnosticRepairAction(
      deck,
      diagnostic.action!,
      diagnostic,
      { activeSlideId: "slide-1", defaultStyleBindingForNode },
    );
    const failed = applyDiagnosticRepairAction(
      deck,
      missingTarget.action!,
      missingTarget,
      { activeSlideId: "slide-1", defaultStyleBindingForNode },
    );

    assert.equal(repaired.status, "applied");
    if (repaired.status === "applied") {
      assert.deepEqual(repaired.deck.slides[0].children[0].style, {
        ref: "text.body",
      });
    }
    assert.deepEqual(failed, {
      status: "noop",
      reason: "No style ref target was found.",
    });
  });

  test("splits a node via the splitNodeToSlide command", () => {
    const deck = makeDeckWithStyledNode();
    const diagnostic = makeDiagnostic(
      "slot-over-capacity",
      "warning",
      "Split content",
      {
        slideId: "slide-1",
        nodeId: "text-1",
        action: { type: "split-slide" },
      },
    );

    const result = applyDiagnosticRepairAction(
      deck,
      diagnostic.action!,
      diagnostic,
      { activeSlideId: "slide-1", defaultStyleBindingForNode },
    );

    assert.equal(result.status, "applied");
    if (result.status !== "applied") return;
    assert.equal(result.deck.slides.length, 2);
    assert.equal(result.focus.nodeId, "text-1");
    assert.equal(result.deck.slides[1].children[0].id, "text-1");
  });

  test("routes open-asset-panel to a host action without mutating the deck", () => {
    const deck = makeDeckWithStyledNode();
    const diagnostic = makeDiagnostic(
      "missing-asset",
      "error",
      "Missing asset",
      {
        slideId: "slide-1",
        nodeId: "text-1",
        action: { type: "open-asset-panel" },
      },
    );

    const result = applyDiagnosticRepairAction(
      deck,
      diagnostic.action!,
      diagnostic,
      { activeSlideId: "slide-1", defaultStyleBindingForNode },
    );

    assert.equal(result.status, "host-action");
    if (result.status !== "host-action") return;
    assert.equal(result.port, "asset-panel");
    assert.equal(result.focus.nodeId, "text-1");
  });

  test("chooses dense layout for slide-level diagnostics", () => {
    resetBuilderCounter();
    const deck = buildDeck([{ ...buildCoverSlide(), id: "slide-1" }]);
    const diagnostic = makeDiagnostic(
      "slot-over-capacity",
      "warning",
      "Dense layout needed",
      { slideId: "slide-1", action: { type: "choose-denser-layout" } },
    );

    const result = applyDiagnosticRepairAction(
      deck,
      diagnostic.action!,
      diagnostic,
      { activeSlideId: "slide-1", defaultStyleBindingForNode },
    );

    assert.equal(result.status, "applied");
    if (result.status === "applied") {
      assert.equal(result.deck.slides[0].controls?.density, "dense");
    }
  });

  test("restores stale disabled theme decorations", () => {
    resetBuilderCounter();
    const deck = buildDeck([{ ...buildCoverSlide(), id: "slide-1" }], {
      theme: {
        packageId: "test-package",
        overrides: { disabledDecorations: ["missing-decoration"] },
      },
    });
    const diagnostic = makeDiagnostic(
      "missing-decoration",
      "warning",
      "Missing decoration",
      {
        slideId: "slide-1",
        action: {
          type: "restore-decoration",
          payload: { decorationId: "missing-decoration" },
        },
      },
    );

    const result = applyDiagnosticRepairAction(
      deck,
      diagnostic.action!,
      diagnostic,
      { activeSlideId: "slide-1", defaultStyleBindingForNode },
    );

    assert.equal(result.status, "applied");
    if (result.status !== "applied") return;
    assert.equal(
      result.deck.theme.overrides?.disabledDecorations?.includes(
        "missing-decoration",
      ) ?? false,
      false,
    );
  });

  test("no-ops restore decoration repairs without a repairable decoration", () => {
    const deck = buildDeck([{ ...buildCoverSlide(), id: "slide-1" }]);
    const missingPayload = makeDiagnostic(
      "missing-decoration",
      "warning",
      "Missing decoration",
      {
        slideId: "slide-1",
        action: { type: "restore-decoration" },
      },
    );
    const alreadyRestored = makeDiagnostic(
      "missing-decoration",
      "warning",
      "Missing decoration",
      {
        slideId: "slide-1",
        action: {
          type: "restore-decoration",
          payload: { decorationId: "bg-corner" },
        },
      },
    );

    assert.deepEqual(
      applyDiagnosticRepairAction(
        deck,
        missingPayload.action!,
        missingPayload,
        { activeSlideId: "slide-1", defaultStyleBindingForNode },
      ),
      { status: "noop", reason: "No decoration target was found." },
    );
    assert.deepEqual(
      applyDiagnosticRepairAction(
        deck,
        alreadyRestored.action!,
        alreadyRestored,
        { activeSlideId: "slide-1", defaultStyleBindingForNode },
      ),
      { status: "noop", reason: "The decoration was already restored." },
    );
  });
});
