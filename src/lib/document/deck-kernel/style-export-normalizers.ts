/**
 * Pure adapter helpers that keep renderer and export style interpretation in
 * parity without coupling style-cascade to React, DOM, or PPTX libraries.
 */

import type { Deck } from "./deck-core";
import type { ElementAlign, ShapeElement, TextElement } from "./deck-elements";
import {
  resolveShapeLabelStyle,
  resolveTextElementStyle,
  type ResolvedTextStyle,
} from "./style-cascade";
import { slideFontExportFace } from "./slide-fonts";
import { slideHeightPctToPoints, type ExportPoints } from "./style-units";

export interface RendererTextStyleAdapter {
  color: string;
  fontFamily: string;
  fontSizeCqh: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  underline: boolean;
  align: ElementAlign;
  lineHeight?: number;
  paragraphSpacingCqh?: number;
  resolved: ResolvedTextStyle;
}

export interface ExportTextStyleAdapter {
  color: string;
  fontFace?: string;
  fontSizePt: ExportPoints;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: ElementAlign;
  lineHeight?: number;
  paragraphSpacingPt?: ExportPoints;
  resolved: ResolvedTextStyle;
}

function rendererFromResolved(
  resolved: ResolvedTextStyle,
): RendererTextStyleAdapter {
  return {
    color: resolved.color,
    fontFamily: resolved.fontFamily,
    fontSizeCqh: resolved.fontSize,
    fontWeight: resolved.weight,
    fontStyle: resolved.italic ? "italic" : "normal",
    underline: resolved.underline,
    align: resolved.align,
    ...(resolved.lineHeight !== undefined
      ? { lineHeight: resolved.lineHeight }
      : {}),
    ...(resolved.paragraphSpacing !== undefined
      ? { paragraphSpacingCqh: resolved.paragraphSpacing }
      : {}),
    resolved,
  };
}

function exportFromResolved(
  resolved: ResolvedTextStyle,
  slideHeightPt: number,
): ExportTextStyleAdapter {
  const fontFace = slideFontExportFace(resolved.fontFamily);
  return {
    color: resolved.color,
    ...(fontFace ? { fontFace } : {}),
    fontSizePt: slideHeightPctToPoints(resolved.fontSize, slideHeightPt),
    bold: resolved.weight >= 600,
    italic: resolved.italic,
    underline: resolved.underline,
    align: resolved.align,
    ...(resolved.lineHeight !== undefined
      ? { lineHeight: resolved.lineHeight }
      : {}),
    ...(resolved.paragraphSpacing !== undefined
      ? {
          paragraphSpacingPt: slideHeightPctToPoints(
            resolved.paragraphSpacing,
            slideHeightPt,
          ),
        }
      : {}),
    resolved,
  };
}

export function adaptTextElementForRenderer(
  deck: Deck,
  element: TextElement,
): RendererTextStyleAdapter {
  return rendererFromResolved(resolveTextElementStyle(deck, element));
}

export function adaptTextElementForExport(
  deck: Deck,
  element: TextElement,
  slideHeightPt: number,
): ExportTextStyleAdapter {
  return exportFromResolved(
    resolveTextElementStyle(deck, element),
    slideHeightPt,
  );
}

export function adaptShapeLabelForRenderer(
  deck: Deck,
  element: ShapeElement,
): RendererTextStyleAdapter {
  return rendererFromResolved(resolveShapeLabelStyle(deck, element));
}

export function adaptShapeLabelForExport(
  deck: Deck,
  element: ShapeElement,
  slideHeightPt: number,
): ExportTextStyleAdapter {
  return exportFromResolved(
    resolveShapeLabelStyle(deck, element),
    slideHeightPt,
  );
}
