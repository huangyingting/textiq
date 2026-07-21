import type {
  DeckChromeBorder,
  DeckChromeConfig,
  DeckChromeFooter,
  DeckChromeKind,
  DeckChromeLogo,
  DeckChromePageNumber,
  DeckChromeSafeArea,
  DeckChromeWatermark,
  Deck,
  LayoutBox,
  SlideProps,
  SlideNode,
  TextContent,
} from "../schema";
import type { ThemePackageV1 } from "../theme-package-schema";
import type { ResolvedRenderNode } from "../render-tree";
import { resolveTheme, resolveTokensInStyle } from "../style-resolver";
import { DiagnosticCollector } from "../diagnostics";
import type { StyleObject, StylePatch } from "../style-schema";
import { resolveLayoutFramePass } from "./layout-pass";

// Deck chrome resolver
// ---------------------------------------------------------------------------

const DECK_CHROME_KINDS: DeckChromeKind[] = [
  "logo",
  "watermark",
  "border",
  "safeArea",
  "footer",
  "pageNumber",
];

const LOGO_SIZE_FRAME: Record<
  NonNullable<DeckChromeLogo["size"]>,
  { w: number; h: number }
> = {
  small: { w: 8, h: 5 },
  medium: { w: 12, h: 7 },
  large: { w: 16, h: 9 },
};

const WATERMARK_FONT_SIZE: Record<
  NonNullable<DeckChromeWatermark["size"]>,
  number
> = {
  small: 28,
  medium: 40,
  large: 54,
};

function mergeStylePatch(
  base: StylePatch = {},
  patch?: StylePatch,
): StyleObject {
  if (!patch) return base as StyleObject;
  const result: StyleObject = { ...(base as StyleObject) };
  for (const key of Object.keys(patch) as (keyof StylePatch)[]) {
    const patchValue = patch[key];
    if (patchValue === undefined) continue;
    const baseValue = base[key];
    if (
      typeof baseValue === "object" &&
      baseValue !== null &&
      !Array.isArray(baseValue) &&
      typeof patchValue === "object" &&
      patchValue !== null &&
      !Array.isArray(patchValue)
    ) {
      (result as Record<string, unknown>)[key] = {
        ...(baseValue as Record<string, unknown>),
        ...(patchValue as Record<string, unknown>),
      };
    } else {
      (result as Record<string, unknown>)[key] = patchValue;
    }
  }
  return result;
}

function mergeChromeItem<T extends { style?: StylePatch }>(
  base: T | undefined,
  patch: Partial<T> | undefined,
): T | undefined {
  if (!base && !patch) return undefined;
  return {
    ...(base ?? ({} as T)),
    ...(patch ?? {}),
    style: mergeStylePatch(base?.style, patch?.style),
  } as T;
}

function mergeChromeConfig(
  base: Partial<DeckChromeConfig> | undefined,
  patch: Partial<DeckChromeConfig> | undefined,
): Partial<DeckChromeConfig> {
  if (!base) return patch ?? {};
  if (!patch) return base;
  return {
    logo: mergeChromeItem(base.logo, patch.logo),
    footer: mergeChromeItem(base.footer, patch.footer),
    pageNumber: mergeChromeItem(base.pageNumber, patch.pageNumber),
    watermark: mergeChromeItem(base.watermark, patch.watermark),
    border: mergeChromeItem(base.border, patch.border),
    safeArea: mergeChromeItem(base.safeArea, patch.safeArea),
  };
}

function baseDeckChromeConfig(
  deck: Deck,
  pkg: ThemePackageV1,
): Partial<DeckChromeConfig> {
  return mergeChromeConfig(
    mergeChromeConfig(pkg.chrome, deck.theme.overrides?.chrome),
    deck.chrome,
  );
}

function slideChromeItem<T extends { style?: StylePatch }>(
  base: T | undefined,
  override:
    | { mode: "inherit" }
    | { mode: "disabled" }
    | { mode: "detached"; nodeId?: string }
    | { mode: "override"; value: Partial<T> }
    | undefined,
): T | null | undefined {
  if (override?.mode === "disabled" || override?.mode === "detached") {
    return null;
  }
  if (override?.mode === "override") {
    return mergeChromeItem(base, override.value);
  }
  return base;
}

function logoFrame(item: DeckChromeLogo): LayoutBox {
  if (item.layout) return item.layout;
  const size = item.size ?? "medium";
  const placement = item.placement ?? "top-right";
  const box = LOGO_SIZE_FRAME[size] ?? LOGO_SIZE_FRAME.medium;
  const margin = 4;
  return {
    frame: {
      x: placement.endsWith("right") ? 100 - box.w - margin : margin,
      y: placement.startsWith("bottom") ? 100 - box.h - margin : margin,
      w: box.w,
      h: box.h,
    },
    zIndex: 920,
  };
}

function footerFrame(item: DeckChromeFooter): LayoutBox {
  return (
    item.layout ?? {
      frame: { x: 6, y: 91, w: 88, h: 5 },
      zIndex: 900,
    }
  );
}

function pageNumberFrame(item: DeckChromePageNumber): LayoutBox {
  if (item.layout) return item.layout;
  const placement = item.placement ?? "bottom-right";
  const width = 18;
  return {
    frame: {
      x:
        placement === "bottom-left"
          ? 6
          : placement === "bottom-center"
            ? (100 - width) / 2
            : 94 - width,
      y: 91,
      w: width,
      h: 5,
    },
    zIndex: 910,
  };
}

function watermarkFrame(item: DeckChromeWatermark): LayoutBox {
  if (item.layout) return item.layout;
  return {
    frame:
      item.layoutMode === "diagonal"
        ? { x: 10, y: 42, w: 80, h: 16 }
        : { x: 18, y: 42, w: 64, h: 16 },
    rotation: item.layoutMode === "diagonal" ? -28 : undefined,
    zIndex: -20,
  };
}

function borderFrame(item: DeckChromeBorder): LayoutBox {
  return (
    item.layout ?? {
      frame: { x: 1, y: 1, w: 98, h: 98 },
      zIndex: 930,
    }
  );
}

function safeAreaFrame(item: DeckChromeSafeArea, deck: Deck): LayoutBox {
  if (item.layout) return item.layout;
  const insets = item.insets ??
    deck.canvas.safeArea ?? { top: 6, right: 6, bottom: 6, left: 6 };
  return {
    frame: {
      x: insets.left,
      y: insets.top,
      w: Math.max(0.1, 100 - insets.left - insets.right),
      h: Math.max(0.1, 100 - insets.top - insets.bottom),
    },
    zIndex: 940,
  };
}

function textContent(id: string, text: string): TextContent {
  return { paragraphs: [{ id: `${id}-p0`, text }] };
}

function pageNumberText(
  item: DeckChromePageNumber,
  slideIndex: number,
  slideCount: number,
): string {
  return item.format === "number-total"
    ? `${slideIndex + 1} / ${slideCount}`
    : String(slideIndex + 1);
}

function pageNumberAlign(
  placement: DeckChromePageNumber["placement"],
): "left" | "center" | "right" {
  if (placement === "bottom-left") return "left";
  if (placement === "bottom-center") return "center";
  return "right";
}

function shouldRenderChromeKind(
  kind: DeckChromeKind,
  chromeLevel: SlideProps["chrome"] | undefined,
): boolean {
  if (chromeLevel === "none") return false;
  if (chromeLevel === "minimal") {
    return kind === "logo" || kind === "border" || kind === "safeArea";
  }
  return true;
}

function resolvedChromeLayout(
  layout: LayoutBox,
  canvasWidthPx: number,
  canvasHeightPx: number,
) {
  return resolveLayoutFramePass(layout, canvasWidthPx, canvasHeightPx);
}

function resolveChromeStyle(
  style: StyleObject,
  deck: Deck,
  pkg: ThemePackageV1,
  dc: DiagnosticCollector,
  ctx: string,
): StyleObject {
  return resolveTokensInStyle(
    style,
    resolveTheme(pkg, deck.theme).tokens,
    dc,
    ctx,
  );
}

export function resolveDeckChromePass(
  slide: SlideNode,
  deck: Deck,
  pkg: ThemePackageV1,
  slideIndex: number,
  slideCount: number,
  dc: DiagnosticCollector,
  canvasWidthPx = 960,
  canvasHeightPx = 540,
): ResolvedRenderNode[] {
  const base = baseDeckChromeConfig(deck, pkg);
  const overrides = slide.props?.deckChrome;
  const chromeLevel = slide.props?.chrome ?? "default";
  const result: ResolvedRenderNode[] = [];

  for (const kind of DECK_CHROME_KINDS) {
    if (!shouldRenderChromeKind(kind, chromeLevel)) continue;

    if (kind === "logo") {
      const item = slideChromeItem(base.logo, overrides?.logo);
      if (!item || item.enabled === false || !item.assetId) continue;
      const id = "deck-chrome-logo";
      if (
        item.assetId !== "placeholder" &&
        !deck.assets.images[item.assetId] &&
        !pkg.assets?.images?.[item.assetId]
      ) {
        dc.error(
          "missing-asset",
          `Deck chrome logo references missing asset "${item.assetId}"`,
          {
            nodeId: id,
            slideId: slide.id,
            action: { type: "open-asset-panel" },
            details: { assetId: item.assetId },
          },
        );
      }
      result.push({
        id,
        type: "image",
        role: "image",
        layout: resolvedChromeLayout(
          logoFrame(item),
          canvasWidthPx,
          canvasHeightPx,
        ),
        style: resolveChromeStyle(
          mergeStylePatch({ image: { fit: "contain" } }, item.style),
          deck,
          pkg,
          dc,
          "chrome.logo.style",
        ),
        content: {
          type: "image",
          content: {
            assetId: item.assetId,
            alt: item.alt ?? "Deck logo",
            fit: "contain",
          },
        },
        source: "deckChrome",
        chromeKind: "logo",
        locked: true,
      });
      continue;
    }

    if (kind === "footer") {
      const item = slideChromeItem(base.footer, overrides?.footer);
      if (!item || item.enabled === false || !item.text) continue;
      const id = "deck-chrome-footer";
      const align = item.align ?? "center";
      result.push({
        id,
        type: "text",
        role: "caption",
        layout: resolvedChromeLayout(
          footerFrame(item),
          canvasWidthPx,
          canvasHeightPx,
        ),
        style: resolveChromeStyle(
          mergeStylePatch(
            {
              text: {
                fontSizePt: 9,
                color: "#64748b",
                align,
                verticalAlign: "middle",
              },
            },
            item.style,
          ),
          deck,
          pkg,
          dc,
          "chrome.footer.style",
        ),
        content: { type: "text", content: textContent(id, item.text) },
        source: "deckChrome",
        chromeKind: "footer",
        locked: true,
      });
      continue;
    }

    if (kind === "pageNumber") {
      const item = slideChromeItem(base.pageNumber, overrides?.pageNumber);
      if (!item || item.enabled === false) continue;
      const id = "deck-chrome-pageNumber";
      result.push({
        id,
        type: "text",
        role: "caption",
        layout: resolvedChromeLayout(
          pageNumberFrame(item),
          canvasWidthPx,
          canvasHeightPx,
        ),
        style: resolveChromeStyle(
          mergeStylePatch(
            {
              text: {
                fontSizePt: 9,
                color: "#64748b",
                align: pageNumberAlign(item.placement),
                verticalAlign: "middle",
              },
            },
            item.style,
          ),
          deck,
          pkg,
          dc,
          "chrome.pageNumber.style",
        ),
        content: {
          type: "text",
          content: textContent(
            id,
            pageNumberText(item, slideIndex, slideCount),
          ),
        },
        source: "deckChrome",
        chromeKind: "pageNumber",
        locked: true,
      });
      continue;
    }

    if (kind === "watermark") {
      const item = slideChromeItem(base.watermark, overrides?.watermark);
      if (!item || item.enabled === false || !item.text) continue;
      const id = "deck-chrome-watermark";
      const size = item.size ?? "medium";
      const fontSize = WATERMARK_FONT_SIZE[size] ?? WATERMARK_FONT_SIZE.medium;
      result.push({
        id,
        type: "text",
        role: "background",
        layout: resolvedChromeLayout(
          watermarkFrame(item),
          canvasWidthPx,
          canvasHeightPx,
        ),
        style: resolveChromeStyle(
          mergeStylePatch(
            {
              text: {
                fontSizePt: fontSize,
                color: "#64748b",
                weight: 700,
                align: "center",
                verticalAlign: "middle",
              },
              opacity: item.opacity ?? 0.18,
            },
            item.style,
          ),
          deck,
          pkg,
          dc,
          "chrome.watermark.style",
        ),
        content: { type: "text", content: textContent(id, item.text) },
        source: "deckChrome",
        chromeKind: "watermark",
        locked: true,
      });
      continue;
    }

    if (kind === "border") {
      const item = slideChromeItem(base.border, overrides?.border);
      if (!item || item.enabled === false) continue;
      result.push({
        id: "deck-chrome-border",
        type: "shape",
        role: "background",
        layout: resolvedChromeLayout(
          borderFrame(item),
          canvasWidthPx,
          canvasHeightPx,
        ),
        style: resolveChromeStyle(
          mergeStylePatch(
            {
              stroke: {
                color: item.color ?? "#cbd5e1",
                widthPt: item.widthPt ?? 1,
              },
            },
            item.style,
          ),
          deck,
          pkg,
          dc,
          "chrome.border.style",
        ),
        content: { type: "shape", content: { shape: "rect" as const } },
        source: "deckChrome",
        chromeKind: "border",
        locked: true,
      });
      continue;
    }

    const item = slideChromeItem(base.safeArea, overrides?.safeArea);
    if (!item || item.enabled === false) continue;
    result.push({
      id: "deck-chrome-safeArea",
      type: "shape",
      role: "background",
      layout: resolvedChromeLayout(
        safeAreaFrame(item, deck),
        canvasWidthPx,
        canvasHeightPx,
      ),
      style: resolveChromeStyle(
        mergeStylePatch(
          {
            stroke: {
              color: item.color ?? "#94a3b8",
              widthPt: item.widthPt ?? 0.75,
              dash: "dashed",
            },
            opacity: 0.5,
          },
          item.style,
        ),
        deck,
        pkg,
        dc,
        "chrome.safeArea.style",
      ),
      content: { type: "shape", content: { shape: "rect" as const } },
      source: "deckChrome",
      chromeKind: "safeArea",
      locked: true,
    });
  }

  return result;
}
