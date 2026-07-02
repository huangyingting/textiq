import type { VnextPptxVisualOp } from "../pptx-export-adapter";
import { DEFAULT_VISUAL_CHANNEL_COLORS } from "../visual-channel-colors";
import { applyVnextImageOp } from "./image-media-applier";
import type { PptxSlide } from "./shared";
import { effectToPptxShadow, stripHash } from "./shared";

export async function applyVnextVisualOp(
  slide: PptxSlide,
  op: VnextPptxVisualOp,
): Promise<void> {
  const { x, y, w, h, assetId, alt, visualId, rotation } = op;
  if (assetId) {
    await applyVnextImageOp(slide, {
      type: "image",
      id: op.id,
      assetId,
      x,
      y,
      w,
      h,
      ...((alt ?? visualId) ? { alt: alt ?? visualId } : {}),
      ...(rotation !== undefined ? { rotation } : {}),
      ...(op.effect !== undefined ? { effect: op.effect } : {}),
      zIndex: op.zIndex,
    });
    return;
  }

  const hasVisualPlaceholderStyling =
    op.channelColors !== undefined || op.transparentBackground !== undefined;
  const shadow = effectToPptxShadow(op.effect);
  if (hasVisualPlaceholderStyling) {
    const colors = {
      ...DEFAULT_VISUAL_CHANNEL_COLORS,
      ...op.channelColors,
    };
    const backgroundFill = op.transparentBackground
      ? undefined
      : { color: stripHash(colors.muted), transparency: 85 };
    slide.addShape("rect" as Parameters<PptxSlide["addShape"]>[0], {
      x,
      y,
      w,
      h,
      ...(backgroundFill ? { fill: backgroundFill } : {}),
      line: { color: stripHash(colors.muted), transparency: 35 },
      ...(rotation !== undefined ? { rotate: rotation } : {}),
      ...(shadow !== undefined ? { shadow } : {}),
    });
    const barW = w * 0.16;
    const baseY = y + h * 0.72;
    const bars = [
      { color: colors.primary, height: h * 0.42, offset: 0.18 },
      { color: colors.secondary, height: h * 0.3, offset: 0.4 },
      { color: colors.accent, height: h * 0.54, offset: 0.62 },
    ];
    for (const bar of bars) {
      slide.addShape("rect" as Parameters<PptxSlide["addShape"]>[0], {
        x: x + w * bar.offset,
        y: baseY - bar.height,
        w: barW,
        h: bar.height,
        fill: { color: stripHash(bar.color) },
        line: { color: stripHash(bar.color), transparency: 100 },
        ...(rotation !== undefined ? { rotate: rotation } : {}),
        ...(shadow !== undefined ? { shadow } : {}),
      });
    }
    slide.addText(op.alt ?? op.visualId ?? "Visual", {
      x: x + w * 0.12,
      y: y + h * 0.08,
      w: w * 0.76,
      h: h * 0.18,
      fontSize: Math.max(8, Math.min(14, h * 5)),
      color: stripHash(colors.primary),
      bold: true,
      align: "center",
      ...(rotation !== undefined ? { rotate: rotation } : {}),
    });
    return;
  }

  slide.addShape("rect" as Parameters<PptxSlide["addShape"]>[0], {
    x,
    y,
    w,
    h,
    fill: { color: op.fill ?? "F8FAFC" },
    line: {
      color: op.stroke?.color ?? "CBD5E1",
      width: op.stroke?.widthPt ?? 1,
      dashType: "dash",
    },
    ...(rotation !== undefined ? { rotate: rotation } : {}),
  });

  const label = op.fallbackLabel ?? alt ?? visualId ?? "Visual unavailable";
  slide.addText(label, {
    x: x + w * 0.05,
    y: y + h * 0.35,
    w: w * 0.9,
    h: h * 0.3,
    fontSize: 12,
    color: "475569",
    align: "center",
    valign: "middle",
    wrap: true,
    ...(rotation !== undefined ? { rotate: rotation } : {}),
  });
}
