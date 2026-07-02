import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
import type {
  FillStyle,
  StyleObject,
  StyleRef,
} from "@/lib/presentation/style-schema";
import { STYLE_REFS } from "@/lib/presentation/style-registry";
import {
  BUILT_IN_THEME_PACKAGE_IDS,
  type BuiltInThemePackageId,
} from "@/lib/presentation/theme-package-ids";

export const THEME_PACKAGE_SOURCE_IDS = BUILT_IN_THEME_PACKAGE_IDS;

export type ThemePackageSourceId = BuiltInThemePackageId;

type ColorInput = string | { token: string };

type ThemeDefinition = {
  id: ThemePackageSourceId;
  name: string;
  tagline: string;
  accent: string;
  background: string;
  coverBackground: FillStyle;
  surface: string;
  border: string;
  text: string;
  mutedText: string;
  onAccent: string;
  headingFont: string;
  bodyFont: string;
  monoFont?: string;
  radiusPt: number;
  shadowColor: string;
  decoration: "grid" | "orb" | "block" | "ring" | "frame" | "scan";
};

const token = (path: string): { token: string } => ({ token: path });

function solid(color: ColorInput): FillStyle {
  return { type: "solid", color };
}

function linear(from: ColorInput, to: ColorInput, angle = 135): FillStyle {
  return { type: "linearGradient", from, to, angle };
}

function radial(inner: string, outer: string, cx = 70, cy = 10): FillStyle {
  return { type: "radialGradient", inner, outer, cx, cy, rx: 95, ry: 95 };
}

function conic(stops: FillStyle & { type: "conicGradient" }): FillStyle {
  return stops;
}

function pattern(
  kind: "grid" | "dots" | "stripes" | "scanlines",
  color: ColorInput,
  background?: ColorInput,
  spacingPct = 8,
  strokeWidthPct = 0.25,
): FillStyle {
  return {
    type: "pattern",
    kind,
    color,
    ...(background ? { background } : {}),
    spacingPct,
    strokeWidthPct,
  };
}

const DEFINITIONS: ThemeDefinition[] = [
  {
    id: "clarity",
    name: "Swiss Minimal Grid",
    tagline: "Light, gridded brand systems with precise blue emphasis.",
    accent: "#0042ff",
    background: "#ededea",
    coverBackground: solid("#ededea"),
    surface: "#ffffff",
    border: "#cfcfca",
    text: "#0a0a0a",
    mutedText: "#8d8d87",
    onAccent: "#ffffff",
    headingFont: "'Space Grotesk', 'Noto Sans SC', system-ui, sans-serif",
    bodyFont: "'JetBrains Mono', 'Noto Sans SC', monospace",
    monoFont: "'JetBrains Mono', 'Noto Sans SC', monospace",
    radiusPt: 0,
    shadowColor: "#000000",
    decoration: "grid",
  },
  {
    id: "ocean",
    name: "Iridescent Gradient",
    tagline: "Holographic pitch decks with glass panels and gradients.",
    accent: "#7b5cff",
    background: "#0a0a14",
    coverBackground: conic({
      type: "conicGradient",
      fromAngle: 180,
      cx: 60,
      cy: 40,
      stops: [
        { color: "#ff5ec7", offsetPct: 0 },
        { color: "#7b5cff", offsetPct: 34 },
        { color: "#22d3ee", offsetPct: 68 },
        { color: "#7bff9e", offsetPct: 100 },
      ],
    }),
    surface: "#f7f7ff",
    border: "#d8d7ff",
    text: "#f5f7ff",
    mutedText: "#9a9ab8",
    onAccent: "#0a0a14",
    headingFont: "'Space Grotesk', 'Noto Sans SC', system-ui, sans-serif",
    bodyFont: "Inter, 'Noto Sans SC', system-ui, sans-serif",
    radiusPt: 16,
    shadowColor: "#7b5cff",
    decoration: "orb",
  },
  {
    id: "aurora",
    name: "Dark Aurora Corporate",
    tagline: "Dark finance and strategy reports with luminous glass.",
    accent: "#5b6cff",
    background: "#05060d",
    coverBackground: radial("#1a2050", "#05060d", 80, 0),
    surface: "#101427",
    border: "#28305a",
    text: "#eef1ff",
    mutedText: "#7b80a0",
    onAccent: "#04060f",
    headingFont: "Manrope, 'Noto Sans SC', system-ui, sans-serif",
    bodyFont: "'JetBrains Mono', 'Noto Sans SC', monospace",
    monoFont: "'JetBrains Mono', 'Noto Sans SC', monospace",
    radiusPt: 18,
    shadowColor: "#5b6cff",
    decoration: "ring",
  },
  {
    id: "monolith",
    name: "Brutalist Bold",
    tagline: "High-impact black, red, and lime creative decks.",
    accent: "#ff3b1f",
    background: "#0c0c0c",
    coverBackground: solid("#0c0c0c"),
    surface: "#f4f4f0",
    border: "#d8ff00",
    text: "#f4f4f0",
    mutedText: "#7a7a7a",
    onAccent: "#000000",
    headingFont: "'Space Grotesk', 'Noto Sans SC', system-ui, sans-serif",
    bodyFont: "'JetBrains Mono', 'Noto Sans SC', monospace",
    monoFont: "'JetBrains Mono', 'Noto Sans SC', monospace",
    radiusPt: 0,
    shadowColor: "#000000",
    decoration: "block",
  },
  {
    id: "editorial",
    name: "Editorial Serif Luxe",
    tagline: "Cream, cobalt, and gold editorial storytelling decks.",
    accent: "#2f3d8f",
    background: "#f3ede1",
    coverBackground: solid("#f3ede1"),
    surface: "#fffaf0",
    border: "#ddd3bd",
    text: "#191510",
    mutedText: "#8c826d",
    onAccent: "#ffffff",
    headingFont: "'Source Serif 4', 'Noto Sans SC', serif",
    bodyFont: "Inter, 'Noto Sans SC', system-ui, sans-serif",
    radiusPt: 8,
    shadowColor: "#2f3d8f",
    decoration: "ring",
  },
  {
    id: "noir",
    name: "Luxe Maroon Magazine",
    tagline: "Premium maroon and gold portfolio or brand decks.",
    accent: "#c9a24a",
    background: "#3a0d12",
    coverBackground: radial("#5a1820", "#3a0d12", 70, 0),
    surface: "#f6ece2",
    border: "#6a1f28",
    text: "#f6ece2",
    mutedText: "#a07b76",
    onAccent: "#3a0d12",
    headingFont: "'Source Serif 4', 'Noto Sans SC', serif",
    bodyFont: "Inter, 'Noto Sans SC', system-ui, sans-serif",
    radiusPt: 10,
    shadowColor: "#c9a24a",
    decoration: "frame",
  },
  {
    id: "terra",
    name: "Vibrant Pop",
    tagline: "Playful yellow, red, and blue creative brief decks.",
    accent: "#ff2d2d",
    background: "#f5e500",
    coverBackground: solid("#f5e500"),
    surface: "#fffdf1",
    border: "#0b0b0b",
    text: "#0b0b0b",
    mutedText: "#6b6b5a",
    onAccent: "#ffffff",
    headingFont: "'Space Grotesk', 'Noto Sans SC', system-ui, sans-serif",
    bodyFont: "Manrope, 'Noto Sans SC', system-ui, sans-serif",
    radiusPt: 14,
    shadowColor: "#1f3aff",
    decoration: "block",
  },
  {
    id: "pulse",
    name: "Tech Terminal Mono",
    tagline: "Neon terminal-style decks with mono typography and grids.",
    accent: "#39ff88",
    background: "#06080a",
    coverBackground: pattern(
      "scanlines",
      "rgba(57,255,136,.22)",
      "#06080a",
      8,
      0.18,
    ),
    surface: "#0d1512",
    border: "#224d36",
    text: "#d6f7e6",
    mutedText: "#5d7a6c",
    onAccent: "#06080a",
    headingFont: "'JetBrains Mono', 'Noto Sans SC', monospace",
    bodyFont: "'JetBrains Mono', 'Noto Sans SC', monospace",
    monoFont: "'JetBrains Mono', 'Noto Sans SC', monospace",
    radiusPt: 4,
    shadowColor: "#39ff88",
    decoration: "scan",
  },
];

function makeTokens(definition: ThemeDefinition): ThemePackageV1["tokens"] {
  return {
    colors: {
      canvas: {
        fill: definition.background,
        text: definition.text,
        mutedText: definition.mutedText,
      },
      surface: {
        fill: definition.surface,
        text: definition.text,
        mutedText: definition.mutedText,
        border: definition.border,
      },
      accent: {
        fill: definition.accent,
        text: definition.onAccent,
      },
    },
    fonts: {
      heading: definition.headingFont,
      body: definition.bodyFont,
      ...(definition.monoFont ? { mono: definition.monoFont } : {}),
    },
    radii: {
      card: definition.radiusPt,
      pill: 999,
    },
  };
}

function makeTextStyle(
  fontFamily: ColorInput,
  fontSizePt: number,
  color: ColorInput,
  weight: number,
  extra: Record<string, unknown> = {},
): StyleObject {
  return {
    text: {
      fontFamily,
      fontSizePt,
      color,
      weight,
      lineHeight: 1.12,
      ...extra,
    },
  } as StyleObject;
}

function makeStyles(definition: ThemeDefinition): ThemePackageV1["styles"] {
  const heading = token("fonts.heading");
  const body = token("fonts.body");
  const canvasText = token("colors.canvas.text");
  const mutedText = token("colors.canvas.mutedText");
  const surfaceText = token("colors.surface.text");
  const surfaceMutedText = token("colors.surface.mutedText");
  const accentFill = token("colors.accent.fill");
  const accentText = token("colors.accent.text");
  const glassy = definition.id === "ocean" || definition.id === "aurora";
  const hardShadow = definition.id === "terra" || definition.id === "monolith";

  const styles: Record<StyleRef, Record<string, StyleObject>> = {
    "slide.cover": {
      default: {
        slide: {
          background: definition.coverBackground,
          chrome: "minimal",
          decoration: "expressive",
        },
      },
    },
    "slide.content": {
      default: {
        slide: {
          background:
            definition.id === "clarity"
              ? pattern(
                  "grid",
                  "rgba(10,10,10,.12)",
                  token("colors.canvas.fill"),
                  8,
                  0.12,
                )
              : definition.id === "pulse"
                ? pattern(
                    "scanlines",
                    "rgba(57,255,136,.16)",
                    token("colors.canvas.fill"),
                    8,
                    0.08,
                  )
                : solid(token("colors.canvas.fill")),
          chrome: "default",
          decoration: "default",
        },
      },
    },
    "slide.section": {
      default: {
        slide: {
          background: linear(definition.background, definition.surface),
          chrome: "minimal",
          decoration: "expressive",
        },
      },
    },
    "text.title": {
      default: makeTextStyle(heading, 38, canvasText, 800, {
        lineHeight: 1.04,
      }),
      large: makeTextStyle(heading, 52, canvasText, 800, { lineHeight: 0.98 }),
    },
    "text.subtitle": {
      default: makeTextStyle(body, 18, mutedText, 400, { lineHeight: 1.36 }),
    },
    "text.body": {
      default: makeTextStyle(body, 15, surfaceText, 400, { lineHeight: 1.45 }),
      small: makeTextStyle(body, 12, surfaceMutedText, 400, {
        lineHeight: 1.35,
      }),
    },
    "text.kicker": {
      default: makeTextStyle(body, 11, accentFill, 700, {
        letterSpacingEm: 0.2,
        textTransform: "uppercase",
      }),
    },
    "text.caption": {
      default: makeTextStyle(body, 10, mutedText, 500, { lineHeight: 1.25 }),
    },
    "text.quote": {
      default: makeTextStyle(heading, 27, canvasText, 600, {
        italic: true,
        lineHeight: 1.28,
      }),
    },
    "text.metric": {
      default: makeTextStyle(heading, 48, accentFill, 800, {
        lineHeight: 0.95,
      }),
    },
    "surface.card": {
      default: {
        fill: glassy
          ? solid("rgba(255,255,255,.08)")
          : solid(token("colors.surface.fill")),
        stroke: {
          color: hardShadow
            ? token("colors.canvas.text")
            : token("colors.surface.border"),
          widthPt: hardShadow ? 2.2 : 1,
        },
        radius: { allPt: definition.radiusPt },
        shadow: {
          xPt: hardShadow ? 5 : 0,
          yPt: hardShadow ? 5 : 10,
          blurPt: hardShadow ? 0 : 24,
          color: hardShadow ? definition.border : definition.shadowColor,
          opacity: hardShadow ? 1 : 0.18,
        },
        ...(glassy
          ? { effect: { kind: "glass", intensity: "medium" } as const }
          : {}),
      },
    },
    "surface.callout": {
      default: {
        fill: solid(token("colors.surface.fill")),
        stroke: { color: accentFill, widthPt: 1.4 },
        radius: { allPt: Math.max(4, definition.radiusPt) },
      },
    },
    "surface.table": {
      default: {
        fill: solid(token("colors.surface.fill")),
        stroke: { color: token("colors.surface.border"), widthPt: 1 },
        table: {
          headerFill: solid(accentFill),
          rowFill: solid(token("colors.surface.fill")),
          alternateRowFill: solid(token("colors.canvas.fill")),
          border: { color: token("colors.surface.border"), widthPt: 1 },
          text: { fontFamily: body, fontSizePt: 10.5, color: surfaceText },
          headerText: {
            fontFamily: body,
            fontSizePt: 10.5,
            color: accentText,
            weight: 700,
          },
        },
      },
    },
    "media.hero": {
      default: {
        fill:
          definition.id === "ocean"
            ? linear("#ff5ec7", "#22d3ee", 135)
            : definition.id === "terra"
              ? linear("#1f3aff", "#ff2d2d", 135)
              : solid(token("colors.surface.fill")),
        image: { fit: "cover", radiusPct: definition.radiusPt > 0 ? 3 : 0 },
        radius: { allPt: definition.radiusPt },
      },
    },
    "media.inline": {
      default: {
        fill: solid(token("colors.surface.fill")),
        image: { fit: "contain", radiusPct: definition.radiusPt > 0 ? 2 : 0 },
        radius: { allPt: Math.max(2, definition.radiusPt / 2) },
      },
    },
    "chart.primary": {
      default: {
        fill: solid(accentFill),
        text: { fontFamily: body, fontSizePt: 11, color: surfaceText },
      },
    },
    "connector.primary": {
      default: {
        connector: {
          stroke: { color: accentFill, widthPt: 1.6 },
          routing: "straight",
        },
      },
    },
    "decoration.background": {
      default: {
        fill: solid(definition.accent),
        opacity: 0.16,
      },
    },
  };

  for (const ref of STYLE_REFS) {
    styles[ref] ??= { default: {} };
  }
  return styles;
}

function makeDecorations(
  definition: ThemeDefinition,
): ThemePackageV1["decorations"] {
  const base = {
    role: "themeDecoration" as const,
    visibility: "default" as const,
    chrome: "default" as const,
  };

  if (definition.decoration === "grid") {
    return {
      grid: {
        ...base,
        id: "grid",
        component: "shape",
        layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: 0 },
        style: {
          fill: pattern("grid", definition.border, undefined, 6.25, 0.1),
          opacity: 0.42,
        },
        content: { type: "shape", shape: "rect" },
      },
      accentRule: {
        ...base,
        id: "accentRule",
        component: "shape",
        layout: { frame: { x: 8, y: 90, w: 22, h: 0.6 }, zIndex: 0 },
        style: { fill: solid(definition.accent) },
        content: { type: "shape", shape: "rect" },
      },
    };
  }

  if (definition.decoration === "scan") {
    return {
      scanLine: {
        ...base,
        id: "scanLine",
        component: "shape",
        layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: 0 },
        style: {
          fill: pattern("scanlines", definition.accent, undefined, 8, 0.08),
          opacity: 0.55,
        },
        content: { type: "shape", shape: "rect" },
      },
      terminalBlock: {
        ...base,
        id: "terminalBlock",
        component: "shape",
        layout: { frame: { x: 72, y: 10, w: 18, h: 16 }, zIndex: 0 },
        style: {
          fill: solid(definition.surface),
          stroke: { color: definition.accent, widthPt: 1 },
          radius: { allPt: definition.radiusPt },
          opacity: 0.8,
        },
        content: { type: "shape", shape: "rect" },
      },
    };
  }

  if (definition.decoration === "block") {
    return {
      colorBlock: {
        ...base,
        id: "colorBlock",
        component: "shape",
        layout: { frame: { x: 68, y: 0, w: 32, h: 38 }, zIndex: 0 },
        style: { fill: solid(definition.accent), opacity: 0.9 },
        content: { type: "shape", shape: "rect" },
      },
      popDots: {
        ...base,
        id: "popDots",
        component: "shape",
        layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: 0 },
        style: {
          fill: pattern("dots", definition.border, undefined, 9, 0.45),
          opacity: definition.id === "terra" ? 0.22 : 0,
        },
        content: { type: "shape", shape: "rect" },
        appliesTo: {
          templateKinds: ["cover", "section", "quote", "closing"],
        },
      },
      secondaryBlock: {
        ...base,
        id: "secondaryBlock",
        component: "shape",
        layout: { frame: { x: 78, y: 16, w: 12, h: 18 }, zIndex: 0 },
        style: { fill: solid(definition.border), opacity: 0.92 },
        content: { type: "shape", shape: "rect" },
      },
    };
  }

  if (definition.decoration === "ring" || definition.decoration === "frame") {
    return {
      silk: {
        ...base,
        id: "silk",
        component: "shape",
        layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: 0 },
        style: {
          fill: {
            type: "radialGradient",
            inner:
              definition.id === "noir"
                ? "rgba(201,162,74,.16)"
                : "rgba(47,61,143,.14)",
            outer: "transparent",
            cx: 78,
            cy: 100,
            rx: 70,
            ry: 60,
          },
          opacity: 0.8,
        },
        content: { type: "shape", shape: "rect" },
      },
      ring: {
        ...base,
        id: "ring",
        component: "shape",
        layout: { frame: { x: 68, y: -12, w: 38, h: 54 }, zIndex: 0 },
        style: {
          fill: solid("transparent"),
          stroke: { color: definition.accent, widthPt: 1.2 },
          radius: { allPt: 999 },
          opacity: definition.decoration === "frame" ? 0.5 : 0.42,
        },
        content: { type: "shape", shape: "ellipse" },
      },
      accentFrame: {
        ...base,
        id: "accentFrame",
        component: "shape",
        layout: { frame: { x: 72, y: 62, w: 18, h: 22 }, zIndex: 0 },
        style: {
          fill: solid("transparent"),
          stroke: { color: definition.border, widthPt: 1 },
          radius: { allPt: definition.radiusPt },
          opacity: 0.7,
        },
        content: { type: "shape", shape: "rect" },
      },
    };
  }

  return {
    iridescentField: {
      ...base,
      id: "iridescentField",
      component: "shape",
      layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: 0 },
      style: {
        fill: conic({
          type: "conicGradient",
          fromAngle: 180,
          cx: 60,
          cy: 40,
          stops: [
            { color: "#ff5ec7", offsetPct: 0 },
            { color: definition.accent, offsetPct: 35 },
            { color: "#22d3ee", offsetPct: 70 },
            { color: "#7bff9e", offsetPct: 100 },
          ],
        }),
        opacity: 0.42,
        effect: { kind: "blur", radiusPt: 54 },
      },
      content: { type: "shape", shape: "rect" },
      appliesTo: { templateKinds: ["cover", "section", "visual-focus"] },
    },
    glow: {
      ...base,
      id: "glow",
      component: "shape",
      layout: { frame: { x: 48, y: -18, w: 70, h: 92 }, zIndex: 0 },
      style: {
        fill: linear("#ff5ec7", definition.accent, 120),
        radius: { allPt: 999 },
        opacity: 0.46,
        effect: { kind: "blur", radiusPt: 32 },
      },
      content: { type: "shape", shape: "ellipse" },
    },
  };
}

function makeThemePackage(definition: ThemeDefinition): ThemePackageV1 {
  return {
    schemaVersion: 1,
    id: definition.id,
    version: "1.0.0",
    name: definition.name,
    tagline: definition.tagline,
    tokens: makeTokens(definition),
    styles: makeStyles(definition),
    decorations: makeDecorations(definition),
  };
}

export const THEME_PACKAGE_SOURCES: ThemePackageV1[] =
  DEFINITIONS.map(makeThemePackage);
