import type { CSSProperties } from "react";

import type { FillStyle } from "@/lib/presentation/style-schema";

export function colorValueToCss(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  return undefined;
}

function gradientStopsToCss(
  stops: readonly { color: unknown; offsetPct: number }[] | undefined,
): string | undefined {
  return stops
    ?.map((stop) => {
      const color = colorValueToCss(stop.color) ?? "transparent";
      return `${color} ${stop.offsetPct}%`;
    })
    .join(", ");
}

export function fillStyleToCss(
  fill: FillStyle | undefined,
  assetResolver?: (id: string) => string | undefined,
): CSSProperties {
  if (!fill) return {};
  switch (fill.type) {
    case "solid":
      return { backgroundColor: colorValueToCss(fill.color) };
    case "linearGradient": {
      const from = colorValueToCss(fill.from) ?? "transparent";
      const to = colorValueToCss(fill.to) ?? "transparent";
      const angle = fill.angle ?? 90;
      const stops = gradientStopsToCss(fill.stops);
      return {
        background: `linear-gradient(${angle}deg, ${stops ?? `${from}, ${to}`})`,
      };
    }
    case "radialGradient": {
      const inner = colorValueToCss(fill.inner) ?? "transparent";
      const outer = colorValueToCss(fill.outer) ?? "transparent";
      const stops = gradientStopsToCss(fill.stops);
      return {
        background: `radial-gradient(${fill.rx ?? fill.r ?? 70}% ${fill.ry ?? fill.r ?? 70}% at ${fill.cx ?? 50}% ${fill.cy ?? 50}%, ${stops ?? `${inner}, ${outer}`})`,
      };
    }
    case "conicGradient": {
      const stops =
        gradientStopsToCss(fill.stops) ?? "transparent, transparent";
      return {
        background: `conic-gradient(from ${fill.fromAngle ?? 0}deg at ${fill.cx ?? 50}% ${fill.cy ?? 50}%, ${stops})`,
      };
    }
    case "repeatingLinearGradient": {
      const angle = fill.angle ?? 90;
      const stops =
        gradientStopsToCss(fill.stops) ?? "transparent 0%, transparent 100%";
      return {
        background: `repeating-linear-gradient(${angle}deg, ${stops})`,
      };
    }
    case "pattern": {
      const color = colorValueToCss(fill.color) ?? "currentColor";
      const background = colorValueToCss(fill.background);
      const spacing = fill.spacingPct ?? 8;
      const width = fill.strokeWidthPct ?? 0.25;
      if (fill.kind === "grid") {
        return {
          ...(background ? { backgroundColor: background } : {}),
          backgroundImage: `linear-gradient(${color} ${width}%, transparent ${width}%), linear-gradient(90deg, ${color} ${width}%, transparent ${width}%)`,
          backgroundSize: `${spacing}% ${spacing}%`,
        };
      }
      if (fill.kind === "dots") {
        return {
          ...(background ? { backgroundColor: background } : {}),
          backgroundImage: `radial-gradient(circle, ${color} ${width}%, transparent ${width}%)`,
          backgroundSize: `${spacing}% ${spacing}%`,
        };
      }
      const angle = fill.kind === "scanlines" ? 0 : (fill.angle ?? 135);
      return {
        ...(background ? { backgroundColor: background } : {}),
        backgroundImage: `repeating-linear-gradient(${angle}deg, ${color} 0%, ${color} ${width}%, transparent ${width}%, transparent ${spacing}%)`,
      };
    }
    case "image": {
      const src = assetResolver?.(fill.assetId);
      if (!src) return {};
      return {
        backgroundImage: `url(${JSON.stringify(src)})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      };
    }
  }
}
