/** Renders native presentation semantic preview decks into static HTML pages. */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
  Deck,
  TableContent,
  TextContent,
} from "@/lib/presentation/schema";
import type { ResolvedRenderNode } from "@/lib/presentation/render-tree";
import type { FillStyle, StyleObject } from "@/lib/presentation/style-schema";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
import { resolveDeckRenderTree } from "@/lib/presentation/render-resolver";
import { validateThemePackage } from "@/lib/presentation/theme-package-schema";
import { safeParseDeck } from "@/lib/presentation/validation";

const here = dirname(fileURLToPath(import.meta.url));
const decksDir = join(here, "decks");
const packagesDir = join(here, "packages");
const outDir = join(here, "preview");

const FONTS_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&family=Manrope:wght@400;600;700;800&family=Noto+Sans+SC:wght@400;500;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700;8..60,800&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">';

const PAGE_CSS = `:root{color-scheme:light;background:#11131a;color:#f4f4f6;font-family:Inter,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;padding:36px 0 56px;background:#11131a}header{max-width:1120px;margin:0 auto 22px;padding:0 24px}h1{margin:0 0 8px;font-size:30px;line-height:1.1}p{margin:0;color:#aeb4c2}nav{max-width:1120px;margin:0 auto 28px;padding:0 24px;display:flex;gap:8px;flex-wrap:wrap}nav a{color:#f4f4f6;text-decoration:none;border:1px solid #343946;border-radius:6px;padding:7px 10px;font-size:13px;background:#1a1d26}.deck{max-width:1120px;margin:0 auto;padding:0 24px;display:grid;gap:28px}.slide-wrap{margin:0}.slide{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;container-type:size;background:#fff;box-shadow:0 18px 52px rgba(0,0,0,.42)}figcaption{margin-top:8px;color:#aeb4c2;font-size:13px}.placeholder{display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:1.8cqh;color:rgba(255,255,255,.72);background:repeating-linear-gradient(135deg,rgba(255,255,255,.08) 0 8px,rgba(255,255,255,.02) 8px 16px)}table{width:100%;height:100%;border-collapse:collapse;font-size:1.9cqh}th,td{border:1px solid currentColor;padding:.75cqh 1cqw;text-align:left;vertical-align:top}th{font-weight:700}.grid{max-width:1120px;margin:0 auto;padding:0 24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:24px}.card{text-decoration:none;color:inherit}.card .slide{box-shadow:0 8px 22px rgba(0,0,0,.4)}.card figcaption{display:none}.card-meta{margin-top:10px;font-size:15px}.card:hover .slide{outline:2px solid #9db4ff}`;

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colorCss(value: unknown): string {
  return typeof value === "string" ? value : "#71717a";
}

function fillCss(fill: FillStyle | undefined): string {
  if (!fill) return "transparent";
  if (fill.type === "solid") return colorCss(fill.color);
  if (fill.type === "linearGradient") {
    const stops = fill.stops
      ?.map((stop) => `${colorCss(stop.color)} ${stop.offsetPct}%`)
      .join(", ");
    return `linear-gradient(${fill.angle ?? 135}deg, ${stops ?? `${colorCss(fill.from)}, ${colorCss(fill.to)}`})`;
  }
  if (fill.type === "radialGradient") {
    const stops = fill.stops
      ?.map((stop) => `${colorCss(stop.color)} ${stop.offsetPct}%`)
      .join(", ");
    return `radial-gradient(${fill.rx ?? fill.r ?? 70}% ${fill.ry ?? fill.r ?? 70}% at ${fill.cx ?? 50}% ${fill.cy ?? 50}%, ${stops ?? `${colorCss(fill.inner)}, ${colorCss(fill.outer)}`})`;
  }
  if (fill.type === "conicGradient") {
    const stops = fill.stops
      .map((stop) => `${colorCss(stop.color)} ${stop.offsetPct}%`)
      .join(", ");
    return `conic-gradient(from ${fill.fromAngle ?? 0}deg at ${fill.cx ?? 50}% ${fill.cy ?? 50}%, ${stops})`;
  }
  if (fill.type === "repeatingLinearGradient") {
    const stops = fill.stops
      .map((stop) => `${colorCss(stop.color)} ${stop.offsetPct}%`)
      .join(", ");
    return `repeating-linear-gradient(${fill.angle ?? 90}deg, ${stops})`;
  }
  if (fill.type === "pattern") {
    const color = colorCss(fill.color);
    const background = fill.background ? `, ${colorCss(fill.background)}` : "";
    const spacing = fill.spacingPct ?? 8;
    const width = fill.strokeWidthPct ?? 0.25;
    if (fill.kind === "grid") {
      return `linear-gradient(${color} ${width}%, transparent ${width}%), linear-gradient(90deg, ${color} ${width}%, transparent ${width}%)${background}`;
    }
    if (fill.kind === "dots") {
      return `radial-gradient(circle, ${color} ${width}%, transparent ${width}%)${background}`;
    }
    const angle = fill.kind === "scanlines" ? 0 : (fill.angle ?? 135);
    return `repeating-linear-gradient(${angle}deg, ${color} 0%, ${color} ${width}%, transparent ${width}%, transparent ${spacing}%)${background}`;
  }
  return "#e9e9ee";
}

function ptToCqh(value: number): string {
  return `${(value * 0.247).toFixed(3)}cqh`;
}

function styleCss(style: StyleObject): string {
  const parts: string[] = [];
  if (style.fill) parts.push(`background:${fillCss(style.fill)};`);
  if (style.fill?.type === "pattern" && style.fill.kind !== "stripes") {
    parts.push(
      `background-size:${style.fill.spacingPct ?? 8}% ${style.fill.spacingPct ?? 8}%;`,
    );
  }
  if (style.stroke) {
    const line =
      style.stroke.dash === "dashed"
        ? "dashed"
        : style.stroke.dash === "dotted"
          ? "dotted"
          : "solid";
    parts.push(
      `border:${style.stroke.widthPt}pt ${line} ${colorCss(style.stroke.color)};`,
    );
  }
  if (style.radius) {
    const radius =
      "allPt" in style.radius ? style.radius.allPt : style.radius.topLeftPt;
    parts.push(`border-radius:${Math.max(0, radius) * 0.18}cqmin;`);
  }
  if (typeof style.opacity === "number")
    parts.push(`opacity:${style.opacity};`);
  if (style.shadow) {
    parts.push(
      `box-shadow:${style.shadow.xPt}pt ${style.shadow.yPt}pt ${style.shadow.blurPt}pt rgba(0,0,0,${style.shadow.opacity ?? 0.2});`,
    );
  }
  if (style.effect?.kind === "blur") {
    parts.push(`filter:blur(${style.effect.radiusPt * 0.18}cqmin);`);
  }
  if (style.effect?.kind === "glow") {
    parts.push(
      `filter:drop-shadow(0 0 ${style.effect.blurPt * 0.18}cqmin ${colorCss(style.effect.color)});`,
    );
  }
  if (style.effect?.kind === "glass") {
    parts.push(
      "backdrop-filter:blur(16px) saturate(1.25);-webkit-backdrop-filter:blur(16px) saturate(1.25);",
    );
  }
  if (style.text) {
    const text = style.text as Record<string, unknown>;
    const fontSize =
      typeof text.fontSizePt === "number" ? ptToCqh(text.fontSizePt) : "2.4cqh";
    const weight = text.weight ?? text.fontWeight ?? 400;
    const lineHeight = text.lineHeight ?? text.lineHeightEm ?? 1.2;
    parts.push(
      "display:flex;flex-direction:column;justify-content:center;overflow:hidden;",
    );
    parts.push(
      `font-family:${esc(text.fontFamily ?? "Inter, system-ui, sans-serif")};`,
    );
    parts.push(
      `font-size:${fontSize};font-weight:${weight};line-height:${lineHeight};`,
    );
    parts.push(`color:${colorCss(text.color)};`);
    if (text.italic === true || text.fontStyle === "italic")
      parts.push("font-style:italic;");
    if (text.align) parts.push(`text-align:${text.align};`);
    if (text.textTransform) parts.push(`text-transform:${text.textTransform};`);
    if (typeof text.letterSpacingEm === "number") {
      parts.push(`letter-spacing:${text.letterSpacingEm}em;`);
    }
  }
  return parts.join("");
}

function layoutCss(node: ResolvedRenderNode): string {
  const frame = node.layout.frame;
  return `position:absolute;left:${frame.x}%;top:${frame.y}%;width:${frame.w}%;height:${frame.h}%;z-index:${node.layout.zIndex ?? 0};${node.layout.rotation ? `transform:rotate(${node.layout.rotation}deg);` : ""}`;
}

function textHtml(content: TextContent): string {
  return content.paragraphs
    .map((paragraph) => {
      const prefix = paragraph.list ? "• " : "";
      return `<div style="width:100%;white-space:pre-wrap;overflow-wrap:break-word;">${esc(prefix)}${esc(paragraph.text)}</div>`;
    })
    .join("");
}

function tableHtml(content: TableContent, style: StyleObject): string {
  const tableStyle = style.table;
  const headerBg = fillCss(tableStyle?.headerFill);
  const rowBg = fillCss(tableStyle?.rowFill);
  const altBg = fillCss(tableStyle?.alternateRowFill);
  const border = tableStyle?.border?.color
    ? colorCss(tableStyle.border.color)
    : "currentColor";
  const header =
    content.header !== false
      ? `<thead><tr>${content.columns.map((column) => `<th style="background:${headerBg};border-color:${border};">${esc(column.label)}</th>`).join("")}</tr></thead>`
      : "";
  const rows = content.rows
    .map(
      (row, index) =>
        `<tr style="background:${index % 2 === 1 ? altBg : rowBg};">${row.cells.map((cell) => `<td style="border-color:${border};">${esc(cell.text)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table>${header}<tbody>${rows}</tbody></table>`;
}

function nodeContentHtml(node: ResolvedRenderNode): string {
  if (node.content.type === "text") return textHtml(node.content.content);
  if (node.content.type === "table")
    return tableHtml(node.content.content, node.style);
  if (node.content.type === "image" || node.content.type === "visual") {
    return '<div class="placeholder">visual</div>';
  }
  if (node.content.type === "shape") return "";
  return "";
}

function renderNode(node: ResolvedRenderNode): string {
  const shape =
    node.content.type === "shape" ? node.content.content.shape : undefined;
  const clip =
    shape === "ellipse" || shape === "circle"
      ? "border-radius:50%;"
      : shape === "triangle"
        ? "clip-path:polygon(50% 0,100% 100%,0 100%);"
        : "";
  const box = `<div data-node-id="${esc(node.id)}" data-node-type="${esc(node.content.type)}" style="${layoutCss(node)}${styleCss(node.style)}${clip}">${nodeContentHtml(node)}</div>`;
  const children = node.children?.map(renderNode).join("") ?? "";
  return `${box}${children}`;
}

function readThemePackage(id: string): ThemePackageV1 {
  const input = JSON.parse(
    readFileSync(join(packagesDir, `${id}.package.json`), "utf8"),
  );
  const result = validateThemePackage(input);
  if (!result.valid) {
    throw new Error(
      `${id} package failed validation: ${result.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`,
    );
  }
  return result.package;
}

function readDeck(id: string): Deck {
  const input = JSON.parse(
    readFileSync(join(decksDir, `${id}.deck.json`), "utf8"),
  );
  const result = safeParseDeck(input);
  if (!result.success) {
    throw new Error(
      `${id} deck failed presentation validation: ${result.errors.join("; ")}`,
    );
  }
  return result.data;
}

export function renderPrototypeSlideHtml(
  deck: Deck,
  themePackage: ThemePackageV1,
  index: number,
): string {
  const tree = resolveDeckRenderTree(deck, themePackage);
  const slide = tree.slides[index];
  if (!slide) return "";
  const background = fillCss(slide.background.fill);
  const decorations = slide.decorations.map(renderNode).join("");
  const backgroundChrome = slide.chrome
    .filter((node) => (node.layout.zIndex ?? 0) < 0)
    .map(renderNode)
    .join("");
  const nodes = slide.nodes.map(renderNode).join("");
  const foregroundChrome = slide.chrome
    .filter((node) => (node.layout.zIndex ?? 0) >= 0)
    .map(renderNode)
    .join("");
  const label = deck.slides[index]?.template.kind ?? `Slide ${index + 1}`;
  return `<figure class="slide-wrap"><div class="slide" style="background:${background};">${decorations}${backgroundChrome}${nodes}${foregroundChrome}</div><figcaption>${index + 1} · ${esc(label)}</figcaption></figure>`;
}

function readDeckIds(): string[] {
  return readdirSync(decksDir)
    .filter((file) => file.endsWith(".deck.json"))
    .map((file) => file.replace(".deck.json", ""))
    .sort();
}

export function runPrototypeHtmlRenderer(): void {
  mkdirSync(outDir, { recursive: true });
  const ids = readDeckIds();

  for (const id of ids) {
    const deck = readDeck(id);
    const themePackage = readThemePackage(id);
    const navLinks = ids
      .map((otherId) => {
        const active =
          otherId === id ? ' style="background:#3a3e48;font-weight:600"' : "";
        return `<a href="${otherId}.html"${active}>${otherId}</a>`;
      })
      .join("");
    const slides = deck.slides
      .map((_, index) => renderPrototypeSlideHtml(deck, themePackage, index))
      .join("\n");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FONTS_LINK}<title>${esc(themePackage.name)} - presentation theme preview</title><style>${PAGE_CSS}</style></head><body><header><h1>${esc(themePackage.name)}</h1><p>Native presentation semantic theme package · heading ${esc(themePackage.tokens.fonts.heading.split(",")[0])} · accent ${esc(themePackage.tokens.colors.accent.fill)}</p></header><nav>${navLinks}</nav><main class="deck">${slides}</main></body></html>`;
    writeFileSync(join(outDir, `${id}.html`), html, "utf8");
    console.log(`✓ preview/${id}.html`);
  }

  const cards = ids
    .map((id) => {
      const deck = readDeck(id);
      const themePackage = readThemePackage(id);
      const cover = renderPrototypeSlideHtml(deck, themePackage, 0);
      return `<a class="card" href="${id}.html"><div class="card-stage">${cover}</div><div class="card-meta"><strong>${esc(themePackage.name)}</strong></div></a>`;
    })
    .join("");

  const indexHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FONTS_LINK}<title>Slide themes - presentation gallery</title><style>${PAGE_CSS}</style></head><body><header><h1>Professional slide themes</h1><p>Eight native presentation theme packages rendered through the shared semantic render tree.</p></header><main class="grid">${cards}</main></body></html>`;
  writeFileSync(join(outDir, "index.html"), indexHtml, "utf8");
  console.log(
    `✓ preview/index.html\n\nOpen prototypes/slide-themes/preview/index.html`,
  );
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry ? import.meta.url === pathToFileURL(entry).href : false;
}

if (isMainModule()) {
  runPrototypeHtmlRenderer();
}
