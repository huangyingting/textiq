import { slideFormatConfig } from "@/lib/presentation-shared/slide-format";

import type { PresentationDiagnostic } from "./diagnostics";
import { buildExportSpec } from "./export-spec";
import type { ExportDeckSpec } from "./export-spec";
import { resolveDeckRenderTree } from "./render-resolver";
import type {
  ResolvedDeckRenderTree,
  ResolvedSlideRenderTree,
} from "./render-tree";
import type { DeckV7 } from "./schema";
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

export interface ExportDeckV7RasterOptions {
  themePackage?: ThemePackageV1;
  widthPx?: number;
  resolveRenderTree?: (
    deck: DeckV7,
    themePackage: ThemePackageV1,
  ) => ResolvedDeckRenderTree;
  buildSpec?: (renderTree: ResolvedDeckRenderTree) => ExportDeckSpec;
}

function isNativePhysicalFormat(format: string): format is "16:9" | "4:3" {
  return format === "16:9" || format === "4:3";
}

export function resolveRasterSlideDimensions(
  deck: DeckV7,
  widthPx = DEFAULT_RASTER_WIDTH_PX,
): RasterSlideDimensions {
  const format = isNativePhysicalFormat(deck.canvas.format)
    ? deck.canvas.format
    : "16:9";
  const config = slideFormatConfig(format);
  const aspectRatio =
    deck.canvas.width > 0 && deck.canvas.height > 0
      ? deck.canvas.width / deck.canvas.height
      : config.width / config.height;

  return {
    widthPx,
    heightPx: Math.round(widthPx / aspectRatio),
    widthIn: config.pptxWidthIn,
    heightIn: config.pptxHeightIn,
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

export async function exportDeckV7Raster(
  deck: DeckV7,
  renderSlideToPng: RenderSlideToPng,
  options: ExportDeckV7RasterOptions = {},
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
