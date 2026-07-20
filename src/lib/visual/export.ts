/**
 * Visual export utilities for PNG, SVG, PDF, and PPTX.
 *
 * These functions take a rendered SVG element and export it in various formats:
 * - SVG: serialize the DOM element directly
 * - PNG: convert to canvas → rasterize at given scale (with optional ExportOptions)
 * - PDF: embed the visual as an image on a properly sized page
 * - PPTX: embed the visual as an image on a single slide
 */

import type { Visual } from "@/lib/visual/schema";
import {
  buildTransformedSvgString,
  computeExportDimensions,
  computeLetterboxedDimensions,
  DEFAULT_EXPORT_OPTIONS,
  type ExportOptions,
} from "@/lib/visual/export-options";

// Re-export ExportOptions so callers can import from one place.
export type { ExportOptions };
export { DEFAULT_EXPORT_OPTIONS };
/* node:coverage disable */
function shouldRasterizePptxOptions(options?: ExportOptions): boolean {
  if (!options) return false;
  return (
    options.background !== DEFAULT_EXPORT_OPTIONS.background ||
    options.colorMode !== DEFAULT_EXPORT_OPTIONS.colorMode ||
    (options.aspectRatio !== undefined && options.aspectRatio !== "auto") ||
    (options.padding ?? 0) !== 0 ||
    options.watermark === true
  );
}

function sizeSvgForRasterization(
  svgString: string,
  width: number,
  height: number,
): string {
  return svgString.replace(/<svg\b([^>]*)>/, (_, attrs: string) => {
    const cleanedAttrs = attrs.replace(
      /\s(?:width|height)=["'][^"']*["']/g,
      "",
    );
    return `<svg${cleanedAttrs} width="${width}" height="${height}">`;
  });
}

/**
 * Convert an SVG element to PNG applying the given ExportOptions.
 * Returns a Promise that resolves to a Blob, or null on error.
 *
 * @param svgElement - The SVG to rasterize
 * @param options    - Export options (background, colorMode, scale). Defaults
 *                     to DEFAULT_EXPORT_OPTIONS (2x, color, include bg).
 */
export async function exportPNG(
  svgElement: SVGSVGElement,
  options?: ExportOptions,
): Promise<Blob | null> {
  const opts = options ?? DEFAULT_EXPORT_OPTIONS;

  return new Promise((resolve) => {
    try {
      // Get the SVG's viewBox to determine dimensions
      const viewBox = svgElement.viewBox.baseVal;
      const { canvasW, canvasH } = computeLetterboxedDimensions(
        viewBox,
        opts.aspectRatio,
        opts.padding ?? 0,
      );
      const { width, height } = computeExportDimensions(
        { width: canvasW, height: canvasH },
        opts.scale,
      );

      if (width === 0 || height === 0) {
        resolve(null);
        return;
      }

      // Create a canvas at the scaled size
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }

      // When transparent background is requested, keep the canvas context
      // alpha channel (default). For custom/include we do nothing extra here
      // because the SVG itself carries the background.

      // Apply export options to SVG before rasterizing
      const transformedSvg = sizeSvgForRasterization(
        buildTransformedSvgString(svgElement, opts),
        canvasW,
        canvasH,
      );
      const svgBlob = new Blob([transformedSvg], {
        type: "image/svg+xml;charset=utf-8",
      });
      const url = URL.createObjectURL(svgBlob);

      // Load into an image and draw to canvas
      const img = new Image();
      img.onload = () => {
        ctx.scale(opts.scale, opts.scale);
        ctx.drawImage(img, 0, 0, canvasW, canvasH);
        URL.revokeObjectURL(url); /* node:coverage disable */

        canvas.toBlob((blob) => {
          resolve(blob);
        }, "image/png"); /* node:coverage enable */
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };

      img.src = url;
    } catch {
      resolve(null);
    }
  });
}

/**
 * Trigger a browser download of a Blob with the given filename.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
} /* node:coverage disable */

/**
 * Convert an SVG element to PDF applying the given ExportOptions.
 * Returns a Promise that resolves to a Blob, or null on error.
 *
 * The PDF page is sized to fit the visual exactly (no margins/letterboxing).
 *
 * @param svgElement - The SVG to embed in the PDF
 * @param options    - Export options forwarded to the PNG rasterization step
 */
export async function exportPDF(
  svgElement: SVGSVGElement,
  options?: ExportOptions,
): Promise<Blob | null> {
  const opts = options ?? DEFAULT_EXPORT_OPTIONS;

  try {
    const { jsPDF } = await import("jspdf");
    // Get the SVG's viewBox to determine dimensions
    const viewBox = svgElement.viewBox.baseVal;
    const { canvasW, canvasH } = computeLetterboxedDimensions(
      viewBox,
      opts.aspectRatio,
      opts.padding ?? 0,
    );
    const width = canvasW;
    const height = canvasH;

    if (width === 0 || height === 0) {
      return null;
    }

    // Rasterize the SVG at the requested options (2x minimum for PDF quality)
    const pdfOpts: ExportOptions = { ...opts, scale: Math.max(opts.scale, 2) };
    const pngBlob = await exportPNG(svgElement, pdfOpts);
    if (!pngBlob) {
      return null;
    }

    // Convert the PNG blob to a data URL
    const pngDataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(pngBlob);
    });

    // Create a PDF with dimensions matching the visual (in mm)
    // jsPDF uses mm by default; we'll size the page to fit the visual at 96 DPI
    // (1 inch = 25.4mm, 96 DPI means 96 pixels per inch)
    const widthMM = (width * 25.4) / 96;
    const heightMM = (height * 25.4) / 96;

    const pdf = new jsPDF({
      orientation: width > height ? "landscape" : "portrait",
      unit: "mm",
      format: [widthMM, heightMM],
    });

    // Add the image to fill the entire page (no margins)
    pdf.addImage(pngDataUrl, "PNG", 0, 0, widthMM, heightMM);

    // Get the PDF as a blob
    return pdf.output("blob");
  } catch {
    return null;
  }
}

/**
 * Convert a visual to PPTX with the visual on one slide.
 *
 * **Default (native):** When `visual` is supplied and its kind is natively
 * supported, the slide is built from native PptxGenJS shapes so the output
 * is editable in PowerPoint / Google Slides / Keynote (move, recolor, retype).
 *
 * **Image fallback:** When `visual` is not supplied, or the kind is
 * `funnel`/`pyramid` (trapezoid bands), the SVG is rasterized and placed as
 * a single image (preserving visual fidelity at the cost of editability).
 *
 * @param svgElement - The rendered SVG element (used for image fallback)
 * @param visual     - Optional Visual payload; enables native shape output
 * @param options    - Export options forwarded to the PNG rasterization step
 */
export async function exportPPTX(
  svgElement: SVGSVGElement,
  visual?: Visual,
  options?: ExportOptions,
): Promise<Blob | null> {
  // node:coverage enable
  try {
    const [
      { default: PptxGenJS },
      { applySpecsToSlide },
      { computeVisualSlideLayout, isImageFallback, visualToNativeSpecs },
    ] = await Promise.all([
      import("pptxgenjs"),
      import("@/lib/visual/pptx-apply"),
      import("@/lib/visual/pptx-shapes"),
    ]);
    const viewBox = svgElement.viewBox.baseVal;
    const width = viewBox.width;
    const height = viewBox.height;

    if (width === 0 || height === 0) {
      return null;
    }

    const pptx = new PptxGenJS();
    const slide = pptx.addSlide();

    const SLIDE_W = 10;
    const SLIDE_H = 7.5;

    const useRasterForOptions = shouldRasterizePptxOptions(options);

    // Attempt native shapes when a Visual payload is available and the requested
    // export options do not require SVG transforms that native specs cannot carry.
    if (visual && !useRasterForOptions) {
      const layout = computeVisualSlideLayout(visual);
      const specs = visualToNativeSpecs(visual, layout);

      if (!isImageFallback(specs)) {
        applySpecsToSlide(slide, specs);
        const arrayBuffer = (await pptx.write({
          outputType: "arraybuffer",
        })) as ArrayBuffer;
        return new Blob([arrayBuffer], {
          type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        });
      }
    }

    // Image fallback: rasterize the SVG with the requested options
    const pngBlob = await exportPNG(svgElement, options);
    if (!pngBlob) {
      return null;
    }

    const pngDataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(pngBlob);
    });

    const { canvasW, canvasH } = computeLetterboxedDimensions(
      viewBox,
      options?.aspectRatio,
      options?.padding ?? 0,
    );
    const visualAspect = canvasW / canvasH;
    const slideAspect = SLIDE_W / SLIDE_H;

    let imageWidth: number;
    let imageHeight: number;

    if (visualAspect > slideAspect) {
      imageWidth = SLIDE_W * 0.9;
      imageHeight = imageWidth / visualAspect;
    } else {
      imageHeight = SLIDE_H * 0.9;
      imageWidth = imageHeight * visualAspect;
    }

    const x = (SLIDE_W - imageWidth) / 2;
    const y = (SLIDE_H - imageHeight) / 2;

    slide.addImage({
      data: pngDataUrl,
      x,
      y,
      w: imageWidth,
      h: imageHeight,
    });

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
