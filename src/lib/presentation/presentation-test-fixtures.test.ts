import assert from "node:assert/strict";
import test from "node:test";

import {
  buildE2EDiagnosticsDeck,
  buildE2EMultiSelectArrangeDeck,
  buildE2EGroupLayerOrderDeck,
  buildE2EGeneratedPresentationContentJson,
  buildE2EOverlapSelectionDeck,
  buildE2EPrecisionGuidesDeck,
  buildE2ETouchControlsDeck,
} from "../../test/builders/e2e-profile";
import {
  CONFLICT_RECOVERY_FIXTURES,
  PRESENTATION_TEST_FIXTURES,
  PRESENTATION_CONTROL_FIXTURES,
  POINTER_INTERACTION_FIXTURES,
  SLIDES_SMOKE_MUTATION_FIXTURES,
  assertPresentationFixtureSlotSeeded,
  configuredPresentationFixtureSlots,
  configuredPresentationTestFixtures,
  presentationFixtureSlotKey,
  presentationTestFixture,
  type PresentationTestFixtureName,
} from "../../../e2e/helpers/presentation-fixtures";
import { deriveDeckFromDocumentContent } from "./deck-derivation";
import { safeParseDeck } from "./validation";

test("presentation fixtures keep document, share, slug, and revision identities unique", () => {
  const fixtures = Object.values(PRESENTATION_TEST_FIXTURES);
  for (const field of [
    "documentId",
    "shareId",
    "slug",
    "deckRevisionToken",
  ] as const) {
    assert.equal(
      new Set(fixtures.map((fixture) => fixture[field])).size,
      fixtures.length,
    );
  }
  assert.ok(fixtures.every((fixture) => fixture.deckRevisionToken.length > 0));
});

test("project, repeat, and parallel slots derive stable collision-free fixture identities", () => {
  const slots = [
    { project: { name: "chromium" }, repeatEachIndex: 0, parallelIndex: 0 },
    { project: { name: "chromium" }, repeatEachIndex: 1, parallelIndex: 0 },
    { project: { name: "chromium" }, repeatEachIndex: 0, parallelIndex: 1 },
    { project: { name: "webkit" }, repeatEachIndex: 0, parallelIndex: 0 },
  ];
  const envValue = JSON.stringify(
    slots.map((slot) => ({
      projectName: slot.project.name,
      repeatEachIndex: slot.repeatEachIndex,
      parallelIndex: slot.parallelIndex,
    })),
  );
  const previous = process.env.E2E_PROFILE_FIXTURE_SLOTS;
  process.env.E2E_PROFILE_FIXTURE_SLOTS = envValue;
  try {
    const fixtures = slots.map((slot) =>
      presentationTestFixture("editorRailMutations", slot),
    );
    assert.equal(
      new Set(fixtures.map((fixture) => fixture.documentId)).size,
      fixtures.length,
    );
    assert.equal(
      new Set(fixtures.map((fixture) => fixture.shareId)).size,
      fixtures.length,
    );
    const keys = slots.map(presentationFixtureSlotKey);
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual(keys, slots.map(presentationFixtureSlotKey));
  } finally {
    if (previous === undefined) delete process.env.E2E_PROFILE_FIXTURE_SLOTS;
    else process.env.E2E_PROFILE_FIXTURE_SLOTS = previous;
  }
});

test("fixture slot contract defaults direct specs deterministically and rejects unseeded identities", () => {
  assert.deepEqual(configuredPresentationFixtureSlots({}), [
    {
      project: { name: "chromium" },
      repeatEachIndex: 0,
      parallelIndex: 0,
    },
  ]);
  assert.deepEqual(
    configuredPresentationFixtureSlots({
      E2E_PROFILE_FIXTURE_SLOTS: JSON.stringify([
        {
          projectName: "webkit",
          repeatEachIndex: 2,
          parallelIndex: 3,
        },
      ]),
    }),
    [
      {
        project: { name: "webkit" },
        repeatEachIndex: 2,
        parallelIndex: 3,
      },
    ],
  );
  assert.throws(
    () =>
      configuredPresentationFixtureSlots({
        E2E_PROFILE_FIXTURE_SLOTS: "[]",
      }),
    /at least one/,
  );
  assert.equal(
    assertPresentationFixtureSlotSeeded({
      project: { name: "chromium" },
      repeatEachIndex: 0,
      parallelIndex: 0,
    }),
    "p6368726f6d69756dr0x0",
  );
  assert.throws(
    () =>
      assertPresentationFixtureSlotSeeded({
        project: { name: "chromium" },
        repeatEachIndex: 1,
        parallelIndex: 0,
      }),
    /was not seeded/,
  );
});

test("configured fixture matrix derives every fixture for every seeded slot", () => {
  const env = {
    E2E_PROFILE_FIXTURE_SLOTS: JSON.stringify([
      {
        projectName: "chromium",
        repeatEachIndex: 0,
        parallelIndex: 0,
      },
      {
        projectName: "webkit",
        repeatEachIndex: 2,
        parallelIndex: 3,
      },
    ]),
  };
  const fixtures = configuredPresentationTestFixtures(env);
  const fixtureCount = Object.keys(PRESENTATION_TEST_FIXTURES).length;

  assert.equal(fixtures.length, fixtureCount * 2);
  assert.equal(
    new Set(fixtures.map(({ documentId }) => documentId)).size,
    fixtures.length,
  );
  assert.deepEqual(
    fixtures.slice(0, 2).map(({ documentId }) => documentId),
    [
      PRESENTATION_TEST_FIXTURES.editorRailMutations.documentId,
      `${PRESENTATION_TEST_FIXTURES.editorRailMutations.documentId}p7765626b6974r2x3`,
    ],
  );
});

test("slides-smoke mutation fixtures resolve independently in any execution order", () => {
  const scenarios = Object.entries(SLIDES_SMOKE_MUTATION_FIXTURES);
  const resolve = (
    entries: [string, PresentationTestFixtureName][],
  ): Record<string, string> =>
    Object.fromEntries(
      entries
        .map(([scenario, fixtureName]) => [
          scenario,
          presentationTestFixture(fixtureName).documentId,
        ])
        .sort(([left], [right]) => left.localeCompare(right)),
    );

  const forward = resolve([...scenarios]);
  const reverse = resolve([...scenarios].reverse());

  assert.deepEqual(reverse, forward);
  assert.equal(new Set(Object.values(forward)).size, scenarios.length);
});

test("pointer interaction fixtures resolve independently in any execution order", () => {
  const scenarios = Object.entries(POINTER_INTERACTION_FIXTURES);
  const resolve = (
    entries: [string, PresentationTestFixtureName][],
  ): Record<string, string> =>
    Object.fromEntries(
      entries
        .map(([scenario, fixtureName]) => [
          scenario,
          presentationTestFixture(fixtureName).documentId,
        ])
        .sort(([left], [right]) => left.localeCompare(right)),
    );

  const forward = resolve([...scenarios]);
  const reverse = resolve([...scenarios].reverse());

  assert.deepEqual(reverse, forward);
  assert.equal(new Set(Object.values(forward)).size, scenarios.length);
});

test("conflict recovery fixtures use separate tokenized documents", () => {
  const fixtures = Object.values(CONFLICT_RECOVERY_FIXTURES).map(
    (fixtureName) => presentationTestFixture(fixtureName),
  );

  assert.equal(new Set(fixtures.map((fixture) => fixture.documentId)).size, 2);
  assert.equal(
    new Set(fixtures.map((fixture) => fixture.deckRevisionToken)).size,
    2,
  );
  assert.ok(fixtures.every((fixture) => fixture.deckRevisionToken.length > 0));
});

test("presentation control workflows use isolated deterministic documents", () => {
  const fixtures = Object.values(PRESENTATION_CONTROL_FIXTURES).map(
    (fixtureName) => presentationTestFixture(fixtureName),
  );

  assert.equal(
    new Set(fixtures.map((fixture) => fixture.documentId)).size,
    fixtures.length,
  );
  assert.deepEqual(
    fixtures.map((fixture) => fixture.deckKind),
    [
      "arrange",
      "guides",
      "default",
      "default",
      "themeVersions",
      "touch",
      "group",
      "default",
      "default",
      "sourceReview",
      "sourceReview",
      "default",
      "diagnostics",
    ],
  );
  assert.ok(fixtures.every((fixture) => fixture.deckRevisionToken.length > 0));
});

test("deck diagnostics fixture stays valid while referencing one missing image asset", () => {
  const deck = buildE2EDiagnosticsDeck("/asset.png", "seeded-asset");
  const parsed = safeParseDeck(deck);

  assert.equal(parsed.success, true);
  const imageNode = deck.slides[0]?.children.find(
    (node) => node.type === "image",
  );
  assert.equal(imageNode?.type, "image");
  if (imageNode?.type === "image") {
    assert.equal(imageNode.content.assetId, "e2e-missing-diagnostic-asset");
    assert.equal(deck.assets.images[imageNode.content.assetId], undefined);
  }
});

test("overlap fixture preserves later-low-z foreground traversal", () => {
  const slide = buildE2EOverlapSelectionDeck().slides[0];
  assert.ok(slide);
  assert.deepEqual(
    slide.children.map((node) => [node.id, node.layout?.zIndex]),
    [
      ["overlap-earlier-high-z", 900],
      ["overlap-later-low-z", -900],
    ],
  );
});

test("group layer fixture starts with independent nodes for UI grouping persistence", () => {
  const slide = buildE2EGroupLayerOrderDeck().slides[0];
  assert.ok(slide);
  assert.deepEqual(
    slide.children.map((node) => [
      node.id,
      node.layout?.frame,
      node.layout?.zIndex,
    ]),
    [
      ["group-root-back", { x: 20, y: 20, w: 60, h: 30 }, 5],
      ["group-back", { x: 22, y: 25, w: 24, h: 20 }, 10],
      ["group-front", { x: 54, y: 25, w: 24, h: 20 }, 11],
      ["group-root-front", { x: 82, y: 60, w: 10, h: 10 }, 20],
    ],
  );
});

test("multi-select Arrange fixture has the required named unlocked top-level frames", () => {
  const slide = buildE2EMultiSelectArrangeDeck().slides[0];
  assert.ok(slide);
  assert.deepEqual(
    slide.children.map((node) => {
      assert.ok(node.layout);
      return {
        id: node.id,
        name: node.name,
        frame: node.layout.frame,
        locked: node.locked ?? false,
      };
    }),
    [
      {
        id: "arrange-node-a",
        name: "A",
        frame: { x: 10, y: 10, w: 10, h: 10 },
        locked: false,
      },
      {
        id: "arrange-node-b",
        name: "B",
        frame: { x: 30, y: 25, w: 20, h: 15 },
        locked: false,
      },
      {
        id: "arrange-node-c",
        name: "C",
        frame: { x: 80, y: 70, w: 10, h: 20 },
        locked: false,
      },
    ],
  );
});

test("precision guide fixture isolates a movable named target away from default guides", () => {
  const slide = buildE2EPrecisionGuidesDeck().slides[0];
  assert.ok(slide);
  const target = slide.children.find((node) => node.id === "guide-target");
  assert.ok(target);
  assert.ok(target.layout);
  assert.equal(target.name, "Guide target");
  assert.deepEqual(target.layout.frame, { x: 20, y: 20, w: 10, h: 12 });
});

test("touch fixture exposes one named text node in an unobstructed stage region", () => {
  const slide = buildE2ETouchControlsDeck().slides[0];
  assert.ok(slide);
  assert.equal(slide.children.length, 1);
  const [target] = slide.children;
  assert.ok(target);
  assert.ok(target.layout);
  assert.equal(target.name, "Touch text");
  assert.deepEqual(target.layout.frame, { x: 20, y: 40, w: 60, h: 12 });
});

test("generated first-save fixture starts from structured document content", () => {
  const result = deriveDeckFromDocumentContent({
    contentJson: JSON.stringify(buildE2EGeneratedPresentationContentJson()),
    documentId: "generated-first-save",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.deck.slides.length > 1);
  assert.ok(
    result.deck.slides
      .flatMap((slide) => slide.children)
      .some((node) => node.type === "table"),
  );
});
