"use client";

import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { SlideCanvas } from "@/components/presentation/slide-canvas";
import { loadSlideFonts } from "@/lib/presentation/slide-font-loading";

import { resolveDeckAssetSource } from "./deck-asset-source";
import { resolveDeckRenderTree } from "./render-resolver";
import type {
  ResolvedRenderNode,
  ResolvedSlideRenderTree,
} from "./render-tree";
import type { Deck } from "./schema";
import type { ThemePackageV1 } from "./theme-package-schema";
import { resolveThemePackageForDeck } from "./theme-package-registry";
import {
  exportDeckRaster,
  type ExportDeckRasterOptions,
  type RasterExportResult,
  type RasterSlideDimensions,
} from "./raster-export";

/* node:coverage ignore next 34 */
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

/**
 * Converts an ArrayBuffer + MIME type to a base64 data URI.
 * Uses ArrayBuffer (not FileReader) so it works in both browser
 * and Node.js test environments.
 */
export function arrayBufferToDataUrl(
  buffer: ArrayBuffer,
  mimeType: string,
): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/**
 * For every <img> in `root` whose src is not already a data: URI, fetches
 * the resource (same-origin with credentials) and replaces the src with a
 * base64 data URI so it cannot taint a canvas during SVG rasterization.
 * Best-effort per image: a fetch failure leaves the original src unchanged.
 *
 * Also inlines single-URL background-image values copied verbatim by
 * inlineComputedStyles. NOTE: Complex background-image expressions that
 * combine a url() with a gradient or multiple URLs are not inlined here —
 * any external url() within such expressions will still taint the canvas.
 */
export async function inlineImageSources(root: Element): Promise<void> {
  await Promise.all(
    Array.from(root.querySelectorAll("img")).map(async (img) => {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) return;
      try {
        const response = await fetch(src, { credentials: "include" });
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        img.src = arrayBufferToDataUrl(buffer, blob.type || "image/png");
        img.removeAttribute("crossorigin");
        img.removeAttribute("srcset");
      } catch {
        // Best-effort: on fetch failure leave the original src intact.
      }
    }),
  );

  await Promise.all(
    Array.from(root.querySelectorAll("*")).map(async (el) => {
      const htmlEl = el as HTMLElement;
      const bgImage = htmlEl.style?.backgroundImage;
      if (!bgImage) return;
      const match = bgImage.match(/^url\(["']?([^"')]+)["']?\)$/);
      if (!match?.[1]) return;
      const url = match[1];
      if (url.startsWith("data:")) return;
      try {
        const response = await fetch(url, { credentials: "include" });
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        htmlEl.style.backgroundImage = `url("${arrayBufferToDataUrl(buffer, blob.type || "image/png")}")`;
      } catch {
        // Best-effort: on fetch failure leave the original background-image intact.
      }
    }),
  );
}

/* node:coverage ignore next 28 */
export function selectedNodeBounds(
  nodes: readonly ResolvedRenderNode[],
  selectedIds: ReadonlySet<string>,
): { x: number; y: number; w: number; h: number } | null {
  const frames: { x: number; y: number; w: number; h: number }[] = [];
  const visit = (node: ResolvedRenderNode): void => {
    if (selectedIds.has(node.id)) frames.push(node.layout.frame);
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  if (frames.length === 0) return null;
  const left = Math.max(0, Math.min(...frames.map((frame) => frame.x)));
  const top = Math.max(0, Math.min(...frames.map((frame) => frame.y)));
  const right = Math.min(
    100,
    Math.max(...frames.map((frame) => frame.x + frame.w)),
  );
  const bottom = Math.min(
    100,
    Math.max(...frames.map((frame) => frame.y + frame.h)),
  );
  return {
    x: left,
    y: top,
    w: Math.max(1, right - left),
    h: Math.max(1, bottom - top),
  };
}

/* node:coverage ignore next 18 */
function removeUnselectedNodes(
  clone: Element,
  selectedIds: ReadonlySet<string>,
) {
  clone.querySelectorAll("[data-node-id]").forEach((element) => {
    const id = element.getAttribute("data-node-id");
    if (!id || !selectedIds.has(id)) return;
    let current: Element | null = element;
    while (current && current !== clone.parentElement) {
      current.setAttribute("data-copy-keep", "true");
      if (current === clone) break;
      current = current.parentElement;
    }
  });
  clone.querySelectorAll("[data-node-id]").forEach((element) => {
    if (element.getAttribute("data-copy-keep") !== "true") element.remove();
  });
}

/* node:coverage ignore next 10 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [metadata, base64] = dataUrl.split(",", 2);
  const type = metadata.match(/^data:([^;]+)/)?.[1] ?? "image/png";
  const binary = atob(base64 ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type });
}

/* node:coverage ignore next 155 */
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

export async function renderSlideToPng(
  deck: Deck,
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
      createElement(SlideCanvas, {
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
    await inlineImageSources(clone);
    const html = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.widthPx}" height="${dimensions.heightPx}" viewBox="0 0 ${dimensions.widthPx} ${dimensions.heightPx}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
    return await drawSvgToPngDataUrl(svg, dimensions);
  } finally {
    root.unmount();
    host.remove();
  }
}

export async function renderSelectedNodesToPngBlob(
  deck: Deck,
  slide: ResolvedSlideRenderTree,
  selectedNodeIds: readonly string[],
  dimensions: RasterSlideDimensions,
): Promise<Blob | null> {
  const selectedIds = new Set(selectedNodeIds);
  if (selectedIds.size === 0) return null;
  const bounds = selectedNodeBounds(slide.nodes, selectedIds);
  if (!bounds) return null;

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
      createElement(SlideCanvas, {
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
    await inlineImageSources(clone);
    removeUnselectedNodes(clone, selectedIds);

    const cropX = Math.floor((bounds.x / 100) * dimensions.widthPx);
    const cropY = Math.floor((bounds.y / 100) * dimensions.heightPx);
    const cropWidth = Math.ceil((bounds.w / 100) * dimensions.widthPx);
    const cropHeight = Math.ceil((bounds.h / 100) * dimensions.heightPx);
    const html = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cropWidth}" height="${cropHeight}" viewBox="0 0 ${cropWidth} ${cropHeight}"><foreignObject x="${-cropX}" y="${-cropY}" width="${dimensions.widthPx}" height="${dimensions.heightPx}">${html}</foreignObject></svg>`;
    return dataUrlToBlob(
      await drawSvgToPngDataUrl(svg, {
        ...dimensions,
        widthPx: cropWidth,
        heightPx: cropHeight,
      }),
    );
  } finally {
    root.unmount();
    host.remove();
  }
}

export async function exportDeckRasterBrowser(
  deck: Deck,
  themePackage?: ThemePackageV1,
  options: Omit<ExportDeckRasterOptions, "themePackage"> = {},
): Promise<RasterExportResult> {
  const resolvedThemePackage =
    themePackage ?? resolveThemePackageForDeck(deck).package;
  const renderTree = resolveDeckRenderTree(deck, resolvedThemePackage);
  return exportDeckRaster(
    deck,
    (slide, dimensions) => renderSlideToPng(deck, slide, dimensions),
    {
      ...options,
      themePackage: resolvedThemePackage,
      resolveRenderTree: () => renderTree,
    },
  );
}
