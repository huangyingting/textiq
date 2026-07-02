"use client";

import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { SlideCanvasVNext } from "@/components/presentation-vnext/slide-canvas";
import { loadSlideFonts } from "@/lib/presentation-shared/slide-font-loading";

import { resolveDeckAssetSource } from "./deck-asset-source";
import { resolveDeckRenderTree } from "./render-resolver";
import type { ResolvedSlideRenderTree } from "./render-tree";
import type { DeckV7 } from "./schema";
import type { ThemePackageV1 } from "./theme-package-schema";
import { resolveThemePackageForDeck } from "./theme-package-registry";
import {
  exportDeckV7Raster,
  type ExportDeckV7RasterOptions,
  type RasterExportResult,
  type RasterSlideDimensions,
} from "./raster-export";

/* node:coverage disable -- Browser DOM/React rasterization is exercised manually through the vNext export menu. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.allSettled(
    images.map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        image.onload = () => resolve();
        image.onerror = () => resolve();
      });
    }),
  );
}

function inlineComputedStyles(source: Element, clone: Element): void {
  const computed = window.getComputedStyle(source);
  const cloneElement = clone as HTMLElement;
  for (const property of computed) {
    cloneElement.style.setProperty(
      property,
      computed.getPropertyValue(property),
      computed.getPropertyPriority(property),
    );
  }

  Array.from(source.children).forEach((child, index) => {
    const cloneChild = clone.children.item(index);
    if (cloneChild) inlineComputedStyles(child, cloneChild);
  });
}

function drawSvgToPngDataUrl(
  svg: string,
  dimensions: RasterSlideDimensions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = dimensions.widthPx;
        canvas.height = dimensions.heightPx;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas 2D context unavailable");
        context.drawImage(image, 0, 0, dimensions.widthPx, dimensions.heightPx);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Slide raster image failed to load"));
    };
    image.src = url;
  });
}

export async function renderSlideV7ToPng(
  deck: DeckV7,
  slide: ResolvedSlideRenderTree,
  dimensions: RasterSlideDimensions,
): Promise<string> {
  await loadSlideFonts();

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = `${dimensions.widthPx}px`;
  host.style.height = `${dimensions.heightPx}px`;
  host.style.pointerEvents = "none";
  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    root.render(
      createElement(SlideCanvasVNext, {
        slide,
        canvas: deck.canvas,
        assetResolver: (assetId: string) =>
          resolveDeckAssetSource(deck, assetId),
        preview: true,
      }),
    );
    await nextFrame();
    await nextFrame();
    await waitForImages(host);

    const rendered = host.firstElementChild;
    if (!rendered) throw new Error("Slide render produced no DOM");
    const clone = rendered.cloneNode(true) as Element;
    inlineComputedStyles(rendered, clone);
    const html = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.widthPx}" height="${dimensions.heightPx}" viewBox="0 0 ${dimensions.widthPx} ${dimensions.heightPx}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
    return await drawSvgToPngDataUrl(svg, dimensions);
  } finally {
    root.unmount();
    host.remove();
  }
}

export async function exportDeckV7RasterBrowser(
  deck: DeckV7,
  themePackage?: ThemePackageV1,
  options: Omit<ExportDeckV7RasterOptions, "themePackage"> = {},
): Promise<RasterExportResult> {
  const resolvedThemePackage =
    themePackage ?? resolveThemePackageForDeck(deck).package;
  const renderTree = resolveDeckRenderTree(deck, resolvedThemePackage);
  return exportDeckV7Raster(
    deck,
    (slide, dimensions) => renderSlideV7ToPng(deck, slide, dimensions),
    {
      ...options,
      themePackage: resolvedThemePackage,
      resolveRenderTree: () => renderTree,
    },
  );
}
/* node:coverage enable */
