import { slideFormatConfig } from "@/lib/presentation/slide-format";

import type { PresentationDiagnostic } from "./diagnostics";
import {
  resolveCanvasAspectRatio,
  resolveCappedCanvasInches,
} from "./export-geometry";
import { buildExportSpec } from "./export-spec";
import type { ExportDeckSpec } from "./export-spec";
import { resolveDeckRenderTree } from "./render-resolver";
import type {
  ResolvedDeckRenderTree,
  ResolvedSlideRenderTree,
} from "./render-tree";
import type { Deck } from "./schema";
import type { ThemePackageV1 } from "./theme-package-schema";
import { resolveThemePackageForDeck } from "./theme-package-registry";

const PDF_MIME = "application/pdf";
const DEFAULT_RASTER_WIDTH_PX = 1920;

export interface RasterSlideDimensions {
  widthPx: number;
  heightPx: number;
  widthIn: number;
  heightIn: number;
}

export interface RasterPngOutput {
  slideId: string;
  dataUrl: string;
}

export interface RasterExportResult {
  pngs: RasterPngOutput[];
  pdfBlob: Blob;
  pdfBytes: Uint8Array;
  pdfPageCount: number;
  diagnostics: PresentationDiagnostic[];
}

export type RenderSlideToPng = (
  slide: ResolvedSlideRenderTree,
  dimensions: RasterSlideDimensions,
) => Promise<string>;

export interface ExportDeckRasterOptions {
  themePackage?: ThemePackageV1;
  widthPx?: number;
  resolveRenderTree?: (
    deck: Deck,
    themePackage: ThemePackageV1,
  ) => ResolvedDeckRenderTree;
  buildSpec?: (renderTree: ResolvedDeckRenderTree) => ExportDeckSpec;
}

function isNativePhysicalFormat(format: string): format is "16:9" | "4:3" {
  return format === "16:9" || format === "4:3";
}

export function resolveRasterSlideDimensions(
  deck: Deck,
  widthPx = DEFAULT_RASTER_WIDTH_PX,
): RasterSlideDimensions {
  const nativeFormat = isNativePhysicalFormat(deck.canvas.format)
    ? deck.canvas.format
    : undefined;
  const config = slideFormatConfig(nativeFormat ?? "16:9");
  const aspectRatio = resolveCanvasAspectRatio(
    deck.canvas.width,
    deck.canvas.height,
    config.width / config.height,
  );
  const physicalSize =
    nativeFormat !== undefined
      ? { widthIn: config.pptxWidthIn, heightIn: config.pptxHeightIn }
      : resolveCappedCanvasInches(deck.canvas.width, deck.canvas.height);

  return {
    widthPx,
    heightPx: Math.round(widthPx / aspectRatio),
    widthIn: physicalSize.widthIn,
    heightIn: physicalSize.heightIn,
  };
}

export async function buildRasterPdfFromPngs(
  pngs: readonly RasterPngOutput[],
  dimensions: RasterSlideDimensions,
): Promise<Pick<RasterExportResult, "pdfBlob" | "pdfBytes" | "pdfPageCount">> {
  const { jsPDF } = await import("jspdf");
  const orientation =
    dimensions.widthIn >= dimensions.heightIn ? "landscape" : "portrait";
  const pdf = new jsPDF({
    orientation,
    unit: "in",
    format: [dimensions.widthIn, dimensions.heightIn],
  });

  pngs.forEach((png, index) => {
    if (index > 0) {
      pdf.addPage([dimensions.widthIn, dimensions.heightIn], orientation);
    }
    pdf.addImage(
      png.dataUrl,
      "PNG",
      0,
      0,
      dimensions.widthIn,
      dimensions.heightIn,
    );
  });

  const arrayBuffer = pdf.output("arraybuffer");
  const pdfBytes = new Uint8Array(arrayBuffer);
  return {
    pdfBlob: new Blob([arrayBuffer], { type: PDF_MIME }),
    pdfBytes,
    pdfPageCount: pngs.length,
  };
}

/**
 * @deprecated Use `exportDeckRasterBrowser` (raster-browser-export.tsx) which
 * builds foreignObject-free native SVGs from the ExportDeckSpec pipeline.
 * This function accepts an arbitrary `renderSlideToPng` callback and is kept
 * for testing the PDF-assembly pipeline (buildRasterPdfFromPngs) without a
 * browser. Do not wire new UI export flows through this function.
 */
export async function exportDeckRaster(
  deck: Deck,
  renderSlideToPng: RenderSlideToPng,
  options: ExportDeckRasterOptions = {},
): Promise<RasterExportResult> {
  const themePackage =
    options.themePackage ?? resolveThemePackageForDeck(deck).package;
  const renderTree = (options.resolveRenderTree ?? resolveDeckRenderTree)(
    deck,
    themePackage,
  );
  const exportSpec = (options.buildSpec ?? buildExportSpec)(renderTree);
  const dimensions = resolveRasterSlideDimensions(deck, options.widthPx);

  const pngs: RasterPngOutput[] = [];
  for (const slide of renderTree.slides) {
    pngs.push({
      slideId: slide.id,
      dataUrl: await renderSlideToPng(slide, dimensions),
    });
  }

  return {
    pngs,
    diagnostics: exportSpec.diagnostics,
    ...(await buildRasterPdfFromPngs(pngs, dimensions)),
  };
}
