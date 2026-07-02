import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDeck,
  buildCoverSlide,
  buildImageAsset,
  buildImageNode,
  buildSlide,
  buildVisualNode,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";
import { DEFAULT_STYLE, VISUAL_SCHEMA_VERSION } from "@/lib/visual/schema";

import {
  buildPublicPresentationModel,
  buildPublicPresentationModelAny,
} from "./presentation";

test("buildPublicPresentationModel carries valid presentation deckJson", () => {
  resetBuilderCounter();
  const presentationDeck = buildDeck([buildCoverSlide()], {
    theme: { packageId: "ocean" },
  });
  const model = buildPublicPresentationModel({
    title: "Public deck",
    contentJson: { root: { children: [] } },
    deckJson: presentationDeck,
    owner: { name: "Ava", plan: "free" },
  });

  assert.equal(model.title, "Public deck");
  assert.equal(model.deck.schemaVersion, 7);
  assert.equal(model.themePackage.id, presentationDeck.theme.packageId);
  assert.equal(model.deck.slides[0].id, presentationDeck.slides[0].id);
  assert.equal(model.attribution.ownerName, "Ava");
});

test("buildPublicPresentationModel resolves runtime presentation theme package fallback diagnostics", () => {
  resetBuilderCounter();
  const presentationDeck = buildDeck([buildCoverSlide()], {
    theme: { packageId: "missing-package" },
  });
  const model = buildPublicPresentationModel({
    title: "Public deck",
    contentJson: { root: { children: [] } },
    deckJson: presentationDeck,
    owner: { name: "Ava", plan: "free" },
  });

  assert.equal(model.themePackage.id, "neutral");
  assert.equal(model.diagnostics[0]?.code, "unknown-theme-package");
});

test("buildPublicPresentationModel exposes recovery for invalid deckJson", () => {
  const model = buildPublicPresentationModel({
    title: "Fallback deck",
    contentJson: { root: { children: [] } },
    deckJson: { schemaVersion: -1 },
    owner: { name: null, plan: "free" },
  });

  assert.equal(model.title, "Fallback deck");
  assert.equal(
    model.recovery?.error.includes("Unrecognised deck schema"),
    true,
  );
  assert.equal(model.recovery?.validationErrors?.length, 1);
  assert.equal(model.attribution.ownerName, "Document owner");
});

test("buildPublicPresentationModelAny returns the presentation-only model", () => {
  resetBuilderCounter();
  const presentationDeck = buildDeck([buildCoverSlide()]);
  const model = buildPublicPresentationModelAny({
    title: "presentation deck",
    contentJson: { root: { children: [] } },
    deckJson: presentationDeck,
    owner: { name: "Alex", plan: "pro" },
  });

  assert.equal(model.title, "presentation deck");
  assert.equal(model.deck.schemaVersion, 7);
  assert.equal(model.attribution.ownerName, "Alex");
});

test("buildPublicPresentationModel keeps presentation protected asset references instead of contentJson fallback", () => {
  resetBuilderCounter();
  const assetSrc = "/api/slide-assets/doc-1/uploads/protected.png";
  const presentationDeck = buildDeck(
    [
      buildSlide("visual-focus", [
        buildImageNode("protected-img", { id: "protected-image-node" }),
      ]),
    ],
    {
      theme: { packageId: "neutral" },
      assets: {
        images: {
          "protected-img": buildImageAsset("protected-img", {
            src: assetSrc,
            alt: "Protected upload",
          }),
        },
      },
    },
  );
  const model = buildPublicPresentationModel({
    title: "Protected public deck",
    contentJson: {
      slides: [{ id: "legacy-slide", elements: [{ id: "legacy-image" }] }],
    },
    deckJson: presentationDeck,
    owner: { name: "Ava", plan: "pro" },
  });

  assert.equal(model.deck.schemaVersion, 7);
  assert.equal(model.deck.slides[0].children[0]?.id, "protected-image-node");
  assert.equal(model.deck.assets.images["protected-img"]?.src, assetSrc);
  assert.equal(model.themePackage.id, "neutral");
});

test("buildPublicPresentationModel binds protected slide asset URLs to the exposing share link", () => {
  resetBuilderCounter();
  const boundImageSrc = "/api/slide-assets/doc-1/uploads/protected.png?cache=1";
  const externalSrc = "https://cdn.example.com/hero.png";
  const presentationDeck = buildDeck(
    [buildSlide("content", [buildImageNode("protected-img")])],
    {
      assets: {
        images: {
          "protected-img": buildImageAsset("protected-img", {
            src: boundImageSrc,
            alt: "Protected upload",
          }),
          "external-img": buildImageAsset("external-img", {
            src: externalSrc,
            alt: "External image",
          }),
        },
      },
    },
  );

  const model = buildPublicPresentationModel(
    {
      title: "Share-bound public deck",
      contentJson: { root: { children: [] } },
      deckJson: presentationDeck,
      owner: { name: "Ava", plan: "pro" },
    },
    { shareId: "share123", mode: "present" },
  );

  assert.equal(
    model.deck.assets.images["protected-img"]?.src,
    "/api/slide-assets/doc-1/uploads/protected.png?cache=1&shareId=share123&shareMode=present",
  );
  assert.equal(model.deck.assets.images["external-img"]?.src, externalSrc);
});

test("buildPublicPresentationModel exposes live document visuals for present rendering", () => {
  resetBuilderCounter();
  const presentationDeck = buildDeck([
    buildSlide("visual-focus", [
      buildVisualNode({
        content: {
          visualId: "visual-live-1",
          alt: "Live journey map",
        },
      }),
    ]),
  ]);
  const visual = {
    version: VISUAL_SCHEMA_VERSION,
    type: "flowchart" as const,
    title: "Live journey map",
    width: 960,
    height: 540,
    nodes: [{ id: "n1", label: "Start" }],
    edges: [],
    style: { ...DEFAULT_STYLE },
  };

  const model = buildPublicPresentationModel({
    title: "Live visual deck",
    contentJson: {
      root: {
        children: [
          {
            type: "visual",
            visualId: "visual-live-1",
            visual,
          },
        ],
      },
    },
    deckJson: presentationDeck,
    owner: { name: "Ava", plan: "pro" },
  });

  assert.equal(model.visuals["visual-live-1"], visual);
});
