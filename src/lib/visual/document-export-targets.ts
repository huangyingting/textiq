/**
 * Browser-only document export renderers for PDF, PPTX, and infographic targets.
 */

import type { jsPDF } from "jspdf";
import type PptxGenJS from "pptxgenjs";

import type { Visual } from "@/lib/visual/schema";
import { exportPNG } from "@/lib/visual/export";
import {
  computeVisualSlideLayout,
  isImageFallback,
  visualToNativeSpecs,
} from "@/lib/visual/pptx-shapes";
import {
  computeInfographicLayout,
  DEFAULT_INFOGRAPHIC_CONFIG,
  type InfographicConfig,
} from "@/lib/visual/infographic-layout";
import {
  documentTableBlockToMarkdown,
  type DocumentBlock,
  type DocumentVisualBlock,
} from "@/lib/content";

// ---------------------------------------------------------------------------
// PDF helpers (browser-only)
// ---------------------------------------------------------------------------

const PAGE_W_MM = 210; // A4 portrait width
const PAGE_H_MM = 297; // A4 portrait height
const MARGIN_MM = 20;
const BODY_W_MM = PAGE_W_MM - MARGIN_MM * 2;

/** Convert SVG element → PNG data-URL at 2× scale for quality. */
async function svgToPngDataUrl(svg: SVGSVGElement): Promise<string | null> {
  const pngBlob = await exportPNG(svg, {
    background: "include",
    colorMode: "color",
    scale: 2,
  });
  if (!pngBlob) return null;
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(pngBlob);
  });
}

/**
 * Render one visual block into the PDF.  Each visual gets its own A4 page
 * (landscape if wider than tall) with the PNG inset at 10 % margins.
 */
async function addVisualPage(
  pdf: jsPDF,
  svg: SVGSVGElement,
  addPage: boolean,
): Promise<boolean> {
  const viewBox = svg.viewBox.baseVal;
  const vw = viewBox.width;
  const vh = viewBox.height;
  if (vw === 0 || vh === 0) return false;

  const pngDataUrl = await svgToPngDataUrl(svg);
  if (!pngDataUrl) return false;

  const landscape = vw > vh;
  const pgW = landscape ? PAGE_H_MM : PAGE_W_MM;
  const pgH = landscape ? PAGE_W_MM : PAGE_H_MM;

  if (addPage) {
    pdf.addPage("a4", landscape ? "landscape" : "portrait");
  }

  // Fit image within 80 % of page area
  const maxW = pgW * 0.8;
  const maxH = pgH * 0.8;
  const ratio = Math.min(maxW / vw, maxH / vh);
  const imgW = vw * ratio;
  const imgH = vh * ratio;
  const x = (pgW - imgW) / 2;
  const y = (pgH - imgH) / 2;

  pdf.addImage(pngDataUrl, "PNG", x, y, imgW, imgH);
  return true;
}

/**
 * Produces a single multi-page PDF for the entire document.
 *
 * Layout:
 * - A title "page-header" is written on the first page using the document
 *   title passed in.
 * - Text blocks (headings, paragraphs, quotes, list items) are flowed onto
 *   A4 pages with automatic line-wrapping and page breaks.
 * - Each visual block starts on a new A4 page (landscape if the visual is
 *   wider than tall) sized to fit the image.
 * - An empty document (zero blocks) yields a single title page.
 *
 * @param blocks   Output of {@link collectDocumentBlocks}
 * @param title    Document title — shown as the first-page heading
 * @param getSvg   Callback to resolve a live SVGSVGElement for a given visualId
 */
export async function exportDocumentAsPDF(
  blocks: DocumentBlock[],
  title: string,
  getSvg: (visualId: string) => SVGSVGElement | null,
): Promise<Blob | null> {
  try {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    let curY = MARGIN_MM;

    /** Write text with automatic page-break and return new Y position. */
    const writeText = (
      text: string,
      fontSize: number,
      bold: boolean,
      indent = 0,
    ) => {
      pdf.setFontSize(fontSize);
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      const maxW = BODY_W_MM - indent;
      const lines = pdf.splitTextToSize(text, maxW) as string[];
      const lineH = fontSize * 0.352778 * 1.4; // pt→mm × leading
      for (const line of lines) {
        if (curY + lineH > PAGE_H_MM - MARGIN_MM) {
          pdf.addPage();
          curY = MARGIN_MM;
        }
        pdf.text(line, MARGIN_MM + indent, curY);
        curY += lineH;
      }
    };

    // Document title
    if (title) {
      writeText(title, 22, true);
      curY += 6;
    }

    let onFirstPage = true;
    let needsTextPageAfterVisual = false;

    const ensureTextPageAfterVisual = () => {
      if (!needsTextPageAfterVisual) {
        return;
      }
      pdf.addPage("a4", "portrait");
      curY = MARGIN_MM;
      needsTextPageAfterVisual = false;
    };

    for (const block of blocks) {
      if (block.kind === "visual") {
        const svg = getSvg(block.visualId);
        if (!svg) continue;
        const visualAdded = await addVisualPage(pdf, svg, /* addPage= */ true);
        if (!visualAdded) continue;
        onFirstPage = false;
        // A visual owns the whole current page. If text follows, it must start
        // on a new portrait page rather than being drawn over the visual.
        curY = MARGIN_MM;
        needsTextPageAfterVisual = true;
        continue;
      }

      if (block.kind === "table") {
        ensureTextPageAfterVisual();
        writeText(documentTableBlockToMarkdown(block), 10, false);
        curY += 1;
        onFirstPage = false;
        continue;
      }

      // Text block
      const { blockType, text, level } = block;

      if (blockType === "hr") {
        ensureTextPageAfterVisual();
        if (!onFirstPage) {
          curY += 4;
          if (curY + 1 > PAGE_H_MM - MARGIN_MM) {
            pdf.addPage();
            curY = MARGIN_MM;
          }
          pdf.setDrawColor(180);
          pdf.line(MARGIN_MM, curY, PAGE_W_MM - MARGIN_MM, curY);
          curY += 4;
        }
        continue;
      }

      if (!text.trim()) continue;
      ensureTextPageAfterVisual();

      switch (blockType) {
        case "heading": {
          const fs = level === 1 ? 18 : level === 2 ? 15 : 13;
          curY += level === 1 ? 5 : 3;
          writeText(text, fs, true);
          curY += 2;
          break;
        }
        case "quote":
          curY += 1;
          writeText(`"${text}"`, 11, false, 6);
          curY += 1;
          break;
        case "listitem":
          writeText(`• ${text}`, 11, false, 4);
          break;
        default:
          writeText(text, 11, false);
          curY += 1;
      }

      onFirstPage = false;
    }

    return pdf.output("blob");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// PPTX helpers (browser-only)
// ---------------------------------------------------------------------------

const SLIDE_W = 10; // inches
const SLIDE_H = 7.5; // inches

/** Adds a single-visual slide to the presentation using native shapes where
 * supported; falls back to an embedded PNG for visual kinds that cannot be
 * represented as native PowerPoint shapes (funnel, pyramid).
 *
 * Returns `false` (without adding a slide) when the SVG has a zero-area
 * viewBox — there is nothing renderable to show. Returns `true` in every
 * other case, since `pptx.addSlide()` has already been called by then (even
 * if PNG rasterization subsequently fails and the slide ends up title-only). */
async function addVisualSlide(
  pptx: PptxGenJS,
  svg: SVGSVGElement,
  slideTitle: string | null,
  visual: Visual | null,
): Promise<boolean> {
  const viewBox = svg.viewBox.baseVal;
  const vw = viewBox.width;
  const vh = viewBox.height;
  if (vw === 0 || vh === 0) return false;

  const slide = pptx.addSlide();

  const titleAreaH = slideTitle ? 0.9 : 0;

  if (slideTitle) {
    slide.addText(slideTitle, {
      x: 0.5,
      y: 0.1,
      w: SLIDE_W - 1,
      h: titleAreaH,
      fontSize: 20,
      bold: true,
      color: "1a1a2e",
    });
  }

  // Attempt native shapes when the Visual payload is available
  if (visual) {
    const layout = computeVisualSlideLayout(visual, titleAreaH);
    const specs = visualToNativeSpecs(visual, layout);

    if (!isImageFallback(specs)) {
      const { applySpecsToSlide } = await import("@/lib/visual/pptx-apply");
      applySpecsToSlide(slide, specs);
      return true;
    }
  }

  // Image fallback
  const pngDataUrl = await svgToPngDataUrl(svg);
  if (!pngDataUrl) return true;

  const contentH = SLIDE_H - titleAreaH - 0.3;
  const contentW = SLIDE_W * 0.9;
  const ratio = Math.min(contentW / vw, contentH / vh);
  const imgW = vw * ratio;
  const imgH = vh * ratio;
  const x = (SLIDE_W - imgW) / 2;
  const y = titleAreaH + (contentH - imgH) / 2 + 0.15;

  slide.addImage({ data: pngDataUrl, x, y, w: imgW, h: imgH });
  return true;
}

/** Adds a single title-only slide, used both for empty documents and for
 * decks where every visual failed to resolve, so the produced PPTX is never
 * empty. */
function addTitleOnlySlide(pptx: PptxGenJS, title: string): void {
  const slide = pptx.addSlide();
  slide.addText(title || "Untitled document", {
    x: 1,
    y: 2.5,
    w: SLIDE_W - 2,
    h: 1.5,
    fontSize: 32,
    bold: true,
    align: "center",
    color: "1a1a2e",
  });
}

/**
 * Produces a PPTX deck with one slide per visual in the document.
 *
 * The nearest preceding heading (scanning backwards from each visual) is used
 * as the slide title. If a document has no visuals — or every visual fails to
 * resolve into an actual slide (unresolved SVG, zero-area viewBox, etc.) — a
 * single title-only slide is emitted instead, so the produced PPTX is never
 * empty.
 *
 * @param blocks   Output of {@link collectDocumentBlocks}
 * @param title    Document title — used for the title-only fallback slide
 * @param getSvg   Callback to resolve a live SVGSVGElement for a given visualId
 */
export async function exportDocumentAsPPTX(
  blocks: DocumentBlock[],
  title: string,
  getSvg: (visualId: string) => SVGSVGElement | null,
): Promise<Blob | null> {
  try {
    const { default: PptxGenJS } = await import("pptxgenjs");
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";

    // Collect visuals with their nearest preceding heading
    type VisualEntry = {
      block: DocumentVisualBlock;
      heading: string | null;
    };

    const entries: VisualEntry[] = [];
    let lastHeading: string | null = null;

    for (const block of blocks) {
      if (block.kind === "text" && block.blockType === "heading") {
        lastHeading = block.text.trim() || null;
      } else if (block.kind === "visual") {
        entries.push({ block, heading: lastHeading });
      }
    }

    let slidesAdded = 0;
    for (const { block, heading } of entries) {
      const svg = getSvg(block.visualId);
      if (!svg) continue;
      if (await addVisualSlide(pptx, svg, heading, block.visual)) {
        slidesAdded++;
      }
    }

    // Emit a title-only slide whenever no visual slide actually made it into
    // the deck — whether because there were no visuals at all, or because
    // every one of them failed to resolve — so the deck is never empty.
    if (slidesAdded === 0) {
      addTitleOnlySlide(pptx, title);
    }

    const arrayBuffer = (await pptx.write({
      outputType: "arraybuffer",
    })) as ArrayBuffer;

    return new Blob([arrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Infographic export (browser-only)
// ---------------------------------------------------------------------------

/**
 * Options for the infographic composer.
 *
 * Most callers will only need to adjust `width` and `watermark`; the rest of
 * the visual design is controlled by {@link InfographicConfig}.
 */
export interface InfographicExportOptions {
  /**
   * Layout + typography configuration. Defaults to
   * {@link DEFAULT_INFOGRAPHIC_CONFIG} (1080 px, white background).
   */
  config?: InfographicConfig;
  /**
   * When `true`, stamp a "TextIQ" watermark on the finished image.
   * Defaults to `false`. Callers should use export-policy.ts to derive this
   * value from the user's plan entitlements.
   */
  watermark?: boolean;
  /**
   * When `"pdf"`, wrap the finished PNG in a single-page PDF whose dimensions
   * match the image exactly. Defaults to `"png"`.
   */
  outputFormat?: "png" | "pdf";
}

/**
 * Draws a string onto the canvas context with automatic word-wrapping.
 *
 * Returns the number of lines drawn (useful for callers that need to advance
 * the y cursor by the actual rendered height).
 */
function canvasWrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = text.split(" ");
  let line = "";
  let lineCount = 0;
  let curY = y;

  for (let i = 0; i < words.length; i++) {
    const testLine = line + (line ? " " : "") + words[i];
    const { width } = ctx.measureText(testLine);
    if (width > maxWidth && line !== "") {
      ctx.fillText(line, x, curY);
      line = words[i];
      curY += lineHeight;
      lineCount++;
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(line, x, curY);
    lineCount++;
  }
  return lineCount;
}

/**
 * Converts a PNG Blob to an HTMLImageElement (browser-only).
 */
function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    img.src = url;
  });
}

/**
 * Composes all document blocks (text + visuals) into one tall PNG — and
 * optionally wraps it in a single-page PDF.
 *
 * Layout:
 * - Blocks are stacked vertically in document reading order.
 * - Text blocks (headings, paragraphs, quotes, list items, HR) are drawn with
 *   the Canvas 2D text API using the font sizes in `config`.
 * - Visual blocks are rasterised via the existing per-visual `exportPNG` path
 *   and drawn onto the composed canvas at the computed y-offset.
 * - The full layout geometry is computed by the pure
 *   {@link computeInfographicLayout} function before any drawing occurs.
 * - A "TextIQ" watermark is stamped in the bottom-right corner when
 *   `options.watermark` is `true` (derived via export-policy.ts).
 *
 * @param blocks        Output of {@link collectDocumentBlocks}
 * @param title         Document title — informational; callers may prepend it
 *                      as an H1 block in `blocks` before calling.
 * @param getSvg        Callback to resolve a live SVGSVGElement by `visualId`
 * @param options       Composer options (config, watermark, output format)
 */
export async function exportDocumentAsInfographic(
  blocks: DocumentBlock[],
  title: string,
  getSvg: (visualId: string) => SVGSVGElement | null,
  options: InfographicExportOptions = {},
): Promise<Blob | null> {
  // title is retained in the signature for future use (e.g., metadata)
  void title;

  try {
    const config: InfographicConfig =
      options.config ?? DEFAULT_INFOGRAPHIC_CONFIG;
    const addWatermark = options.watermark ?? false;
    const outputFormat = options.outputFormat ?? "png";

    // ── 1. Collect visual dimensions from live SVG viewBoxes ──────────────
    const visualDimensions: Record<string, { width: number; height: number }> =
      {};
    for (const block of blocks) {
      if (block.kind === "visual") {
        const svg = getSvg(block.visualId);
        if (svg) {
          const vb = svg.viewBox.baseVal;
          if (vb.width > 0 && vb.height > 0) {
            visualDimensions[block.visualId] = {
              width: vb.width,
              height: vb.height,
            };
          }
        }
      }
    }

    // ── 2. Compute layout ─────────────────────────────────────────────────
    const layoutConfig: InfographicConfig = { ...config, visualDimensions };
    const layout = computeInfographicLayout(blocks, layoutConfig);
    const { contentWidth, totalHeight } = layout;

    // ── 3. Create canvas ──────────────────────────────────────────────────
    const canvas = document.createElement("canvas");
    canvas.width = config.width;
    canvas.height = totalHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Background fill
    ctx.fillStyle = config.background ?? "#ffffff";
    ctx.fillRect(0, 0, config.width, totalHeight);

    // ── 4. Draw each block ────────────────────────────────────────────────
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const bl = layout.blocks[i];
      const x = config.paddingX;
      const y = bl.y;

      if (block.kind === "visual") {
        const svg = getSvg(block.visualId);
        if (!svg) continue;

        const pngBlob = await exportPNG(svg, {
          background: "include",
          colorMode: "color",
          scale: 2,
        });
        if (!pngBlob) continue;

        try {
          const img = await blobToImage(pngBlob);
          ctx.drawImage(img, x, y, contentWidth, bl.height);
        } catch {
          // Skip this visual if rendering fails
        }
        continue;
      }

      if (block.kind === "table") {
        const fs = config.fontBody;
        ctx.save();
        ctx.font = `${fs}px sans-serif`;
        ctx.fillStyle = config.textColor ?? "#15171a";
        canvasWrapText(
          ctx,
          documentTableBlockToMarkdown(block),
          x,
          y + fs,
          contentWidth,
          fs * config.lineHeight,
        );
        ctx.restore();
        continue;
      }

      // Text block
      const { blockType, text, level } = block;

      if (blockType === "hr") {
        ctx.save();
        ctx.strokeStyle = config.mutedColor ?? "#54666d";
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y + 0.5);
        ctx.lineTo(x + contentWidth, y + 0.5);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      if (!text.trim()) continue;

      if (blockType === "heading") {
        const fs =
          level === 1
            ? config.fontH1
            : level === 2
              ? config.fontH2
              : config.fontH3;
        ctx.save();
        ctx.font = `bold ${fs}px sans-serif`;
        ctx.fillStyle = config.headingColor ?? "#1a1a2e";
        canvasWrapText(
          ctx,
          text,
          x,
          y + fs,
          contentWidth,
          fs * config.lineHeight,
        );
        ctx.restore();
      } else if (blockType === "quote") {
        const indent = Math.round(config.paddingX * 0.25);
        const quoteW = contentWidth - Math.round(config.paddingX * 0.5);
        const fs = config.fontBody;
        ctx.save();
        // Left accent bar
        ctx.fillStyle = config.headingColor ?? "#1a1a2e";
        ctx.globalAlpha = 0.25;
        ctx.fillRect(x, y, 4, bl.height);
        ctx.globalAlpha = 1;
        ctx.font = `italic ${fs}px sans-serif`;
        ctx.fillStyle = config.mutedColor ?? "#54666d";
        canvasWrapText(
          ctx,
          text,
          x + indent,
          y + fs,
          quoteW - indent,
          fs * config.lineHeight,
        );
        ctx.restore();
      } else if (blockType === "listitem") {
        const bulletIndent = 32;
        const fs = config.fontBody;
        ctx.save();
        ctx.font = `${fs}px sans-serif`;
        ctx.fillStyle = config.textColor ?? "#15171a";
        // Bullet dot
        ctx.beginPath();
        const dotR = Math.max(3, fs * 0.15);
        ctx.arc(
          x + dotR + 2,
          y + fs * config.lineHeight * 0.5,
          dotR,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        canvasWrapText(
          ctx,
          text,
          x + bulletIndent,
          y + fs,
          contentWidth - bulletIndent,
          fs * config.lineHeight,
        );
        ctx.restore();
      } else {
        // paragraph (default)
        const fs = config.fontBody;
        ctx.save();
        ctx.font = `${fs}px sans-serif`;
        ctx.fillStyle = config.textColor ?? "#15171a";
        canvasWrapText(
          ctx,
          text,
          x,
          y + fs,
          contentWidth,
          fs * config.lineHeight,
        );
        ctx.restore();
      }
    }

    // ── 5. Watermark ──────────────────────────────────────────────────────
    if (addWatermark) {
      const wFontSize = Math.max(14, Math.round(config.fontBody * 0.7));
      const wPad = Math.round(wFontSize * 0.8);
      ctx.save();
      ctx.font = `${wFontSize}px sans-serif`;
      ctx.fillStyle = "rgba(100,100,100,0.45)";
      ctx.textAlign = "right";
      ctx.fillText("TextIQ", config.width - wPad, totalHeight - wPad);
      ctx.restore();
    }

    // ── 6. Produce output blob ────────────────────────────────────────────
    const pngBlob: Blob | null = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/png");
    });

    if (!pngBlob) return null;

    if (outputFormat === "pdf") {
      // Wrap the PNG in a single-page PDF sized to the image.
      const pngDataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(pngBlob);
      });

      const { jsPDF } = await import("jspdf");
      const widthMM = (config.width * 25.4) / 96;
      const heightMM = (totalHeight * 25.4) / 96;

      const pdf = new jsPDF({
        orientation: config.width >= totalHeight ? "landscape" : "portrait",
        unit: "mm",
        format: [widthMM, heightMM],
      });
      pdf.addImage(pngDataUrl, "PNG", 0, 0, widthMM, heightMM);
      return pdf.output("blob");
    }

    return pngBlob;
  } catch {
    return null;
  }
}

// Re-export layout helpers so downstream UI can build width-preset controls.
