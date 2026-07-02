import type { ImageElement, VisualElement } from "@/lib/document/deck-model";
import { isEmptyImageSrc } from "@/lib/visual/image-element";
import type { PresentationTheme } from "@/lib/visual/presentation-theme";
import type { Visual } from "@/lib/visual/schema";
import { resolveVisualThemeBridge } from "@/lib/visual/presentation-visual-theme-bridge";
import { applyTheme } from "@/lib/visual/transforms";
import {
  isImageFallback,
  visualToNativeSpecs,
  type PptxSlideLayout,
} from "@/lib/visual/pptx-shapes";

/* node:coverage ignore next 8 -- OperationBox is an erased type facade; tsx maps the declaration as uncovered. @preserve */
interface OperationBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  shadow?: boolean;
  opacity?: number;
}

export function buildDeckImageOp(
  element: ImageElement,
  box: OperationBox,
  imageDefaults: PresentationTheme["image"] | undefined,
) {
  const { content } = element;
  const design = element.designOverrides ?? {};
  const designRadius =
    typeof design.radius === "number" ? design.radius : undefined;
  if (isEmptyImageSrc(content.src)) return null;

  return {
    kind: "image" as const,
    ...box,
    src: content.src,
    ...(content.alt ? { alt: content.alt } : {}),
    ...((design.fitMode ?? imageDefaults?.fitMode) !== undefined
      ? { fitMode: design.fitMode ?? imageDefaults?.fitMode }
      : {}),
    ...((design.maskShape ?? imageDefaults?.maskShape) !== undefined
      ? { maskShape: design.maskShape ?? imageDefaults?.maskShape }
      : {}),
    ...(content.crop !== undefined ? { crop: content.crop } : {}),
    ...((designRadius ?? imageDefaults?.radiusPct)
      ? {
          radius:
            ((designRadius ?? imageDefaults?.radiusPct ?? 0) / 100) *
            Math.min(box.w, box.h),
        }
      : {}),
  };
}

function layoutWithinBox(visual: Visual, box: OperationBox): PptxSlideLayout {
  const scale = Math.min(box.w / visual.width, box.h / visual.height);
  const usedW = visual.width * scale;
  const usedH = visual.height * scale;
  return {
    offsetX: box.x + (box.w - usedW) / 2,
    offsetY: box.y + (box.h - usedH) / 2,
    scale,
  };
}

export function buildDeckVisualOp(
  element: VisualElement,
  visual: Visual,
  box: OperationBox,
  visualDefaults: PresentationTheme["visual"] | undefined,
) {
  const bridge = resolveVisualThemeBridge(
    element.content.styleThemeId,
    visualDefaults,
  );
  const styled = bridge.styleThemeId
    ? applyTheme(visual, bridge.styleThemeId)
    : visual;
  const layout = layoutWithinBox(styled, box);
  const specs = visualToNativeSpecs(styled, layout);

  if (isImageFallback(specs) || box.rotation || box.shadow || box.opacity) {
    return {
      kind: "visual-fallback" as const,
      ...box,
      visualId: element.content.visualId,
    };
  }

  return { kind: "visual-native" as const, specs };
}
