import type { Deck } from "@/lib/presentation/schema";
import { hashDocumentBlock } from "@/lib/presentation/document-block-hash";
import type { Visual } from "@/lib/visual/schema";
import { markdownToLexicalStateObject } from "@/lib/content/from-markdown";
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
    plan: "free",
  },
  editor: {
    email: "e2e-editor@textiq.test",
    password: "e2e-editor-pw-2026",
    name: "E2E Editor",
    plan: "pro",
  },
  viewer: {
    email: process.env.E2E_VIEWER_EMAIL ?? "e2e-viewer@textiq.test",
    password: process.env.E2E_VIEWER_PASSWORD ?? "e2e-viewer-pw-2026",
    name: "E2E Viewer",
    plan: "free",
  },
  accountLifecycle: {
    id: "e2efixtureaccountlife00001",
    email: "e2e-account-lifecycle@textiq.test",
    password: "e2e-account-pw-2026",
    replacementPassword: "e2e-account-pw-updated-2026",
    name: "E2E Account Lifecycle",
    updatedName: "E2E Account Lifecycle Updated",
    plan: "free",
  },
  billingLifecycle: {
    id: "e2efixturebillinglife00001",
    subscriptionId: "e2efixturebillingsub000001",
    email: "e2e-billing-lifecycle@textiq.test",
    password: "e2e-billing-pw-2026",
    name: "E2E Billing Lifecycle",
    plan: "free",
  },
  signupLifecycle: {
    id: "e2efixturesignuplife000001",
    email: "e2e-signup-lifecycle@textiq.test",
    password: "e2e-signup-pw-2026",
    name: "E2E Signup Lifecycle",
    cleanupDocumentId: "e2efixturesignupdoc000001",
  },
  brandWorkflow: {
    initialName: "E2E Pro Brand Workflow",
    updatedName: "E2E Pro Brand Workflow Updated",
    fontPath:
      "public/fonts/slides/source-sans-3/source-sans-3-latin-400-normal.woff2",
    fontFamily: "'source-sans-3-latin-400-normal', sans-serif",
  },
  workspaceLifecycle: {
    initialName: "E2E workspace lifecycle",
    renamedName: "E2E workspace lifecycle renamed",
  },
  workspaceId: "e2efixtureworkspace0000001",
  documentId: "e2efixturedocument0000001",
  deckRevisionToken: "e2e-deck-revision-canonical",
  layoutDocumentId: "e2efixturelayoutdoc000001",
  layoutDeckRevisionToken: "e2e-deck-revision-layout",
  privateDocumentId: "e2efixtureprivatedoc00001",
  visualId: "e2efixturevisual000000001",
  shareId: "e2efixtureshare01",
  slug: "e2e-fixture-deck",
  slideTitleText: "Release Gate Fixture Slide",
  slideTwoTitleText: "Release Gate Fixture Details",
  slideBodyText: "Deterministic deck for the E2E release gate.",
  documentBodyText: "E2E fixture document body for the release gate profile.",
  documentBodyBlockId: "e2eBodyBid01",
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
    lifecycle: {
      id: "e2efixturedashboardlifecycle1",
      title: "E2E dashboard lifecycle source",
      renamedTitle: "E2E dashboard lifecycle copy renamed",
      content: "E2E dashboard lifecycle duplicated content.",
    },
  },
  documentMetadataLifecycle: {
    id: "e2efixturedocmetahistory001",
    title: "E2E document metadata and history",
    currentContent: "E2E current state before version restore.",
    restoredContent: "E2E earlier state from version history.",
    versionId: "e2efixtureversionhistory01",
    versionLabel: "E2E restore baseline",
    tagName: "E2E metadata lifecycle",
  },
  documentCommentLifecycle: {
    id: "e2efixturedoccommentlife001",
    title: "E2E document comment lifecycle",
    content: "E2E comment lifecycle anchor paragraph.",
    editedContent: "E2E edited comment lifecycle anchor paragraph.",
    ownerComment: "Owner comment before lifecycle edit.",
    editedOwnerComment: "Owner comment after lifecycle edit.",
    viewerReply: "Viewer reply before lifecycle edit.",
    editedViewerReply: "Viewer reply after lifecycle edit.",
  },
  documentShareLifecycle: {
    id: "e2efixturedocsharelife0001",
    title: "E2E document share lifecycle",
    content: "E2E share lifecycle public document content.",
    passcode: "share-safe-2026",
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
    buildParagraphNode(F.documentBodyText, { bid: F.documentBodyBlockId }),
    buildVisualLexicalNode(F.visualId, visual),
  ]);
}

export function buildE2EGeneratedPresentationContentJson() {
  return markdownToLexicalStateObject(`# Generated first-save presentation

Revenue grew 24% year-over-year from real document content.

- Expand the European launch
- Improve customer retention

## KPI table

| KPI | Result |
| --- | --- |
| NPS | 58 |
| Growth | 24% |

## Next steps

Owners will execute the launch plan and report progress.`);
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

export function buildE2ETableEditingDeck(
  assetUrl: string,
  assetId: string,
): Deck {
  const deck = buildE2EProfileDeck(assetUrl, assetId);
  const firstSlide = deck.slides[0];
  if (!firstSlide) {
    throw new Error("E2E table editing deck requires a first slide.");
  }
  firstSlide.template = { kind: "table" };
  firstSlide.children = [
    {
      id: "fixture-table-title",
      type: "text",
      role: "title",
      layout: { frame: { x: 6, y: 6, w: 88, h: 14 }, zIndex: 0 },
      style: { ref: "text.title" },
      content: {
        paragraphs: [{ id: "fixture-table-title-p1", text: "Team metrics" }],
      },
    },
    {
      id: "fixture-table",
      type: "table",
      role: "table",
      layout: { frame: { x: 8, y: 24, w: 84, h: 48 }, zIndex: 1 },
      style: { ref: "surface.table" },
      content: {
        caption: "Quarterly team metrics",
        header: true,
        columns: [
          { id: "fixture-table-col-name", label: "Name" },
          { id: "fixture-table-col-score", label: "Score" },
        ],
        rows: [
          {
            id: "fixture-table-row-alpha",
            cells: [{ text: "Alpha" }, { text: "10" }],
          },
          {
            id: "fixture-table-row-beta",
            cells: [{ text: "Beta" }, { text: "20" }],
          },
        ],
      },
    },
  ];
  return deck;
}

export const E2E_DIAGNOSTIC_MISSING_ASSET_ID = "e2e-missing-diagnostic-asset";

export function buildE2EDiagnosticsDeck(
  assetUrl: string,
  assetId: string,
): Deck {
  const deck = buildE2EProfileDeck(assetUrl, assetId);
  const imageNode = deck.slides[0]?.children.find(
    (node) => node.type === "image",
  );
  if (imageNode?.type !== "image") {
    throw new Error("E2E diagnostics deck requires a first-slide image node.");
  }
  imageNode.content = {
    ...imageNode.content,
    assetId: E2E_DIAGNOSTIC_MISSING_ASSET_ID,
  };
  return deck;
}

export function buildE2ESourceLinkedDeck(
  assetUrl: string,
  assetId: string,
  documentId: string,
): Deck {
  const deck = buildE2EProfileDeck(assetUrl, assetId);
  const sourceNode = deck.slides[0]?.children[0];
  if (!sourceNode) {
    throw new Error("E2E source-linked deck requires a first slide node.");
  }
  sourceNode.source = {
    documentId,
    blockId: F.documentBodyBlockId,
    blockKind: "text",
    linkedAt: "2026-01-01T00:00:00.000Z",
    display: {
      documentTitle: F.documentTitle,
      blockLabel: F.documentBodyText,
      blockKindLabel: "Text",
    },
  };
  return deck;
}

export function buildE2ESourceReviewDeck(
  assetUrl: string,
  assetId: string,
  documentId: string,
): Deck {
  const deck = buildE2EProfileDeck(assetUrl, assetId);
  const sourceNode = deck.slides[0]?.children[0];
  if (sourceNode?.type !== "text") {
    throw new Error("E2E source-review deck requires a first-slide text node.");
  }
  const sourceBlock = {
    kind: "text" as const,
    blockType: "paragraph" as const,
    text: F.documentBodyText,
    blockId: F.documentBodyBlockId,
  };
  sourceNode.content = {
    ...sourceNode.content,
    paragraphs: [{ id: "fixture-title-source-p1", text: F.documentBodyText }],
  };
  sourceNode.source = {
    documentId,
    blockId: F.documentBodyBlockId,
    blockKind: "text",
    contentHash: hashDocumentBlock(sourceBlock),
    linkedAt: "2026-01-01T00:00:00.000Z",
    display: {
      documentTitle: F.documentTitle,
      blockLabel: F.documentBodyText,
      blockKindLabel: "Text",
    },
  };
  return deck;
}

export function buildE2EMultiSelectArrangeDeck(): Deck {
  return buildDeck(
    [
      buildSlide("content", [
        buildTextNode({
          id: "arrange-node-a",
          name: "A",
          layout: buildLayoutBox({
            frame: { x: 10, y: 10, w: 10, h: 10 },
            zIndex: 1,
          }),
          content: buildTextContent(["A"]),
        }),
        buildTextNode({
          id: "arrange-node-b",
          name: "B",
          layout: buildLayoutBox({
            frame: { x: 30, y: 25, w: 20, h: 15 },
            zIndex: 2,
          }),
          content: buildTextContent(["B"]),
        }),
        buildTextNode({
          id: "arrange-node-c",
          name: "C",
          layout: buildLayoutBox({
            frame: { x: 80, y: 70, w: 10, h: 20 },
            zIndex: 3,
          }),
          content: buildTextContent(["C"]),
        }),
      ]),
    ],
    {
      theme: { packageId: "neutral", packageVersion: "1.0.0" },
      assets: { images: {} },
    },
  );
}

export function buildE2EPrecisionGuidesDeck(): Deck {
  return buildDeck(
    [
      buildSlide("content", [
        buildTextNode({
          id: "guide-target",
          name: "Guide target",
          layout: buildLayoutBox({
            frame: { x: 20, y: 20, w: 10, h: 12 },
            zIndex: 1,
          }),
          content: buildTextContent(["Guide target"]),
        }),
        buildTextNode({
          id: "guide-reference",
          name: "Guide reference",
          layout: buildLayoutBox({
            frame: { x: 70, y: 60, w: 12, h: 10 },
            zIndex: 2,
          }),
          content: buildTextContent(["Guide reference"]),
        }),
      ]),
    ],
    {
      theme: { packageId: "neutral", packageVersion: "1.0.0" },
      assets: { images: {} },
    },
  );
}

export function buildE2ETouchControlsDeck(): Deck {
  return buildDeck(
    [
      buildSlide("content", [
        buildTextNode({
          id: "touch-text",
          name: "Touch text",
          layout: buildLayoutBox({
            frame: { x: 20, y: 40, w: 60, h: 12 },
            zIndex: 1,
          }),
          content: buildTextContent(["Touch text"]),
        }),
      ]),
    ],
    {
      theme: { packageId: "neutral", packageVersion: "1.0.0" },
      assets: { images: {} },
    },
  );
}

export function buildE2EOverlapSelectionDeck(): Deck {
  return buildDeck(
    [
      buildSlide("content", [
        buildTextNode({
          id: "overlap-earlier-high-z",
          name: "Earlier high z",
          layout: buildLayoutBox({
            frame: { x: 25, y: 30, w: 50, h: 20 },
            zIndex: 900,
          }),
          content: buildTextContent(["Earlier high z"]),
        }),
        buildTextNode({
          id: "overlap-later-low-z",
          name: "Later low z",
          layout: buildLayoutBox({
            frame: { x: 25, y: 30, w: 50, h: 20 },
            zIndex: -900,
          }),
          content: buildTextContent(["Later low z"]),
        }),
      ]),
    ],
    {
      theme: { packageId: "neutral", packageVersion: "1.0.0" },
      assets: { images: {} },
    },
  );
}

export function buildE2EGroupLayerOrderDeck(): Deck {
  return buildDeck(
    [
      buildSlide("content", [
        buildShapeNode({
          id: "group-root-back",
          name: "Root back",
          layout: buildLayoutBox({
            frame: { x: 20, y: 20, w: 60, h: 30 },
            zIndex: 5,
          }),
          localStyle: { fill: { type: "solid", color: "#facc15" } },
        }),
        buildShapeNode({
          id: "group-back",
          name: "Group back",
          layout: buildLayoutBox({
            frame: { x: 22, y: 25, w: 24, h: 20 },
            zIndex: 10,
          }),
          localStyle: { fill: { type: "solid", color: "#ef4444" } },
        }),
        buildShapeNode({
          id: "group-front",
          name: "Group front",
          layout: buildLayoutBox({
            frame: { x: 54, y: 25, w: 24, h: 20 },
            zIndex: 11,
          }),
          localStyle: { fill: { type: "solid", color: "#2563eb" } },
        }),
        buildShapeNode({
          id: "group-root-front",
          name: "Root front",
          layout: buildLayoutBox({
            frame: { x: 82, y: 60, w: 10, h: 10 },
            zIndex: 20,
          }),
          localStyle: { fill: { type: "solid", color: "#111827" } },
        }),
      ]),
    ],
    {
      theme: { packageId: "neutral", packageVersion: "1.0.0" },
      assets: { images: {} },
    },
  );
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
