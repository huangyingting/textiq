import type { Deck, SlideNode } from "../schema";
import type { ThemePackageV1 } from "../theme-package-schema";
import type { ResolvedRenderNode } from "../render-tree";
import { DiagnosticCollector } from "../diagnostics";
import { resolveLayoutFramePass } from "./layout-pass";

// Decoration resolver
// ---------------------------------------------------------------------------

const DECORATION_VISIBILITY_RANK: Record<string, number> = {
  subtle: 1,
  default: 2,
  expressive: 3,
};

const DECORATION_LEVEL_RANK: Record<string, number> = {
  none: 0,
  subtle: 1,
  default: 2,
  expressive: 3,
};

export function resolveDecorationsPass(
  slide: SlideNode,
  pkg: ThemePackageV1,
  deck: Deck,
  dc: DiagnosticCollector,
  canvasWidthPx = 960,
  canvasHeightPx = 540,
): ResolvedRenderNode[] {
  const disabledIds = new Set(deck.theme.overrides?.disabledDecorations ?? []);
  if (!pkg.decorations) {
    for (const decorationId of disabledIds) {
      dc.warning(
        "missing-decoration",
        `Theme override disables missing decoration "${decorationId}"`,
        {
          slideId: slide.id,
          path: `theme.overrides.disabledDecorations.${decorationId}`,
          action: {
            type: "restore-decoration",
            payload: { decorationId },
          },
          details: {
            decorationId,
            themePackageId: pkg.id,
          },
        },
      );
    }
    return [];
  }

  for (const decorationId of disabledIds) {
    if (!pkg.decorations[decorationId]) {
      dc.warning(
        "missing-decoration",
        `Theme override disables missing decoration "${decorationId}"`,
        {
          slideId: slide.id,
          path: `theme.overrides.disabledDecorations.${decorationId}`,
          action: {
            type: "restore-decoration",
            payload: { decorationId },
          },
          details: {
            decorationId,
            themePackageId: pkg.id,
          },
        },
      );
    }
  }

  const decorationLevel = slide.props?.decoration ?? "default";
  const chromeLevel = slide.props?.chrome ?? "default";

  const result: ResolvedRenderNode[] = [];

  for (const recipe of Object.values(pkg.decorations)) {
    if (disabledIds.has(recipe.id)) continue;

    if (
      recipe.appliesTo?.templateKinds &&
      !recipe.appliesTo.templateKinds.includes(slide.template.kind)
    ) {
      continue;
    }
    if (
      recipe.appliesTo?.layoutIds &&
      (slide.template.layoutId === undefined ||
        !recipe.appliesTo.layoutIds.includes(slide.template.layoutId))
    ) {
      continue;
    }

    // Filter by visibility level
    if (recipe.visibility) {
      const recipeRank = DECORATION_VISIBILITY_RANK[recipe.visibility] ?? 2;
      const slideRank = DECORATION_LEVEL_RANK[decorationLevel] ?? 2;
      if (recipeRank > slideRank) continue;
    }

    // Filter by chrome level
    if (
      recipe.chrome &&
      recipe.chrome === "minimal" &&
      chromeLevel === "none"
    ) {
      continue;
    }

    if (
      recipe.component === "image" &&
      recipe.content?.type === "image" &&
      !deck.assets.images[recipe.content.assetId] &&
      !pkg.assets?.images?.[recipe.content.assetId]
    ) {
      dc.error(
        "missing-decoration",
        `Theme decoration "${recipe.id}" references missing image asset "${recipe.content.assetId}"`,
        {
          slideId: slide.id,
          path: `decorations.${recipe.id}.content.assetId`,
          details: {
            decorationId: recipe.id,
            assetId: recipe.content.assetId,
            themePackageId: pkg.id,
          },
        },
      );
    }

    result.push({
      id: `decoration-${recipe.id}`,
      type:
        recipe.component === "image"
          ? "image"
          : recipe.component === "text"
            ? "text"
            : "shape",
      role: "themeDecoration",
      layout: resolveLayoutFramePass(
        recipe.layout,
        canvasWidthPx,
        canvasHeightPx,
      ),
      style: recipe.style,
      content:
        recipe.component === "text" && recipe.content?.type === "text"
          ? {
              type: "text",
              content: {
                paragraphs: [
                  {
                    id: `decoration-${recipe.id}-p0`,
                    text: recipe.content.text,
                  },
                ],
              },
            }
          : recipe.component === "image" && recipe.content?.type === "image"
            ? {
                type: "image",
                content: { assetId: recipe.content.assetId },
              }
            : { type: "shape", content: { shape: "rect" as const } },
      source: "themeDecoration",
    });
  }

  return result;
}
