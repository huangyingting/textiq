"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from "react";

import type { TextElement, TextFitMode } from "@/lib/presentation/deck";
import {
  resolvedFillToCss,
  type ResolvedElementDesign,
} from "@/lib/presentation/slide-render-model";
import { useSlideFontsReady } from "@/lib/presentation-shared/slide-font-loading";
import type { SlideThemeColors } from "@/lib/presentation/style-cascade";

import { boxStyle, renderRuns } from "./primitives";
import { textContent, textDesign } from "./v6-model";

type ResolvedTextDesign = Extract<ResolvedElementDesign, { kind: "text" }>;

/**
 * Computes a CSS `font-size` string that shrinks the font until the content
 * fits within the container when `fitMode === "shrink-to-fit"`.
 *
 * Uses the "adjust state during render" pattern (React docs) to reset the
 * scale on config changes — this avoids `setState` inside an effect body and
 * satisfies the `react-hooks/set-state-in-effect` lint rule.
 *
 * The measurement loop runs whenever `scale` or `enabled` changes and
 * converges in ≤ 3 renders: reducing the font always reduces `scrollHeight`,
 * and the `Math.abs` guard prevents spurious updates once settled.
 */
function useShrinkFontSizeCss(
  containerRef: RefObject<HTMLElement | null>,
  baseFontSize: number,
  fitMode: TextFitMode | undefined,
): string {
  const enabled = fitMode === "shrink-to-fit";
  // Re-key on font readiness so the fit measurement re-runs against real
  // self-hosted font metrics once the bundled fonts load (avoids measuring
  // shrink scale with a fallback font and keeping the wrong size).
  const fontsReady = useSlideFontsReady();
  const configKey = `${baseFontSize}:${fitMode ?? ""}:${fontsReady ? 1 : 0}`;
  const [sizing, setSizing] = useState({ key: configKey, scale: 1 });
  const scale = sizing.key === configKey ? sizing.scale : 1;

  if (sizing.key !== configKey) {
    setSizing({ key: configKey, scale: 1 });
  }

  useLayoutEffect(() => {
    if (!enabled) return;
    const node = containerRef.current;
    if (!node) return;
    const overflows =
      node.scrollHeight > node.clientHeight + 1 ||
      node.scrollWidth > node.clientWidth + 1;
    if (!overflows || scale <= 0.55) return;
    const nextScale = Math.max(0.55, scale * 0.88);
    setSizing((current) =>
      current.key === configKey && Math.abs(current.scale - nextScale) > 0.001
        ? { ...current, scale: nextScale }
        : current,
    );
  }, [configKey, containerRef, enabled, scale]);

  return `${baseFontSize * (enabled ? scale : 1)}cqh`;
}

export function TextElementView({
  element,
  tc,
  accent,
  resolvedDesign,
}: {
  element: TextElement;
  tc: SlideThemeColors;
  accent?: string;
  resolvedDesign?: ResolvedTextDesign;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const content = textContent(element);
  const design = textDesign(element);
  const paragraphs = content.paragraphs;
  const hasListParagraphs = paragraphs.some(
    (paragraph) => paragraph.listType !== undefined,
  );
  const textStyle = resolvedDesign?.textStyle;
  const fontSize = textStyle?.fontSize ?? design.fontSize ?? 4.5;
  const fontSizeCss = useShrinkFontSizeCss(
    containerRef,
    fontSize,
    content.fitMode,
  );
  // Resolve color + font from the element's semantic role token; local
  // designOverrides.textStyle values still win.
  void tc;
  const color = textStyle?.color ?? design.color ?? tc.bodyColor;
  const markerColor = accent ?? color;
  const roleFontFamily = textStyle?.fontFamily;
  const align = textStyle?.align ?? design.align ?? "left";
  const verticalAlign = design.verticalAlign;
  const bold = textStyle ? textStyle.weight >= 600 : (design.bold ?? false);
  const italic = textStyle?.italic ?? design.italic ?? false;
  const underline = textStyle?.underline ?? design.underline ?? false;
  const lineHeight = textStyle?.lineHeight ?? design.lineHeight;
  const paragraphSpacing =
    textStyle?.paragraphSpacing ?? design.paragraphSpacing;
  const textFill = resolvedDesign?.textFill;
  const paintStyle = textFill
    ? {
        background: resolvedFillToCss(textFill),
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
      }
    : { color };

  if (hasListParagraphs) {
    const numbers: (number | null)[] = [];
    const counters = new Array(6).fill(0) as number[];
    for (const paragraph of paragraphs) {
      const indent = paragraph.indent ?? 0;
      const listType = paragraph.listType ?? "bullet";
      if (listType === "number") {
        for (let depth = indent + 1; depth < 6; depth++) counters[depth] = 0;
        counters[indent]++;
        numbers.push(counters[indent]);
      } else {
        for (let depth = indent; depth < 6; depth++) counters[depth] = 0;
        numbers.push(null);
      }
    }

    function bulletMarker(indent: number): string {
      if (indent === 0) return "•";
      if (indent === 1) return "◦";
      return "–";
    }

    return (
      <div
        ref={containerRef}
        style={{
          ...boxStyle(element),
          display: "flex",
          flexDirection: "column",
          justifyContent:
            verticalAlign === "top"
              ? "flex-start"
              : verticalAlign === "bottom"
                ? "flex-end"
                : "center",
          ...paintStyle,
          fontSize: fontSizeCss,
          fontWeight: bold ? 700 : 400,
          fontStyle: italic ? "italic" : "normal",
          ...(underline ? { textDecoration: "underline" } : {}),
          ...(roleFontFamily ? { fontFamily: roleFontFamily } : {}),
          ...(textStyle?.letterSpacing !== undefined
            ? { letterSpacing: `${textStyle.letterSpacing}em` }
            : {}),
          ...(textStyle?.textTransform
            ? { textTransform: textStyle.textTransform }
            : {}),
          textAlign: align,
          lineHeight: lineHeight ?? 1.2,
          overflow: "hidden",
        }}
      >
        <ul
          style={{
            display: "flex",
            flexDirection: "column",
            gap: content.bulletGap ? `${content.bulletGap}cqh` : "0.6em",
            margin: 0,
            padding: 0,
            listStyle: "none",
            ...(content.bulletIndent
              ? { paddingLeft: `${content.bulletIndent}cqw` }
              : {}),
          }}
        >
          {paragraphs.map((paragraph, index) => {
            const indent = paragraph.indent ?? 0;
            const listType = paragraph.listType ?? "bullet";
            const number = numbers[index];
            const indentEm = indent * 1.5;
            return (
              <li
                key={index}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.5em",
                  paddingLeft: indentEm > 0 ? `${indentEm}em` : undefined,
                }}
              >
                {listType === "number" ? (
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      color: markerColor,
                      minWidth: "1.2em",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {number}.
                  </span>
                ) : (
                  <span
                    aria-hidden="true"
                    style={
                      indent === 0
                        ? {
                            marginTop: "0.45em",
                            height: "0.35em",
                            width: "0.35em",
                            flexShrink: 0,
                            borderRadius: "9999px",
                            backgroundColor: markerColor,
                          }
                        : {
                            flexShrink: 0,
                            color: markerColor,
                            minWidth: "0.8em",
                            lineHeight: 1,
                          }
                    }
                  >
                    {indent === 0 ? null : bulletMarker(indent)}
                  </span>
                )}
                <span
                  style={{
                    minWidth: 0,
                    overflowWrap: "break-word",
                    wordBreak: "normal",
                  }}
                >
                  {paragraph.runs && paragraph.runs.length > 0
                    ? renderRuns(paragraph.runs)
                    : paragraph.text || "\u00a0"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        ...boxStyle(element),
        display: "flex",
        flexDirection: "column",
        justifyContent:
          verticalAlign === "top"
            ? "flex-start"
            : verticalAlign === "bottom"
              ? "flex-end"
              : "center",
        textAlign: align,
        ...paintStyle,
        fontSize: fontSizeCss,
        fontWeight: bold ? 700 : 400,
        fontStyle: italic ? "italic" : "normal",
        ...(underline ? { textDecoration: "underline" } : {}),
        ...(roleFontFamily ? { fontFamily: roleFontFamily } : {}),
        ...(textStyle?.letterSpacing !== undefined
          ? { letterSpacing: `${textStyle.letterSpacing}em` }
          : {}),
        ...(textStyle?.textTransform
          ? { textTransform: textStyle.textTransform }
          : {}),
        lineHeight: lineHeight ?? 1.15,
        overflow: "hidden",
      }}
    >
      {paragraphs.map((paragraph, index) => (
        <div
          key={index}
          style={{
            width: "100%",
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
            wordBreak: "normal",
            ...(paragraphSpacing && index < paragraphs.length - 1
              ? { marginBottom: `${paragraphSpacing}cqh` }
              : {}),
          }}
        >
          {paragraph.runs && paragraph.runs.length > 0
            ? renderRuns(paragraph.runs)
            : paragraph.text || "\u00a0"}
        </div>
      ))}
    </div>
  );
}
