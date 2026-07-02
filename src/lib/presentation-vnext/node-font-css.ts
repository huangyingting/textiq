import type { CSSProperties } from "react";

import type { StyleObject, StylePatch } from "./style-schema";

type NodeTextStyle =
  | Pick<StyleObject, "text">
  | Pick<StylePatch, "text">
  | undefined;

function getTextDecoration(
  text: StyleObject["text"] | StylePatch["text"],
): string | undefined {
  const textDecoration = [
    text?.underline ? "underline" : undefined,
    text?.strikethrough ? "line-through" : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return textDecoration.length > 0 ? textDecoration : undefined;
}

function textVerticalAlignToJustifyContent(
  verticalAlign: NonNullable<StyleObject["text"]>["verticalAlign"],
): CSSProperties["justifyContent"] {
  if (verticalAlign === "middle") return "center";
  if (verticalAlign === "bottom") return "flex-end";
  return "flex-start";
}

/**
 * Resolves v7 node text style to CSS used by live inline text editing.
 *
 * The editor receives already-resolved render-tree style objects, so this
 * helper intentionally maps the resolved text style shape rather than looking
 * up theme tokens again.
 */
export function resolveNodeFontCss(style: NodeTextStyle): CSSProperties {
  const text = style?.text;
  if (!text) return {};
  const textDecoration = getTextDecoration(text);
  const paragraphSpacing =
    typeof text.paragraphSpacingPt === "number" && text.paragraphSpacingPt > 0
      ? `${text.paragraphSpacingPt}pt`
      : undefined;
  const needsTextLayout = text.verticalAlign !== undefined || paragraphSpacing;
  return {
    ...(typeof text.fontFamily === "string"
      ? { fontFamily: text.fontFamily }
      : {}),
    ...(typeof text.fontSizePt === "number"
      ? { fontSize: `${text.fontSizePt}pt` }
      : {}),
    ...(typeof text.weight === "number" ? { fontWeight: text.weight } : {}),
    ...(text.italic ? { fontStyle: "italic" } : {}),
    ...(textDecoration ? { textDecoration } : {}),
    ...(typeof text.color === "string" ? { color: text.color } : {}),
    ...(typeof text.lineHeight === "number"
      ? { lineHeight: text.lineHeight }
      : {}),
    ...(text.align ? { textAlign: text.align } : {}),
    ...(typeof text.letterSpacingEm === "number"
      ? { letterSpacing: `${text.letterSpacingEm}em` }
      : {}),
    ...(text.textTransform ? { textTransform: text.textTransform } : {}),
    ...(needsTextLayout
      ? {
          display: "flex",
          flexDirection: "column",
          justifyContent: textVerticalAlignToJustifyContent(text.verticalAlign),
        }
      : {}),
    ...(paragraphSpacing ? { rowGap: paragraphSpacing } : {}),
  };
}
