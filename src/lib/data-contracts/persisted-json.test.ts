import assert from "node:assert/strict";
import test from "node:test";

import { buildMinimalDeck } from "@/test/builders/presentation-deck";

import {
  PERSISTED_JSON_CONTRACTS,
  getPersistedJsonContract,
} from "./persisted-json";

function validDeck(): unknown {
  return buildMinimalDeck();
}

function validVisual(): Record<string, unknown> {
  return {
    version: 1,
    type: "flowchart",
    width: 760,
    height: 480,
    nodes: [{ id: "n1", label: "Start" }],
    edges: [],
  };
}

test("persisted JSON registry points at current validators", () => {
  assert.deepEqual(Object.keys(PERSISTED_JSON_CONTRACTS).sort(), [
    "Comment.anchor",
    "Document.contentJson:visual",
    "Document.deckJson",
    "DocumentVersion.contentJson:visual",
    "DocumentVersion.deckJson",
    "Visual.data",
  ]);
  assert.equal(
    PERSISTED_JSON_CONTRACTS["Document.deckJson"].validate(validDeck()).success,
    true,
  );
  assert.equal(
    PERSISTED_JSON_CONTRACTS["Document.deckJson"].validator,
    "@/lib/presentation/validation#safeParseDeck",
  );
  assert.equal(
    PERSISTED_JSON_CONTRACTS["DocumentVersion.deckJson"].validator,
    "@/lib/presentation/validation#safeParseDeck",
  );
  assert.equal(
    PERSISTED_JSON_CONTRACTS["Visual.data"].validate(validVisual()).success,
    true,
  );
  assert.equal(
    PERSISTED_JSON_CONTRACTS["DocumentVersion.deckJson"].validate(
      buildMinimalDeck(),
    ).success,
    true,
  );
  assert.equal(getPersistedJsonContract("Visual.data").name, "Visual.data");
});

// @compat — confirms superseded deck shapes and retired anchor types are rejected at the persistence boundary
test("registry rejects superseded deck and invalid comment anchor shapes", () => {
  const legacyV6Deck = {
    schemaVersion: 6,
    canvas: { format: "16:9" },
    design: { themeId: "indigo" },
    masters: [{ id: "master-default", name: "Default", elements: [] }],
    defaultMasterId: "master-default",
    slides: [
      {
        id: "slide-1",
        index: 0,
        title: "Intro",
        notes: "",
        elements: [],
      },
    ],
  };

  assert.equal(
    PERSISTED_JSON_CONTRACTS["Document.deckJson"].validate(legacyV6Deck)
      .success,
    false,
  );
  assert.equal(
    PERSISTED_JSON_CONTRACTS["Document.deckJson"].validate(
      JSON.stringify(validDeck()),
    ).success,
    false,
  );
  assert.equal(
    PERSISTED_JSON_CONTRACTS["DocumentVersion.deckJson"].validate(legacyV6Deck)
      .success,
    false,
  );
  assert.equal(
    PERSISTED_JSON_CONTRACTS["Comment.anchor"].validate({
      anchorType: "legacy",
    }).success,
    false,
  );
  assert.equal(
    PERSISTED_JSON_CONTRACTS["Comment.anchor"].validate({
      slideId: "s1",
      elementId: "e1",
      anchorGeometry: { x: 10, y: 20 },
    }).success,
    true,
  );
});

test("comment anchor contract rejects inconsistent persisted anchors", () => {
  const commentContract = PERSISTED_JSON_CONTRACTS["Comment.anchor"];

  assert.equal(commentContract.validate("not an object").success, false);
  assert.equal(commentContract.validate({ anchorType: "table" }).success, true);
  assert.equal(commentContract.validate({ elementId: "e1" }).success, false);
  assert.equal(
    commentContract.validate({ slideId: "s1", anchorType: "text" }).success,
    false,
  );
  assert.equal(commentContract.validate({ anchorType: "text" }).success, false);
  assert.equal(
    commentContract.validate({ slideId: 42, anchorGeometry: { x: 10, y: 20 } })
      .success,
    false,
  );
});

test("visual JSON contracts reject malformed embedded and row visuals", () => {
  assert.equal(
    PERSISTED_JSON_CONTRACTS["Visual.data"].validate({
      ...validVisual(),
      type: "legacy",
    }).success,
    false,
  );
  assert.equal(
    PERSISTED_JSON_CONTRACTS["Document.contentJson:visual"].validate({
      root: {
        children: [
          {
            type: "visual",
            version: 1,
            visualId: "visual-1",
            visual: { ...validVisual(), type: "legacy" },
          },
        ],
      },
    }).success,
    false,
  );
});
