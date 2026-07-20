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
import type { SlideChildNode } from "@/lib/presentation/schema";

import {
  buildPublicPresentationModel,
  publicPresentationRecoveryForViewer,
} from "./presentation";

function textFromNodes(nodes: readonly SlideChildNode[]): string {
  return nodes
    .flatMap((node) => {
      if (node.type === "text") {
        return node.content.paragraphs.map((paragraph) => paragraph.text);
      }
      if (node.type === "group") return [textFromNodes(node.children)];
      return [];
    })
    .join("\n");
}

function fallbackContentJson() {
  return {
    root: {
      type: "root",
      children: [
        {
          type: "heading",
          tag: "h1",
          bid: "heading-1",
          children: [{ type: "text", text: "Launch plan" }],
        },
        {
          type: "paragraph",
          bid: "paragraph-1",
          children: [
            { type: "text", text: "Public visitors should see this content." },
          ],
        },
      ],
    },
  };
}

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

test("buildPublicPresentationModel derives a public fallback for invalid deckJson with usable content", () => {
  const model = buildPublicPresentationModel({
    id: "doc-public-1",
    title: "Fallback deck",
    contentJson: fallbackContentJson(),
    deckJson: { schemaVersion: -1 },
    owner: { name: null, plan: "free" },
  });

  assert.equal(model.title, "Fallback deck");
  assert.equal(model.deck.schemaVersion, 7);
  assert.equal(model.deck.metadata?.sourceDocumentId, "doc-public-1");
  assert.equal(model.recovery?.fallback, "derived");
  assert.equal(
    model.recovery?.error.includes("Unrecognised deck schema"),
    true,
  );
  assert.equal(publicPresentationRecoveryForViewer(model.recovery), undefined);
  assert.match(
    model.deck.slides.map((slide) => textFromNodes(slide.children)).join("\n"),
    /Public visitors should see this content/,
  );
  assert.equal(model.attribution.ownerName, "Document owner");
});

test("buildPublicPresentationModel derives a public fallback for missing deckJson with usable content", () => {
  const model = buildPublicPresentationModel({
    title: "Fallback deck",
    contentJson: fallbackContentJson(),
    deckJson: null,
    owner: { name: null, plan: "free" },
  });

  assert.equal(model.deck.schemaVersion, 7);
  assert.equal(model.recovery?.fallback, "derived");
  assert.equal(
    model.recovery?.error.includes("Deck JSON must be a plain object"),
    true,
  );
  assert.equal(publicPresentationRecoveryForViewer(model.recovery), undefined);
});

test("buildPublicPresentationModel exposes blocking recovery for invalid deckJson without usable content", () => {
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
  assert.equal(model.recovery?.fallback, "none");
  assert.equal(
    publicPresentationRecoveryForViewer(model.recovery),
    model.recovery,
  );
  assert.equal(model.attribution.ownerName, "Document owner");
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
  const externalSlideAssetSrc =
    "https://attacker.example/api/slide-assets/doc-1/uploads/protected.png?cache=1";
  const sameOriginAbsoluteSlideAssetSrc =
    "https://textiq.local/api/slide-assets/doc-1/uploads/protected.png?cache=1";
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
          "external-slide-asset-img": buildImageAsset(
            "external-slide-asset-img",
            {
              src: externalSlideAssetSrc,
              alt: "External slide asset image",
            },
          ),
          "same-origin-absolute-slide-asset-img": buildImageAsset(
            "same-origin-absolute-slide-asset-img",
            {
              src: sameOriginAbsoluteSlideAssetSrc,
              alt: "Same-origin absolute slide asset image",
            },
          ),
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
  assert.equal(
    model.deck.assets.images["external-slide-asset-img"]?.src,
    externalSlideAssetSrc,
  );
  assert.equal(
    model.deck.assets.images["same-origin-absolute-slide-asset-img"]?.src,
    sameOriginAbsoluteSlideAssetSrc,
  );
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
