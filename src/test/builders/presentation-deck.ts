/**
 * Test builders for Deck and related presentation types.
 */

import type {
  Deck,
  SlideNode,
  SlideChildNode,
  TextNode,
  ImageNode,
  VisualNode,
  ShapeNode,
  TableNode,
  LayoutBox,
  StyleBinding,
  CanvasSpec,
  DeckThemeBinding,
  DeckAssetRegistry,
  ImageAsset,
  SemanticTemplateKind,
  TextContent,
  Paragraph,
  StyleRef,
} from "@/lib/presentation/schema";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
import type { StyleObject, ThemeTokens } from "@/lib/presentation/style-schema";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let _counter = 0;
export function resetBuilderCounter(): void {
  _counter = 0;
}
function nextId(prefix: string = "node"): string {
  return `${prefix}-${(++_counter).toString().padStart(4, "0")}`;
}
function nextParaId(): string {
  return `para-${(++_counter).toString().padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Primitive builders
// ---------------------------------------------------------------------------

export function buildCanvasSpec(
  overrides: Partial<CanvasSpec> = {},
): CanvasSpec {
  return {
    format: "16:9",
    width: 100,
    height: 56.25,
    unit: "percent",
    ...overrides,
  };
}

export function buildThemeBinding(
  overrides: Partial<DeckThemeBinding> = {},
): DeckThemeBinding {
  return {
    packageId: "test-package",
    ...overrides,
  };
}

export function buildAssetRegistry(
  overrides: Partial<DeckAssetRegistry> = {},
): DeckAssetRegistry {
  return {
    images: {},
    ...overrides,
  };
}

export function buildImageAsset(
  id: string = nextId("asset"),
  overrides: Partial<ImageAsset> = {},
): ImageAsset {
  return {
    id,
    src: `https://example.com/${id}.png`,
    ...overrides,
  };
}

export function buildLayoutBox(overrides: Partial<LayoutBox> = {}): LayoutBox {
  return {
    frame: { x: 8, y: 8, w: 84, h: 16 },
    zIndex: 1,
    ...overrides,
  };
}

export function buildStyleBinding(
  ref: StyleRef = "text.body",
  variant?: string,
): StyleBinding {
  return {
    ref,
    ...(variant !== undefined ? { variant } : {}),
  };
}

export function buildParagraph(text: string = "Test text"): Paragraph {
  return { id: nextParaId(), text };
}

export function buildTextContent(texts: string[] = ["Test text"]): TextContent {
  return {
    paragraphs: texts.map((t) => buildParagraph(t)),
  };
}

// ---------------------------------------------------------------------------
// Node builders
// ---------------------------------------------------------------------------

export function buildTextNode(overrides: Partial<TextNode> = {}): TextNode {
  return {
    id: nextId("text"),
    type: "text",
    role: "body",
    layout: buildLayoutBox(),
    style: buildStyleBinding("text.body"),
    content: buildTextContent(["Sample text"]),
    ...overrides,
  };
}

export function buildTitleNode(text: string = "Slide Title"): TextNode {
  return buildTextNode({
    id: nextId("title"),
    role: "title",
    layout: buildLayoutBox({ frame: { x: 8, y: 8, w: 84, h: 14 }, zIndex: 1 }),
    style: buildStyleBinding("text.title"),
    content: buildTextContent([text]),
  });
}

export function buildImageNode(
  assetId: string = "img-001",
  overrides: Partial<ImageNode> = {},
): ImageNode {
  return {
    id: nextId("image"),
    type: "image",
    role: "image",
    layout: buildLayoutBox({
      frame: { x: 50, y: 20, w: 45, h: 60 },
      zIndex: 2,
    }),
    style: buildStyleBinding("media.inline"),
    content: { assetId },
    ...overrides,
  };
}

export function buildVisualNode(
  overrides: Partial<VisualNode> = {},
): VisualNode {
  return {
    id: nextId("visual"),
    type: "visual",
    role: "visual",
    layout: buildLayoutBox({
      frame: { x: 50, y: 20, w: 45, h: 60 },
      zIndex: 2,
    }),
    style: buildStyleBinding("chart.primary"),
    content: { visualId: "visual-001" },
    ...overrides,
  };
}

export function buildShapeNode(overrides: Partial<ShapeNode> = {}): ShapeNode {
  return {
    id: nextId("shape"),
    type: "shape",
    role: "callout",
    layout: buildLayoutBox(),
    style: buildStyleBinding("surface.callout"),
    content: { shape: "rect" },
    ...overrides,
  };
}

export function buildTableNode(overrides: Partial<TableNode> = {}): TableNode {
  return {
    id: nextId("table"),
    type: "table",
    role: "table",
    layout: buildLayoutBox({ frame: { x: 8, y: 22, w: 84, h: 60 }, zIndex: 1 }),
    style: buildStyleBinding("surface.table"),
    content: {
      columns: [
        { id: "col-0", label: "Name" },
        { id: "col-1", label: "Value" },
      ],
      rows: [
        { id: "row-0", cells: [{ text: "Row 1" }, { text: "100" }] },
        { id: "row-1", cells: [{ text: "Row 2" }, { text: "200" }] },
      ],
      header: true,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Slide builders
// ---------------------------------------------------------------------------

export function buildSlide(
  kind: SemanticTemplateKind = "content",
  children: SlideChildNode[] = [],
  overrides: Partial<SlideNode> = {},
): SlideNode {
  return {
    id: nextId("slide"),
    type: "slide",
    template: { kind },
    style: buildStyleBinding("slide.content"),
    children,
    ...overrides,
  };
}

export function buildCoverSlide(): SlideNode {
  return buildSlide(
    "cover",
    [
      buildTitleNode("My Presentation Title"),
      buildTextNode({
        id: nextId("subtitle"),
        role: "subtitle",
        layout: buildLayoutBox({
          frame: { x: 8, y: 55, w: 84, h: 8 },
          zIndex: 2,
        }),
        style: buildStyleBinding("text.subtitle"),
        content: buildTextContent(["Subtitle text"]),
      }),
    ],
    { style: buildStyleBinding("slide.cover") },
  );
}

export function buildContentSlide(title: string = "Slide Title"): SlideNode {
  return buildSlide("content", [
    buildTitleNode(title),
    buildTextNode({
      id: nextId("body"),
      role: "body",
      layout: buildLayoutBox({
        frame: { x: 8, y: 28, w: 84, h: 60 },
        zIndex: 2,
      }),
      style: buildStyleBinding("text.body"),
      content: buildTextContent(["Body paragraph one.", "Body paragraph two."]),
    }),
  ]);
}

export function buildTableSlide(): SlideNode {
  return buildSlide("table", [buildTitleNode("Data Table"), buildTableNode()]);
}

export function buildComparisonSlide(): SlideNode {
  return buildSlide("comparison", [
    buildTitleNode("Comparison"),
    buildTextNode({
      id: nextId("left"),
      role: "label",
      layout: buildLayoutBox({
        frame: { x: 8, y: 22, w: 40, h: 8 },
        zIndex: 2,
      }),
      style: buildStyleBinding("text.subtitle"),
      content: buildTextContent(["Option A"]),
    }),
    buildTextNode({
      id: nextId("right"),
      role: "label",
      layout: buildLayoutBox({
        frame: { x: 52, y: 22, w: 40, h: 8 },
        zIndex: 3,
      }),
      style: buildStyleBinding("text.subtitle"),
      content: buildTextContent(["Option B"]),
    }),
  ]);
}

export function buildVisualSlide(): SlideNode {
  return buildSlide("visual-focus", [
    buildTitleNode("Visual Focus"),
    buildImageNode("img-hero", {
      layout: buildLayoutBox({
        frame: { x: 10, y: 25, w: 80, h: 60 },
        zIndex: 2,
      }),
      style: buildStyleBinding("media.hero"),
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Deck builder
// ---------------------------------------------------------------------------

export function buildDeck(
  slides: SlideNode[] = [buildCoverSlide(), buildContentSlide()],
  overrides: Partial<Deck> = {},
): Deck {
  return {
    schemaVersion: 7,
    canvas: buildCanvasSpec(),
    theme: buildThemeBinding(),
    assets: buildAssetRegistry({
      images: {
        "img-001": buildImageAsset("img-001", { alt: "Test image" }),
        "img-hero": buildImageAsset("img-hero", { alt: "Hero image" }),
      },
    }),
    slides,
    ...overrides,
  };
}

/** Minimal valid deck with a single cover slide. */
export function buildMinimalDeck(): Deck {
  return buildDeck([buildCoverSlide()]);
}

// ---------------------------------------------------------------------------
// Theme package builder
// ---------------------------------------------------------------------------

const MINIMAL_TOKENS: ThemeTokens = {
  colors: {
    canvas: { fill: "#ffffff", text: "#111111", mutedText: "#666666" },
    surface: { fill: "#f5f5f5", text: "#111111", mutedText: "#666666" },
    accent: { fill: "#0066cc", text: "#ffffff" },
  },
  fonts: { heading: "Inter", body: "Inter" },
};

/** Builds a minimal style object with a solid fill. */
function buildMinimalStyleObject(color: string = "#ffffff"): StyleObject {
  return {
    fill: { type: "solid", color },
    text: { fontFamily: "Inter", fontSizePt: 14, color: "#111111" },
  };
}

/** Builds a theme package with all required style refs populated. */
export function buildMinimalThemePackage(
  id: string = "test-package",
  overrides: Partial<ThemePackageV1> = {},
): ThemePackageV1 {
  const styles: ThemePackageV1["styles"] = {} as ThemePackageV1["styles"];
  const styleRefs: StyleRef[] = [
    "slide.cover",
    "slide.content",
    "slide.section",
    "text.title",
    "text.subtitle",
    "text.body",
    "text.kicker",
    "text.caption",
    "text.quote",
    "text.metric",
    "surface.card",
    "surface.callout",
    "surface.table",
    "media.hero",
    "media.inline",
    "chart.primary",
    "connector.primary",
    "decoration.background",
  ];
  for (const ref of styleRefs) {
    styles[ref] = { default: buildMinimalStyleObject() };
  }
  // Add overrides to title for distinction
  styles["text.title"] = {
    default: {
      text: { fontSizePt: 36, fontFamily: "Inter", color: "#111111" },
    },
    large: { text: { fontSizePt: 48, fontFamily: "Inter", color: "#111111" } },
  };
  styles["slide.cover"] = {
    default: {
      slide: {
        background: { type: "solid", color: "#0066cc" },
        chrome: "minimal",
      },
    },
  };

  return {
    schemaVersion: 1,
    id,
    version: "1.0.0",
    name: "Test Package",
    tokens: MINIMAL_TOKENS,
    styles,
    ...overrides,
  };
}
