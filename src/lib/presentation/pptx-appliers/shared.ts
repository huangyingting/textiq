import type PptxGenJS from "pptxgenjs";
import type { PptxEffect } from "../pptx-export-adapter";

export type PptxSlide = ReturnType<PptxGenJS["addSlide"]>;
export type PptxCoord = number | `${number}%`;
export type PptxShadow = NonNullable<
  NonNullable<Parameters<PptxSlide["addShape"]>[1]>["shadow"]
>;

export function stripHash(color: string): string {
  return color.startsWith("#")
    ? color.slice(1).toUpperCase()
    : color.toUpperCase();
}

export function effectToPptxShadow(
  effect: PptxEffect | undefined,
): PptxShadow | undefined {
  if (!effect || effect.kind !== "glow") return undefined;
  return {
    type: "outer",
    color: effect.color,
    opacity: effect.opacity ?? 0.75,
    blur: effect.blurPt,
    angle: 0,
    offset: 0,
  };
}
