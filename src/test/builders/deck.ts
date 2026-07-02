import {
  LEGACY_DECK_SCHEMA_VERSION,
  type ConnectorElement,
  type Deck,
  type ElementBox,
  type ImageElement,
  type Paragraph,
  type ShapeElement,
  type Slide,
  type SlideElement,
  type SourceRef,
  type TextElement,
  type TextElementStyle,
  type TextRun,
  type VisualElement,
  type ImageFitMode,
  type ImageMaskShape,
  type ShapeKind,
} from "@/lib/document/deck-model";

type LayoutPlaceholder = {
  id: string;
  placeholderType: "title" | "subtitle" | "body" | "visual" | "footer";
  zIndex: number;
  box: ElementBox;
  label?: string;
};

export function buildElementBox(
  overrides: Partial<ElementBox> = {},
): ElementBox {
  return {
    x: overrides.x ?? 8,
    y: overrides.y ?? 8,
    w: overrides.w ?? 84,
    h: overrides.h ?? 16,
  };
}

export function buildTextStyle(
  overrides: Partial<TextElementStyle> = {},
): TextElementStyle {
  return {
    fontSize: overrides.fontSize ?? 4,
    bold: overrides.bold ?? false,
    italic: overrides.italic ?? false,
    align: overrides.align ?? "left",
    ...(overrides.underline !== undefined
      ? { underline: overrides.underline }
      : {}),
    ...(overrides.verticalAlign !== undefined
      ? { verticalAlign: overrides.verticalAlign }
      : {}),
    ...(overrides.lineHeight !== undefined
      ? { lineHeight: overrides.lineHeight }
      : {}),
    ...(overrides.paragraphSpacing !== undefined
      ? { paragraphSpacing: overrides.paragraphSpacing }
      : {}),
    ...(overrides.color !== undefined ? { color: overrides.color } : {}),
    ...(overrides.fontId !== undefined ? { fontId: overrides.fontId } : {}),
  };
}

export function buildSourceRef(overrides: Partial<SourceRef> = {}): SourceRef {
  return {
    documentId: overrides.documentId ?? "doc-fixture",
    blockId: overrides.blockId ?? "block-fixture",
    blockKind: overrides.blockKind ?? "text",
    linkedAt: overrides.linkedAt ?? "2026-06-22T17:49:04.676Z",
    ...("contentHash" in overrides
      ? overrides.contentHash !== undefined
        ? { contentHash: overrides.contentHash }
        : {}
      : { contentHash: "hash-fixture" }),
    ...(overrides.unlinked !== undefined
      ? { unlinked: overrides.unlinked }
      : {}),
  };
}

type TextElementOverrides = Partial<TextElement> & {
  text?: string;
  paragraphs?: Paragraph[];
  runs?: TextRun[];
  style?: Partial<TextElementStyle>;
};

export function buildTextElement(
  overrides: TextElementOverrides = {},
): TextElement {
  const text = overrides.content?.text ?? overrides.text ?? "Fixture text";
  const paragraphs = overrides.content?.paragraphs ??
    overrides.paragraphs ?? [
      {
        text,
        ...(overrides.runs !== undefined && overrides.runs.length > 0
          ? { runs: overrides.runs }
          : {}),
      },
    ];
  return {
    id: overrides.id ?? "text-fixture",
    kind: "text",
    role: overrides.role ?? "body",
    zIndex: overrides.zIndex ?? 0,
    box: buildElementBox(overrides.box),
    content: {
      kind: "text",
      text,
      paragraphs,
      ...(overrides.content?.runs !== undefined
        ? { runs: overrides.content.runs }
        : overrides.runs !== undefined
          ? { runs: overrides.runs }
          : {}),
      ...(overrides.content?.fitMode !== undefined
        ? { fitMode: overrides.content.fitMode }
        : {}),
      ...(overrides.content?.bulletGap !== undefined
        ? { bulletGap: overrides.content.bulletGap }
        : {}),
      ...(overrides.content?.bulletIndent !== undefined
        ? { bulletIndent: overrides.content.bulletIndent }
        : {}),
    },
    designOverrides: {
      ...(overrides.designOverrides ?? {}),
      textStyle:
        overrides.designOverrides?.textStyle ?? buildTextStyle(overrides.style),
    },
    ...(overrides.source !== undefined ? { source: overrides.source } : {}),
    ...(overrides.opacity !== undefined ? { opacity: overrides.opacity } : {}),
    ...(overrides.rotation !== undefined
      ? { rotation: overrides.rotation }
      : {}),
    ...(overrides.shadow !== undefined ? { shadow: overrides.shadow } : {}),
    ...(overrides.locked !== undefined ? { locked: overrides.locked } : {}),
    ...(overrides.hidden !== undefined ? { hidden: overrides.hidden } : {}),
    ...(overrides.name !== undefined ? { name: overrides.name } : {}),
    ...(overrides.groupId !== undefined ? { groupId: overrides.groupId } : {}),
  } as unknown as TextElement;
}

type TextListOverrides = TextElementOverrides & {
  bullets?: string[];
  itemRuns?: TextRun[][];
  items?: Paragraph[];
};

export function buildBulletsElement(
  overrides: TextListOverrides = {},
): TextElement {
  const bullets = overrides.bullets ?? ["First point", "Second point"];
  const paragraphs = (
    overrides.paragraphs ??
    overrides.items ??
    bullets.map((text: string, index: number) => ({
      text,
      ...(overrides.itemRuns?.[index] && overrides.itemRuns[index].length > 0
        ? { runs: overrides.itemRuns[index] }
        : {}),
      listType: "bullet" as const,
    }))
  ).map((paragraph) => ({
    ...paragraph,
    listType: paragraph.listType ?? ("bullet" as const),
  }));
  return {
    id: overrides.id ?? "bullets-fixture",
    kind: "text",
    role: overrides.role ?? "bullet",
    zIndex: overrides.zIndex ?? 1,
    box: buildElementBox(overrides.box ?? { y: 28, h: 48 }),
    content: {
      kind: "text",
      text: paragraphs.map((paragraph: Paragraph) => paragraph.text).join("\n"),
      paragraphs,
      ...(overrides.content?.fitMode !== undefined
        ? { fitMode: overrides.content.fitMode }
        : {}),
      ...(overrides.content?.bulletGap !== undefined
        ? { bulletGap: overrides.content.bulletGap }
        : {}),
      ...(overrides.content?.bulletIndent !== undefined
        ? { bulletIndent: overrides.content.bulletIndent }
        : {}),
    },
    designOverrides: {
      ...(overrides.designOverrides ?? {}),
      textStyle:
        overrides.designOverrides?.textStyle ?? buildTextStyle(overrides.style),
    },
    ...(overrides.source !== undefined ? { source: overrides.source } : {}),
    ...(overrides.opacity !== undefined ? { opacity: overrides.opacity } : {}),
    ...(overrides.rotation !== undefined
      ? { rotation: overrides.rotation }
      : {}),
    ...(overrides.locked !== undefined ? { locked: overrides.locked } : {}),
    ...(overrides.hidden !== undefined ? { hidden: overrides.hidden } : {}),
    ...(overrides.name !== undefined ? { name: overrides.name } : {}),
    ...(overrides.groupId !== undefined ? { groupId: overrides.groupId } : {}),
  } as unknown as TextElement;
}

type VisualElementOverrides = Partial<VisualElement> & {
  visualId?: string;
  styleThemeId?: string;
  alt?: string;
};

export function buildVisualElement(
  overrides: VisualElementOverrides = {},
): VisualElement {
  const content = overrides.content ?? {
    kind: "visual" as const,
    visualId: overrides.visualId ?? "visual-fixture",
    ...(overrides.styleThemeId !== undefined
      ? { styleThemeId: overrides.styleThemeId }
      : {}),
    ...(overrides.alt !== undefined ? { alt: overrides.alt } : {}),
  };
  return {
    id: overrides.id ?? "visual-element-fixture",
    kind: "visual",
    role: overrides.role ?? "visual",
    zIndex: overrides.zIndex ?? 2,
    box: buildElementBox(overrides.box ?? { x: 20, y: 22, w: 60, h: 56 }),
    content,
    ...(overrides.source !== undefined ? { source: overrides.source } : {}),
    ...(overrides.opacity !== undefined ? { opacity: overrides.opacity } : {}),
    ...(overrides.rotation !== undefined
      ? { rotation: overrides.rotation }
      : {}),
    ...(overrides.locked !== undefined ? { locked: overrides.locked } : {}),
    ...(overrides.hidden !== undefined ? { hidden: overrides.hidden } : {}),
    ...(overrides.name !== undefined ? { name: overrides.name } : {}),
    ...(overrides.groupId !== undefined ? { groupId: overrides.groupId } : {}),
  } as unknown as VisualElement;
}

type ImageElementOverrides = Partial<ImageElement> & {
  src?: string;
  alt?: string;
  radius?: number;
  fitMode?: ImageFitMode;
  maskShape?: ImageMaskShape;
  crop?: ImageElement["content"]["crop"];
  assetId?: string;
};

export function buildImageElement(
  overrides: ImageElementOverrides = {},
): ImageElement {
  return {
    id: overrides.id ?? "image-fixture",
    kind: "image",
    role: overrides.role ?? "image",
    zIndex: overrides.zIndex ?? 2,
    box: buildElementBox(overrides.box ?? { x: 60, y: 30, w: 30, h: 30 }),
    content: overrides.content ?? {
      kind: "image",
      src: overrides.src ?? "https://example.test/fixture.png",
      ...(overrides.assetId !== undefined
        ? { assetId: overrides.assetId }
        : {}),
      ...(overrides.alt !== undefined ? { alt: overrides.alt } : {}),
      ...(overrides.crop !== undefined ? { crop: overrides.crop } : {}),
    },
    designOverrides: overrides.designOverrides ?? {
      ...(overrides.fitMode !== undefined
        ? { fitMode: overrides.fitMode }
        : {}),
      ...(overrides.maskShape !== undefined
        ? { maskShape: overrides.maskShape }
        : {}),
      ...(overrides.radius !== undefined ? { radius: overrides.radius } : {}),
    },
    ...(overrides.source !== undefined ? { source: overrides.source } : {}),
    ...(overrides.opacity !== undefined ? { opacity: overrides.opacity } : {}),
    ...(overrides.rotation !== undefined
      ? { rotation: overrides.rotation }
      : {}),
    ...(overrides.shadow !== undefined ? { shadow: overrides.shadow } : {}),
    ...(overrides.locked !== undefined ? { locked: overrides.locked } : {}),
    ...(overrides.hidden !== undefined ? { hidden: overrides.hidden } : {}),
    ...(overrides.name !== undefined ? { name: overrides.name } : {}),
    ...(overrides.groupId !== undefined ? { groupId: overrides.groupId } : {}),
  } as unknown as ImageElement;
}

type ShapeElementOverrides = Partial<ShapeElement> & {
  shape?: ShapeKind;
  color?: string;
  text?: string;
  textRuns?: TextRun[];
  textStyle?: Partial<TextElementStyle>;
  stroke?: { color: string; width: number };
  radius?: number;
};

export function buildShapeElement(
  overrides: ShapeElementOverrides = {},
): ShapeElement {
  return {
    id: overrides.id ?? "shape-fixture",
    kind: "shape",
    role: overrides.role ?? "label",
    zIndex: overrides.zIndex ?? 3,
    box: buildElementBox(overrides.box ?? { x: 20, y: 20, w: 20, h: 20 }),
    content: overrides.content ?? {
      kind: "shape",
      shape: overrides.shape ?? "rect",
      ...(overrides.text !== undefined ? { text: overrides.text } : {}),
      ...(overrides.textRuns !== undefined
        ? { textRuns: overrides.textRuns }
        : {}),
    },
    designOverrides: overrides.designOverrides ?? {
      fill: { value: overrides.color ?? "#123456" },
      ...(overrides.textStyle !== undefined
        ? { textStyle: buildTextStyle(overrides.textStyle) }
        : {}),
      ...(overrides.stroke !== undefined ? { stroke: overrides.stroke } : {}),
      ...(overrides.radius !== undefined ? { radius: overrides.radius } : {}),
    },
    ...(overrides.source !== undefined ? { source: overrides.source } : {}),
    ...(overrides.opacity !== undefined ? { opacity: overrides.opacity } : {}),
    ...(overrides.rotation !== undefined
      ? { rotation: overrides.rotation }
      : {}),
    ...(overrides.shadow !== undefined ? { shadow: overrides.shadow } : {}),
    ...(overrides.locked !== undefined ? { locked: overrides.locked } : {}),
    ...(overrides.hidden !== undefined ? { hidden: overrides.hidden } : {}),
    ...(overrides.name !== undefined ? { name: overrides.name } : {}),
    ...(overrides.groupId !== undefined ? { groupId: overrides.groupId } : {}),
  } as unknown as ShapeElement;
}

type ConnectorElementOverrides = Partial<ConnectorElement> & {
  start?: ConnectorElement["content"]["start"];
  end?: ConnectorElement["content"]["end"];
  routing?: ConnectorElement["content"]["routing"];
  stroke?: NonNullable<ConnectorElement["designOverrides"]>["stroke"];
  arrowStart?: NonNullable<ConnectorElement["designOverrides"]>["arrowStart"];
  arrowEnd?: NonNullable<ConnectorElement["designOverrides"]>["arrowEnd"];
  dash?: NonNullable<ConnectorElement["designOverrides"]>["dash"];
};

export function buildConnectorElement(
  overrides: ConnectorElementOverrides = {},
): ConnectorElement {
  return {
    id: overrides.id ?? "connector-fixture",
    kind: "connector",
    zIndex: overrides.zIndex ?? 4,
    box: buildElementBox(overrides.box ?? { x: 0, y: 0, w: 100, h: 100 }),
    content: {
      kind: "connector",
      start: overrides.start ?? { x: 10, y: 20 },
      end: overrides.end ?? { x: 80, y: 70 },
      ...(overrides.routing !== undefined
        ? { routing: overrides.routing }
        : {}),
    },
    designOverrides: {
      ...(overrides.stroke !== undefined ? { stroke: overrides.stroke } : {}),
      ...(overrides.arrowStart !== undefined
        ? { arrowStart: overrides.arrowStart }
        : {}),
      ...(overrides.arrowEnd !== undefined
        ? { arrowEnd: overrides.arrowEnd }
        : {}),
      ...(overrides.dash !== undefined ? { dash: overrides.dash } : {}),
    },
    ...(overrides.opacity !== undefined ? { opacity: overrides.opacity } : {}),
    ...(overrides.source !== undefined ? { source: overrides.source } : {}),
  } as unknown as ConnectorElement;
}

export function buildPlaceholderElement(
  overrides: Partial<LayoutPlaceholder> = {},
): LayoutPlaceholder {
  return {
    id: overrides.id ?? "placeholder-fixture",
    placeholderType: overrides.placeholderType ?? "title",
    zIndex: overrides.zIndex ?? 0,
    box: buildElementBox(overrides.box),
    ...(overrides.label !== undefined ? { label: overrides.label } : {}),
  };
}

type SlideBuilderOverrides = Partial<Slide>;

type DeckBuilderOverrides = Partial<
  Omit<Deck, "schemaVersion" | "masters" | "slides">
> & {
  schemaVersion?: number;
  masters?: unknown[];
  slides?: Array<Slide | SlideBuilderOverrides>;
};

export function buildSlide(overrides: SlideBuilderOverrides = {}): Slide {
  const slideOverrides = overrides as any;
  const title = overrides.title ?? "Fixture slide";
  return {
    ...slideOverrides,
    id: slideOverrides.id ?? "slide-fixture",
    index: slideOverrides.index ?? 0,
    title,
    notes: slideOverrides.notes ?? "",
    elements: slideOverrides.elements ?? [
      buildTextElement({
        id: "slide-title",
        role: "title",
        text: title,
        style: { fontSize: 6, bold: true, italic: false, align: "left" },
      }),
      buildBulletsElement({ id: "slide-bullets" }),
    ],
  } as Slide;
}

export function buildDeck(overrides: DeckBuilderOverrides = {}): Deck {
  const rawOverrides = overrides as any;
  const themeId = rawOverrides.design?.themeId ?? "default";
  const themeOverrides = rawOverrides.design?.themeOverrides ?? {};
  const {
    schemaVersion,
    canvas,
    design: _design,
    masters,
    defaultMasterId,
    slides: overrideSlides,
    deckContentHash,
    ...deckOverrides
  } = rawOverrides;
  const slides = overrideSlides ?? [buildSlide()];
  return {
    ...deckOverrides,
    schemaVersion: schemaVersion ?? LEGACY_DECK_SCHEMA_VERSION,
    canvas: {
      format: canvas?.format ?? "16:9",
    },
    design: {
      themeId,
      ...(Object.keys(themeOverrides).length > 0 ? { themeOverrides } : {}),
    },
    masters: masters ?? [
      { id: "master-default", name: "Default", elements: [] },
    ],
    defaultMasterId: defaultMasterId ?? "master-default",
    slides: slides as Deck["slides"],
    ...(deckContentHash !== undefined ? { deckContentHash } : {}),
  } as Deck;
}

// ---------------------------------------------------------------------------
// Lightweight factories — for tests that need a minimal Slide or Deck shape
// without the full element defaults from buildSlide/buildDeck.
// ---------------------------------------------------------------------------

/** Minimal slide with text elements identified only by their IDs. */
export function makeSlideWithElementIds(
  id: string,
  elementIds: string[] = [],
): Slide {
  return {
    id,
    index: 0,
    title: "",
    notes: "",
    elements: elementIds.map((eid) => ({
      id: eid,
      kind: "text" as const,
      role: "body" as const,
      zIndex: 0,
      box: { x: 0, y: 0, w: 100, h: 10 },
      content: { kind: "text" as const, text: "" },
      designOverrides: {
        textStyle: {
          fontSize: 4.5,
          bold: false,
          italic: false,
          align: "left" as const,
        },
      },
    })) as SlideElement[],
  } as unknown as Slide;
}

/** Minimal slide with explicit id/index/title and no elements. */
export function makeMinimalSlide(
  id: string,
  index: number,
  title: string,
): Slide {
  return {
    id,
    index,
    title,
    notes: "",
    elements: [],
  };
}

/** Minimal deck wrapping an array of slides (themeId "default"). */
export function makeMinimalDeck(slides: Slide[]): Deck {
  return buildDeck({ slides });
}

/**
 * Minimal deck built from an array of slide IDs.
 * Each slide gets a sequential index and a generic title.
 */
export function makeDeckFromIds(slideIds: string[]): Deck {
  return buildDeck({
    slides: slideIds.map((id, index) =>
      buildSlide({
        id,
        index,
        title: `Slide ${index + 1}`,
        notes: "",
      }),
    ),
  });
}
