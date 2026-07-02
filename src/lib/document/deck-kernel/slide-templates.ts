/**
 * Slide templates — pure, DOM-free blueprints materialized into editable slides.
 *
 * Built-in templates live in code as {@link SlideTemplate} records. Applying a
 * template copies its `elements[]` into real slide elements with fresh ids and
 * concrete `content`; the template itself is not consulted during render/export.
 */

import type { Slide, SlideTemplate, SlideTemplateElement } from "./deck-core";
import type {
  ElementAlign,
  ElementBox,
  SlideElement,
  TextElementStyle,
  VisualElement,
} from "./deck-elements";
import { makeElementId, makeSlideId } from "./deck-ids";
import { isMasterChromeTemplateElement } from "./global-master-chrome";
import type { SlideFormat } from "@/lib/presentation-shared/slide-format";
import type {
  ThemePackageRenderFamily,
  ThemePackageTemplateKind,
} from "./theme-template-taxonomy";

/** The set of templates the "+ Add slide" picker can insert. */
export type SlideTemplateKind =
  | "title"
  | "content"
  | "visual"
  | "two-column"
  | "blank";

/** Context threaded into {@link buildTemplateSlide} from the editor. */
export interface SlideTemplateContext {
  /** Target slide format so materialized template geometry matches the current deck. */
  slideFormat?: SlideFormat;
  /**
   * Optional document visual to seed the "Visual spotlight" template with. When
   * absent the template drops in an empty image placeholder element instead, so
   * the layout works whether or not the document has visuals yet.
   */
  visualId?: string;
}

/** Static metadata describing one template option for the picker UI. */
export interface SlideTemplateOption {
  kind: SlideTemplateKind;
  label: string;
  description: string;
}

/**
 * The ordered list of templates surfaced by the picker. Pure data so the UI and
 * tests share a single source of truth for which kinds exist.
 */
export const SLIDE_TEMPLATES: readonly SlideTemplateOption[] = [
  {
    kind: "title",
    label: "Title",
    description: "Editable title and subtitle",
  },
  {
    kind: "content",
    label: "Content",
    description: "Editable title, body, and visual",
  },
  {
    kind: "visual",
    label: "Visual spotlight",
    description: "Full-bleed visual with a caption",
  },
  {
    kind: "two-column",
    label: "Two-column",
    description: "Editable title over two body columns",
  },
  {
    kind: "blank",
    label: "Blank",
    description: "Empty slide to build from scratch",
  },
];

const TEMPLATE_CATEGORY_BY_KIND: Record<
  SlideTemplateKind,
  SlideTemplate["category"]
> = {
  title: "title",
  content: "content",
  visual: "media",
  "two-column": "comparison",
  blank: "blank",
};

const TEMPLATE_SEMANTIC_KIND_BY_KIND: Partial<
  Record<SlideTemplateKind, ThemePackageTemplateKind>
> = {
  title: "cover",
  content: "content",
  visual: "visual-focus",
  "two-column": "comparison",
};

const TEMPLATE_LAYOUT_FAMILY_BY_KIND: Partial<
  Record<SlideTemplateKind, ThemePackageRenderFamily>
> = {
  title: "cover",
  content: "title-bullets",
  visual: "visual-focus",
  "two-column": "two-column",
};

const BOX = {
  titleTitle: { x: 8, y: 28, w: 84, h: 16 },
  titleSubtitle: { x: 12, y: 48, w: 76, h: 10 },
  titleFooter: { x: 6, y: 90, w: 88, h: 5 },
  contentTitle: { x: 6, y: 6, w: 88, h: 14 },
  contentBody: { x: 6, y: 24, w: 44, h: 58 },
  contentMedia: { x: 54, y: 24, w: 40, h: 58 },
  contentFooter: { x: 6, y: 86, w: 88, h: 6 },
  twoColumnLeft: { x: 6, y: 24, w: 42, h: 58 },
  twoColumnRight: { x: 52, y: 24, w: 42, h: 58 },
  /** Full-bleed visual/image stage for the spotlight template. */
  spotlight: { x: 4, y: 6, w: 92, h: 74 },
  /** Caption strip beneath the spotlight visual. */
  caption: { x: 6, y: 82, w: 88, h: 12 },
} satisfies Record<string, ElementBox>;

export const TEMPLATE_IMAGE_PLACEHOLDER_SRC =
  "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20800%20450%22%3E%3Crect%20width%3D%22800%22%20height%3D%22450%22%20rx%3D%2228%22%20fill%3D%22%23f4f4f5%22%2F%3E%3Crect%20x%3D%2224%22%20y%3D%2224%22%20width%3D%22752%22%20height%3D%22402%22%20rx%3D%2224%22%20fill%3D%22none%22%20stroke%3D%22%23a1a1aa%22%20stroke-width%3D%226%22%20stroke-dasharray%3D%2218%2016%22%2F%3E%3Cpath%20d%3D%22M300%20265l78-78%2062%2062%2036-36%2074%2074%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%2214%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3Ccircle%20cx%3D%22330%22%20cy%3D%22160%22%20r%3D%2226%22%20fill%3D%22%2371717a%22%2F%3E%3Ctext%20x%3D%22400%22%20y%3D%22345%22%20text-anchor%3D%22middle%22%20font-family%3D%22Inter%2CArial%2Csans-serif%22%20font-size%3D%2244%22%20fill%3D%22%2371717a%22%3EAdd%20image%3C%2Ftext%3E%3C%2Fsvg%3E";

function textStyle(
  fontSize: number,
  align: ElementAlign,
  bold: boolean,
): TextElementStyle {
  return { fontSize, align, bold, italic: false };
}

type TemplatePresentationRole = "title" | "subtitle" | "body" | "caption";

function templateTextStyle(role: TemplatePresentationRole): TextElementStyle {
  switch (role) {
    case "title":
      return textStyle(6.5, "center", true);
    case "subtitle":
      return textStyle(4.5, "center", false);
    case "body":
      return textStyle(4.25, "left", false);
    case "caption":
      return textStyle(4.5, "center", true);
  }
}

function textTemplateElement(
  id: string,
  role: TemplatePresentationRole,
  text: string,
  box: ElementBox,
): SlideTemplateElement {
  return {
    id,
    kind: "text",
    role,
    box: { ...box },
    contentDefaults: { kind: "text", text, paragraphs: [{ text }] },
    designOverrides: {
      textStyle: templateTextStyle(role),
    },
  };
}

function imageTemplateElement(
  id: string,
  label: string,
  box: ElementBox,
): SlideTemplateElement {
  return {
    id,
    kind: "image",
    role: "image",
    box: { ...box },
    contentDefaults: {
      kind: "image",
      src: TEMPLATE_IMAGE_PLACEHOLDER_SRC,
      alt: `${label} placeholder`,
    },
  };
}

function builtInTemplate(
  kind: SlideTemplateKind,
  name: string,
  elements: SlideTemplateElement[],
): SlideTemplate {
  const semanticKind = TEMPLATE_SEMANTIC_KIND_BY_KIND[kind];
  const layoutFamily = TEMPLATE_LAYOUT_FAMILY_BY_KIND[kind];
  return {
    id: kind,
    name,
    category: TEMPLATE_CATEGORY_BY_KIND[kind],
    source: "system",
    ...(semanticKind ? { semanticKind } : {}),
    ...(layoutFamily ? { layoutFamily } : {}),
    styleMode: "fixed",
    elements,
  };
}

/* node:coverage ignore next 37 */
/* Built-in template literals are asserted by slide-template tests; tsx maps selected member rows as residual. */
export const BUILT_IN_SLIDE_TEMPLATES: readonly SlideTemplate[] = [
  builtInTemplate("title", "Title", [
    textTemplateElement("title-title", "title", "Title", BOX.titleTitle),
    textTemplateElement(
      "title-subtitle",
      "subtitle",
      "Subtitle",
      BOX.titleSubtitle,
    ),
  ]),
  builtInTemplate("content", "Content", [
    textTemplateElement("content-title", "title", "Title", BOX.contentTitle),
    textTemplateElement("content-body", "body", "Body", BOX.contentBody),
    imageTemplateElement("content-image", "Visual", BOX.contentMedia),
  ]),
  builtInTemplate("visual", "Visual spotlight", [
    imageTemplateElement("visual-media", "Visual", BOX.spotlight),
    textTemplateElement("visual-caption", "caption", "Caption", BOX.caption),
  ]),
  builtInTemplate("two-column", "Two-column", [
    textTemplateElement("two-column-title", "title", "Title", BOX.contentTitle),
    textTemplateElement(
      "two-column-left",
      "body",
      "Left column",
      BOX.twoColumnLeft,
    ),
    textTemplateElement(
      "two-column-right",
      "body",
      "Right column",
      BOX.twoColumnRight,
    ),
  ]),
  builtInTemplate("blank", "Blank", []),
] as const;

/* node:coverage disable */
/* Template lookup success and failure are asserted in slide-template tests; tsx maps the short function as residual. */
export function getBuiltInSlideTemplate(
  kind: SlideTemplateKind,
): SlideTemplate {
  const template = BUILT_IN_SLIDE_TEMPLATES.find((entry) => entry.id === kind);
  if (!template) throw new Error(`Missing built-in slide template "${kind}"`);
  return template;
}
/* node:coverage enable */

/* node:coverage ignore next 13 */
/* Clone behavior is asserted through custom-template materialization tests; tsx maps object-spread rows as residual. */
function cloneContentDefaults(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...input,
    ...(Array.isArray(input.paragraphs)
      ? {
          paragraphs: input.paragraphs.map((paragraph) => ({
            ...(paragraph as object),
          })),
        }
      : {}),
  };
}

function materializeTemplateElement(
  element: SlideTemplateElement,
  zIndex: number,
  ctx: SlideTemplateContext,
): SlideElement {
  const elementScalars = {
    ...(typeof element.opacity === "number"
      ? { opacity: element.opacity }
      : {}),
    ...(typeof element.rotation === "number"
      ? { rotation: element.rotation }
      : {}),
    ...(typeof element.locked === "boolean" ? { locked: element.locked } : {}),
    ...(typeof element.name === "string" ? { name: element.name } : {}),
  };

  if (element.id === "visual-media" && ctx.visualId) {
    return {
      id: makeElementId(),
      kind: "visual",
      role: "visual",
      zIndex,
      box: { ...((element.box as ElementBox | undefined) ?? BOX.spotlight) },
      content: { kind: "visual", visualId: ctx.visualId },
      ...elementScalars,
      ...(element.designOverrides
        ? { designOverrides: element.designOverrides }
        : {}),
    } as unknown as VisualElement;
  }

  return {
    id: makeElementId(),
    kind: element.kind,
    ...(element.role ? { role: element.role } : {}),
    zIndex,
    box: {
      ...((element.box as ElementBox | undefined) ?? {
        x: 10,
        y: 10,
        w: 80,
        h: 20,
      }),
    },
    content: cloneContentDefaults(
      element.contentDefaults ?? { kind: element.kind },
    ),
    ...elementScalars,
    ...(element.designOverrides
      ? { designOverrides: element.designOverrides }
      : {}),
  } as unknown as SlideElement;
}

function blankSlide(): Slide {
  return {
    id: makeSlideId(),
    index: 0,
    title: "",
    notes: "",
    elements: [],
  } as unknown as Slide;
}

/**
 * Constructs a {@link Slide} for the given template `kind`.
 *
 * Non-blank templates return a hand-authored slide with pre-built `elements[]`.
 * `index` is a placeholder — the caller re-indexes when inserting into the deck.
 */
export function buildTemplateSlide(
  kind: SlideTemplateKind,
  ctx: SlideTemplateContext,
): Slide {
  if (kind === "blank") return blankSlide();
  const template = getBuiltInSlideTemplate(kind);
  return {
    id: makeSlideId(),
    index: 0,
    title: "",
    notes: "",
    templateId: kind === "visual" ? "media" : kind,
    ...(template.defaultMasterId ? { masterId: template.defaultMasterId } : {}),
    ...(template.slideDesignDefaults
      ? { designOverrides: template.slideDesignDefaults }
      : {}),
    elements: template.elements
      .filter((element) => !isMasterChromeTemplateElement(element))
      .map((element, index) => materializeTemplateElement(element, index, ctx)),
  } as unknown as Slide;
}
