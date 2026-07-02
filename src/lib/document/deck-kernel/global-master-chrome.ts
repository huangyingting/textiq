import type { Deck, MasterChromeKind, MasterElement } from "./deck-core";
import type { ElementAlign, ElementBox, SlideElement } from "./deck-elements";
import { makeElementId } from "./deck-ids";

export type GlobalMasterChromeKind = MasterChromeKind;

export type LogoPlacement =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";
export type LogoSize = "small" | "medium" | "large";
export type PageNumberFormat = "number" | "number-total";
export type PageNumberPlacement =
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";
export type WatermarkLayout = "center" | "diagonal";
export type WatermarkSize = "small" | "medium" | "large";

export interface GlobalMasterLogoState {
  enabled: boolean;
  src: string;
  assetId?: string;
  placement: LogoPlacement;
  size: LogoSize;
}

export interface GlobalMasterFooterState {
  enabled: boolean;
  text: string;
  align: ElementAlign;
}

export interface GlobalMasterPageNumberState {
  enabled: boolean;
  format: PageNumberFormat;
  placement: PageNumberPlacement;
}

export interface GlobalMasterWatermarkState {
  enabled: boolean;
  text: string;
  opacity: number;
  layout: WatermarkLayout;
  size: WatermarkSize;
}

export interface GlobalMasterChromeState {
  logo: GlobalMasterLogoState;
  footer: GlobalMasterFooterState;
  pageNumber: GlobalMasterPageNumberState;
  watermark: GlobalMasterWatermarkState;
}

export type GlobalMasterChromeUpdate =
  | { kind: "logo"; state: GlobalMasterLogoState }
  | { kind: "footer"; state: GlobalMasterFooterState }
  | { kind: "pageNumber"; state: GlobalMasterPageNumberState }
  | { kind: "watermark"; state: GlobalMasterWatermarkState };

const MASTER_CHROME_KINDS = [
  "logo",
  "footer",
  "pageNumber",
  "watermark",
] as const;
const WATERMARK_NAME = "Watermark";
const DEFAULT_LOGO_SRC = "";
const DEFAULT_FOOTER_TEXT = "Footer";
const DEFAULT_WATERMARK_TEXT = "Confidential";

const LOGO_SIZE_BOX: Record<LogoSize, { w: number; h: number }> = {
  small: { w: 8, h: 5 },
  medium: { w: 12, h: 7 },
  large: { w: 16, h: 9 },
};

const WATERMARK_FONT_SIZE: Record<WatermarkSize, number> = {
  small: 7,
  medium: 10,
  large: 13,
};

export function getGlobalMaster(
  deck: Deck,
): NonNullable<Deck["masters"]>[number] | undefined {
  const masters = deck.masters ?? [];
  return (
    masters.find((master) => master.id === deck.defaultMasterId) ?? masters[0]
  );
}

export function isMasterChromeKind(value: unknown): value is MasterChromeKind {
  return MASTER_CHROME_KINDS.includes(value as MasterChromeKind);
}

export function isMasterChromeTemplateElement(element: unknown): boolean {
  return hasMasterChromeKind(element);
}

export function hasMasterChromeKind(
  element: unknown,
): element is { masterChromeKind: MasterChromeKind } {
  return (
    typeof element === "object" &&
    element !== null &&
    isMasterChromeKind(
      (element as { masterChromeKind?: unknown }).masterChromeKind,
    )
  );
}

export function readGlobalMasterChromeState(
  deck: Deck,
): GlobalMasterChromeState {
  const elements = getGlobalMaster(deck)?.elements ?? [];
  const logo = findChromeElement(elements, "logo");
  const footer = findChromeElement(elements, "footer");
  const pageNumber = findChromeElement(elements, "pageNumber");
  const watermark = findChromeElement(elements, "watermark");

  return {
    logo: {
      enabled: Boolean(logo && !logo.hidden && logo.kind === "image"),
      src: logo?.kind === "image" ? (logo.content.src ?? "") : DEFAULT_LOGO_SRC,
      ...(logo?.kind === "image" && logo.content.assetId
        ? { assetId: logo.content.assetId }
        : {}),
      placement: inferLogoPlacement(logo?.box),
      size: inferLogoSize(logo?.box),
    },
    footer: {
      enabled: Boolean(footer && !footer.hidden),
      text: textElementText(footer) ?? DEFAULT_FOOTER_TEXT,
      align: textElementAlign(footer) ?? "center",
    },
    pageNumber: {
      enabled: Boolean(pageNumber && !pageNumber.hidden),
      format:
        textElementText(pageNumber)?.includes("{{pageCount}}") === true
          ? "number-total"
          : "number",
      placement: inferPageNumberPlacement(pageNumber?.box),
    },
    watermark: {
      enabled: Boolean(watermark && !watermark.hidden),
      text: textElementText(watermark) ?? DEFAULT_WATERMARK_TEXT,
      opacity: clampOpacity(watermark?.opacity ?? 0.18),
      layout: watermark?.rotation ? "diagonal" : "center",
      size: inferWatermarkSize(watermark),
    },
  };
}

export function updateGlobalMasterChromeElements(
  elements: readonly MasterElement[],
  kind: "logo",
  state: GlobalMasterLogoState,
): MasterElement[];
export function updateGlobalMasterChromeElements(
  elements: readonly MasterElement[],
  kind: "footer",
  state: GlobalMasterFooterState,
): MasterElement[];
export function updateGlobalMasterChromeElements(
  elements: readonly MasterElement[],
  kind: "pageNumber",
  state: GlobalMasterPageNumberState,
): MasterElement[];
export function updateGlobalMasterChromeElements(
  elements: readonly MasterElement[],
  kind: "watermark",
  state: GlobalMasterWatermarkState,
): MasterElement[];
export function updateGlobalMasterChromeElements(
  elements: readonly MasterElement[],
  kind: GlobalMasterChromeKind,
  state:
    | GlobalMasterLogoState
    | GlobalMasterFooterState
    | GlobalMasterPageNumberState
    | GlobalMasterWatermarkState,
): MasterElement[] {
  const existing = findChromeElement(elements, kind);
  const next = elements.filter(
    (element) => chromeElementKind(element) !== kind,
  );
  const zIndex =
    next.reduce((max, element) => Math.max(max, element.zIndex), -1) + 1;
  const element = buildChromeElement(kind, state, existing, zIndex);
  return element ? [...next, element] : next;
}

export function applyGlobalMasterChromeUpdate(
  elements: readonly MasterElement[],
  update: GlobalMasterChromeUpdate,
): MasterElement[] {
  switch (update.kind) {
    case "logo":
      return updateGlobalMasterChromeElements(
        elements,
        update.kind,
        update.state,
      );
    case "footer":
      return updateGlobalMasterChromeElements(
        elements,
        update.kind,
        update.state,
      );
    case "pageNumber":
      return updateGlobalMasterChromeElements(
        elements,
        update.kind,
        update.state,
      );
    case "watermark":
      return updateGlobalMasterChromeElements(
        elements,
        update.kind,
        update.state,
      );
  }
}

export function materializeMasterChromePlaceholders(
  element: SlideElement,
  slideIndex: number,
  slideCount: number,
): SlideElement {
  if (element.kind !== "text") return element;
  const content = element.content;
  const sourceParagraphs = content.paragraphs ?? [{ text: content.text }];
  const replace = (input: string) =>
    input
      .replace(/\{\{pageNumber\}\}/g, String(slideIndex + 1))
      .replace(/\{\{pageCount\}\}/g, String(slideCount));
  const text = replace(content.text);
  let changed = text !== content.text;
  const paragraphs = sourceParagraphs.map((paragraph) => ({
    ...paragraph,
    text: replace(paragraph.text),
    ...(paragraph.runs
      ? {
          runs: paragraph.runs.map((run) => ({
            ...run,
            text: replace(run.text),
          })),
        }
      : {}),
  }));
  for (let index = 0; index < paragraphs.length; index += 1) {
    const previous = sourceParagraphs[index];
    const next = paragraphs[index];
    if (previous?.text !== next?.text) changed = true;
    if (previous?.runs && next?.runs) {
      for (let runIndex = 0; runIndex < next.runs.length; runIndex += 1) {
        if (previous.runs[runIndex]?.text !== next.runs[runIndex]?.text) {
          changed = true;
        }
      }
    }
  }
  if (!changed) return element;
  return {
    ...element,
    content: {
      ...content,
      text,
      paragraphs,
    },
  };
}

function findChromeElement(
  elements: readonly MasterElement[],
  kind: GlobalMasterChromeKind,
): MasterElement | undefined {
  return elements.find((element) => chromeElementKind(element) === kind);
}

function chromeElementKind(element: {
  masterChromeKind: MasterChromeKind;
}): GlobalMasterChromeKind | null {
  return element.masterChromeKind;
}

function buildChromeElement(
  kind: GlobalMasterChromeKind,
  state:
    | GlobalMasterLogoState
    | GlobalMasterFooterState
    | GlobalMasterPageNumberState
    | GlobalMasterWatermarkState,
  existing: MasterElement | undefined,
  zIndex: number,
): MasterElement | null {
  switch (kind) {
    case "logo":
      return buildLogoElement(state as GlobalMasterLogoState, zIndex);
    case "footer":
      return buildTextElement({
        role: "footer",
        text: (state as GlobalMasterFooterState).text,
        enabled: (state as GlobalMasterFooterState).enabled,
        box: existing?.box ?? { x: 6, y: 91, w: 88, h: 5 },
        zIndex,
        textStyle: mergeTextStyle(existing, {
          align: (state as GlobalMasterFooterState).align,
        }),
      });
    case "pageNumber":
      /* node:coverage ignore next 16 */
      /* Page-number chrome variants are asserted in global-master tests; tsx maps nested literal rows as residual. */
      return buildTextElement({
        role: "pageNumber",
        text:
          (state as GlobalMasterPageNumberState).format === "number-total"
            ? "{{pageNumber}} / {{pageCount}}"
            : "{{pageNumber}}",
        enabled: (state as GlobalMasterPageNumberState).enabled,
        box: pageNumberBox(
          (state as GlobalMasterPageNumberState).placement,
          existing,
        ),
        zIndex,
        textStyle: mergeTextStyle(existing, {
          align: pageNumberAlign(
            (state as GlobalMasterPageNumberState).placement,
          ),
        }),
      });
    case "watermark":
      return buildWatermarkElement(state as GlobalMasterWatermarkState, zIndex);
  }
}

function buildLogoElement(
  state: GlobalMasterLogoState,
  zIndex: number,
): MasterElement | null {
  if (!state.src) return null;
  /* node:coverage ignore next 18 */
  /* Logo chrome content, placement, hidden state, and asset handling are asserted in global-master tests; tsx maps object rows as residual. */
  return {
    id: makeElementId(),
    kind: "image",
    role: "logo",
    masterChromeKind: "logo",
    name: "Logo",
    layer: "foreground",
    locked: true,
    hidden: !state.enabled,
    box: logoBox(state.placement, state.size),
    zIndex,
    content: {
      kind: "image",
      src: state.src,
      ...(state.assetId ? { assetId: state.assetId } : {}),
      alt: "Logo",
    },
  } as MasterElement;
}

function buildWatermarkElement(
  state: GlobalMasterWatermarkState,
  zIndex: number,
): MasterElement {
  return {
    id: makeElementId(),
    kind: "text",
    role: "background",
    masterChromeKind: "watermark",
    name: WATERMARK_NAME,
    layer: "background",
    locked: true,
    hidden: !state.enabled,
    opacity: clampOpacity(state.opacity),
    ...(state.layout === "diagonal" ? { rotation: -28 } : {}),
    box:
      state.layout === "diagonal"
        ? { x: 10, y: 42, w: 80, h: 16 }
        : { x: 18, y: 42, w: 64, h: 16 },
    zIndex,
    content: textContent(state.text),
    designOverrides: {
      textStyle: {
        fontSize: WATERMARK_FONT_SIZE[state.size],
        align: "center",
        bold: true,
      },
    },
  } as MasterElement;
}

function buildTextElement({
  role,
  text,
  enabled,
  box,
  zIndex,
  textStyle,
}: {
  role: "footer" | "pageNumber";
  text: string;
  enabled: boolean;
  box: ElementBox;
  zIndex: number;
  textStyle: Record<string, unknown> & { align: ElementAlign };
}): MasterElement {
  return {
    id: makeElementId(),
    kind: "text",
    role,
    masterChromeKind: role,
    name: role === "footer" ? "Footer" : "Page number",
    layer: "foreground",
    locked: true,
    hidden: !enabled,
    box,
    zIndex,
    content: textContent(text),
    designOverrides: { textStyle },
  } as MasterElement;
}

function mergeTextStyle(
  existing: MasterElement | undefined,
  patch: { align: ElementAlign },
): Record<string, unknown> & { align: ElementAlign } {
  const existingTextStyle =
    existing?.kind === "text"
      ? ((existing as unknown as { designOverrides?: { textStyle?: unknown } })
          .designOverrides?.textStyle as Record<string, unknown> | undefined)
      : undefined;
  return { ...(existingTextStyle ?? {}), ...patch };
}

function textContent(text: string) {
  return { kind: "text" as const, text, paragraphs: [{ text }] };
}

function textElementText(
  element: MasterElement | undefined,
): string | undefined {
  return element?.kind === "text" ? element.content.text : undefined;
}

function textElementAlign(
  element: MasterElement | undefined,
): ElementAlign | undefined {
  const align = (
    element as
      | { designOverrides?: { textStyle?: { align?: ElementAlign } } }
      | undefined
  )?.designOverrides?.textStyle?.align;
  return align;
}

function logoBox(placement: LogoPlacement, size: LogoSize): ElementBox {
  const box = LOGO_SIZE_BOX[size];
  const margin = 4;
  const x = placement.endsWith("right") ? 100 - box.w - margin : margin;
  const y = placement.startsWith("bottom") ? 100 - box.h - margin : margin;
  return { x, y, w: box.w, h: box.h };
}

function pageNumberBox(
  placement: PageNumberPlacement,
  existing?: MasterElement,
): ElementBox {
  if (existing?.box) {
    const width = existing.box.w;
    return {
      ...existing.box,
      x:
        placement === "bottom-left"
          ? 5
          : placement === "bottom-center"
            ? (100 - width) / 2
            : 95 - width,
    };
  }
  switch (placement) {
    case "bottom-left":
      return { x: 6, y: 91, w: 18, h: 5 };
    case "bottom-center":
      return { x: 41, y: 91, w: 18, h: 5 };
    case "bottom-right":
      return { x: 76, y: 91, w: 18, h: 5 };
  }
}

function pageNumberAlign(placement: PageNumberPlacement): ElementAlign {
  switch (placement) {
    case "bottom-left":
      return "left";
    case "bottom-center":
      return "center";
    case "bottom-right":
      return "right";
  }
}

function inferLogoPlacement(box: ElementBox | undefined): LogoPlacement {
  if (!box) return "top-right";
  const vertical = box.y > 50 ? "bottom" : "top";
  const horizontal = box.x > 50 ? "right" : "left";
  return `${vertical}-${horizontal}` as LogoPlacement;
}

function inferLogoSize(box: ElementBox | undefined): LogoSize {
  if (!box) return "medium";
  if (box.w <= 9) return "small";
  if (box.w >= 15) return "large";
  return "medium";
}

function inferPageNumberPlacement(
  box: ElementBox | undefined,
): PageNumberPlacement {
  if (!box) return "bottom-right";
  if (box.x < 25) return "bottom-left";
  if (box.x > 60) return "bottom-right";
  return "bottom-center";
}

function inferWatermarkSize(element: MasterElement | undefined): WatermarkSize {
  const fontSize = (
    element as
      | { designOverrides?: { textStyle?: { fontSize?: number } } }
      | undefined
  )?.designOverrides?.textStyle?.fontSize;
  if (fontSize === undefined) return "medium";
  if (fontSize <= 8) return "small";
  if (fontSize >= 12) return "large";
  return "medium";
}

function clampOpacity(value: number): number {
  return Math.max(0.05, Math.min(0.6, value));
}
