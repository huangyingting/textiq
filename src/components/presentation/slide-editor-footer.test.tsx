import assert from "node:assert/strict";
import { test } from "node:test";

import type { SlidePresencePeer } from "@/lib/presentation/use-slide-presence";
import { buildDeck } from "@/test/builders/presentation-deck";

import {
  diagnosticsSummary,
  presencePeerSummary,
  selectedSummary,
} from "./slide-editor-footer";

test("footer summaries use stable status labels without mounting the editor shell", () => {
  assert.equal(selectedSummary(0), "No selection");
  assert.equal(selectedSummary(1), "1 node selected");
  assert.equal(selectedSummary(3), "3 nodes selected");
  assert.equal(diagnosticsSummary(0), "No diagnostics");
  assert.equal(diagnosticsSummary(1), "1 diagnostic");
  assert.equal(diagnosticsSummary(2), "2 diagnostics");
});

test("footer presence summaries describe deck, slide, and node context", () => {
  const deck = buildDeck();
  const activeSlideId = deck.slides[0]!.id;
  const otherSlideId = deck.slides[1]!.id;
  const peer = (overrides: Partial<SlidePresencePeer>): SlidePresencePeer => ({
    clientId: 12,
    self: false,
    documentId: "doc-footer",
    userId: "peer-1",
    userName: "Ada",
    selectedSlideId: null,
    selectedNodeIds: [],
    editingMode: "browsing",
    ...overrides,
  });

  assert.equal(
    presencePeerSummary(peer({ selectedSlideId: null }), deck, activeSlideId),
    "Ada: in deck",
  );
  assert.equal(
    presencePeerSummary(
      peer({ selectedSlideId: activeSlideId, selectedNodeIds: ["node-1"] }),
      deck,
      activeSlideId,
    ),
    "Ada: selecting 1 node",
  );
  assert.equal(
    presencePeerSummary(
      peer({ selectedSlideId: otherSlideId }),
      deck,
      activeSlideId,
    ),
    "Ada: on Slide 2",
  );
});
