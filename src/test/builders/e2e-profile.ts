import type { Deck } from "@/lib/presentation/schema";
import type { Visual } from "@/lib/visual/schema";
import { fixtureAssetChecksum, fixturePngBuffer } from "./assets";
import {
  buildEditorState,
  buildParagraphNode,
  buildVisualLexicalNode,
  type SerializedFixtureEditorState,
} from "./lexical";
import { buildVisual, buildVisualEdge, buildVisualNode } from "./visual";
import {
  buildDeck,
  buildLayoutBox,
  buildShapeNode,
  buildSlide,
  buildStyleBinding,
  buildTextContent,
  buildTextNode,
  buildTitleNode,
} from "./presentation-deck";

export {
  FIXTURE_PNG_BASE64,
  fixtureAssetChecksum,
  fixturePngBuffer,
} from "./assets";

export const E2E_PROFILE_FIXTURE = {
  owner: {
    email: process.env.E2E_USER_EMAIL ?? "e2e-owner@textiq.test",
    password: process.env.E2E_USER_PASSWORD ?? "e2e-owner-pw-2026",
    name: "E2E Owner",
  },
  editor: {
    email: "e2e-editor@textiq.test",
    password: "e2e-editor-pw-2026",
    name: "E2E Editor",
  },
  viewer: {
    email: process.env.E2E_VIEWER_EMAIL ?? "e2e-viewer@textiq.test",
    password: process.env.E2E_VIEWER_PASSWORD ?? "e2e-viewer-pw-2026",
    name: "E2E Viewer",
  },
  workspaceId: "e2efixtureworkspace0000001",
  documentId: "e2efixturedocument0000001",
  layoutDocumentId: "e2efixturelayoutdoc000001",
  privateDocumentId: "e2efixtureprivatedoc00001",
  visualId: "e2efixturevisual000000001",
  shareId: "e2efixtureshare01",
  slug: "e2e-fixture-deck",
  slideTitleText: "Release Gate Fixture Slide",
  slideTwoTitleText: "Release Gate Fixture Details",
  slideBodyText: "Deterministic deck for the E2E release gate.",
  documentBodyText: "E2E fixture document body for the release gate profile.",
  documentTitle: "E2E Fixture Deck",
  layoutDocumentTitle: "E2E Fixture Layout Deck",
  dashboardTag: {
    name: "Release Gate",
    slug: "release-gate",
  },
  dashboardDocuments: {
    alphaFavorite: {
      id: "e2efixturedashboardalpha01",
      title: "Alpha favorite deterministic dashboard",
      content: "Alpha favorite deterministic dashboard content.",
    },
    betaTagged: {
      id: "e2efixturedashboardbeta001",
      title: "Beta tagged deterministic dashboard",
      content: "Beta tagged deterministic dashboard content.",
    },
  },
} as const;

const F = E2E_PROFILE_FIXTURE;

export function buildE2EProfileVisual(): Visual {
  return buildVisual({
    title: "E2E profile flow",
    width: 700,
    height: 420,
    nodes: [
      buildVisualNode({
        id: "profile-start",
        label: "Seed profile",
        x: 160,
        y: 120,
        icon: "Flag",
      }),
      buildVisualNode({
        id: "profile-deck",
        label: "Open deck",
        x: 360,
        y: 120,
        icon: "Presentation",
      }),
      buildVisualNode({
        id: "profile-export",
        label: "Verify asset",
        x: 560,
        y: 120,
        icon: "Image",
      }),
    ],
    edges: [
      buildVisualEdge({
        id: "profile-e1",
        from: "profile-start",
        to: "profile-deck",
      }),
      buildVisualEdge({
        id: "profile-e2",
        from: "profile-deck",
        to: "profile-export",
      }),
    ],
  });
}

export function buildE2EProfileContentJson(
  visual: Visual = buildE2EProfileVisual(),
): SerializedFixtureEditorState {
  return buildEditorState([
    buildParagraphNode(F.documentBodyText),
    buildVisualLexicalNode(F.visualId, visual),
  ]);
}

export function buildE2EProfileDeck(assetUrl: string, assetId: string): Deck {
  return {
    schemaVersion: 7,
    canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
    theme: { packageId: "neutral" },
    assets: {
      images: {
        [assetId]: {
          id: assetId,
          src: assetUrl,
          alt: "Seeded fixture image",
          mimeType: "image/png",
        },
      },
    },
    slides: [
      {
        id: "e2e-fixture-slide-1",
        type: "slide",
        template: { kind: "content" },
        style: { ref: "slide.content" },
        notes: "",
        children: [
          {
            id: "fixture-title",
            type: "text",
            role: "title",
            layout: { frame: { x: 6, y: 6, w: 88, h: 14 }, zIndex: 0 },
            style: { ref: "text.title" },
            content: {
              paragraphs: [{ id: "fixture-title-p1", text: F.slideTitleText }],
            },
          },
          {
            id: "fixture-bullets",
            type: "text",
            role: "body",
            layout: { frame: { x: 8, y: 26, w: 56, h: 50 }, zIndex: 1 },
            style: { ref: "text.body" },
            content: {
              paragraphs: [
                {
                  id: "fixture-bullet-p1",
                  text: F.slideBodyText,
                  list: { kind: "bullet" },
                },
                {
                  id: "fixture-bullet-p2",
                  text: "Second deterministic point",
                  list: { kind: "bullet" },
                },
              ],
            },
          },
          {
            id: "fixture-image",
            type: "image",
            role: "image",
            layout: { frame: { x: 68, y: 26, w: 26, h: 26 }, zIndex: 2 },
            style: { ref: "media.inline" },
            content: { assetId, fit: "contain", alt: "Seeded fixture image" },
          },
        ],
      },
      {
        id: "e2e-fixture-slide-2",
        type: "slide",
        template: { kind: "detail" },
        style: { ref: "slide.content" },
        notes: "Use this seeded slide to verify presentation navigation.",
        children: [
          {
            id: "fixture-detail-title",
            type: "text",
            role: "title",
            layout: { frame: { x: 6, y: 8, w: 88, h: 14 }, zIndex: 0 },
            style: { ref: "text.title" },
            content: {
              paragraphs: [
                { id: "fixture-detail-title-p1", text: F.slideTwoTitleText },
              ],
            },
          },
          {
            id: "fixture-detail-bullets",
            type: "text",
            role: "body",
            layout: { frame: { x: 8, y: 28, w: 76, h: 42 }, zIndex: 1 },
            style: { ref: "text.body" },
            content: {
              paragraphs: [
                {
                  id: "fixture-detail-bullet-p1",
                  text: "Navigation stays deterministic.",
                  list: { kind: "bullet" },
                },
                {
                  id: "fixture-detail-bullet-p2",
                  text: "Exports include a second seeded slide.",
                  list: { kind: "bullet" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function buildE2EProfileDeckFixture(): Deck {
  const slideOne = buildSlide("content", [
    buildTitleNode(F.slideTitleText),
    buildTextNode({
      id: "layout-body",
      role: "body",
      layout: buildLayoutBox({
        frame: { x: 8, y: 28, w: 56, h: 44 },
        zIndex: 2,
      }),
      style: buildStyleBinding("text.body"),
      content: buildTextContent([F.slideBodyText, "Layout regression fixture"]),
    }),
    buildShapeNode({
      id: "layout-callout",
      role: "callout",
      layout: buildLayoutBox({
        frame: { x: 68, y: 30, w: 24, h: 20 },
        zIndex: 3,
      }),
      style: buildStyleBinding("surface.callout"),
      content: { shape: "rect" },
    }),
  ]);

  const slideTwo = buildSlide("content", [
    buildTitleNode(F.slideTwoTitleText),
    buildTextNode({
      id: "layout-details",
      role: "body",
      layout: buildLayoutBox({
        frame: { x: 8, y: 28, w: 84, h: 48 },
        zIndex: 1,
      }),
      style: buildStyleBinding("text.body"),
      content: buildTextContent([
        "Use this seeded deck for deterministic screenshot gating.",
      ]),
    }),
  ]);

  return buildDeck([slideOne, slideTwo]);
}

export function buildE2EProfileFixtureDescriptor(opts: {
  assetId: string;
  assetPath: string;
  privateAssetPath: string;
  seededAt: string;
}) {
  return {
    owner: { email: F.owner.email, password: F.owner.password },
    editor: { email: F.editor.email, password: F.editor.password },
    viewer: { email: F.viewer.email, password: F.viewer.password },
    documentId: F.documentId,
    documentPath: `/app/documents/${F.documentId}`,
    layoutDocumentId: F.layoutDocumentId,
    layoutDocumentPath: `/app/documents/${F.layoutDocumentId}`,
    shareId: F.shareId,
    slug: F.slug,
    presentPath: `/present/${F.slug}-${F.shareId}`,
    embedPath: `/embed/${F.slug}-${F.shareId}`,
    assetId: opts.assetId,
    assetPath: opts.assetPath,
    privateDocumentId: F.privateDocumentId,
    privateAssetPath: opts.privateAssetPath,
    slideTitleText: F.slideTitleText,
    slideTwoTitleText: F.slideTwoTitleText,
    seededAt: opts.seededAt,
  };
}

export function e2eProfileAssetChecksum(): string {
  return fixtureAssetChecksum(fixturePngBuffer());
}
