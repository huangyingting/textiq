import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import JSZip from "jszip";

import {
  DEFAULT_EXPORT_OPTIONS,
  downloadBlob,
  exportPDF,
  exportPNG,
  exportPPTX,
} from "@/lib/visual/export";
import { FIXTURES } from "@/lib/visual/fixtures";

const ORIGINALS = {
  document: globalThis.document,
  Image: globalThis.Image,
  FileReader: globalThis.FileReader,
  XMLSerializer: globalThis.XMLSerializer,
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
};

const BASE_SVG =
  '<svg viewBox="0 0 100 50" width="100" height="50"><rect width="100" height="50" fill="#fff"/><circle cx="50" cy="25" r="10"/></svg>';

function canvasContext(context: unknown): CanvasRenderingContext2D {
  return context as unknown as CanvasRenderingContext2D;
}

function imageConstructor(image: unknown): typeof Image {
  return image as unknown as typeof Image;
}

function fileReaderConstructor(fileReader: unknown): typeof FileReader {
  return fileReader as unknown as typeof FileReader;
}

function browserDocument(document: unknown): Document {
  return document as unknown as Document;
}

function svgElement(width = 100, height = 50): SVGSVGElement {
  return {
    viewBox: { baseVal: { width, height } },
  } as SVGSVGElement;
}

async function slideXml(blob: Blob, n: number): Promise<string> {
  const buffer = Buffer.from(await blob.arrayBuffer());
  const zip = await JSZip.loadAsync(buffer);
  return zip.files[`ppt/slides/slide${n}.xml`]!.async("string");
}

function installBrowserStubs(
  options: {
    svg?: string;
    context?: CanvasRenderingContext2D | null;
    imageError?: boolean;
    drawImageError?: boolean;
    toBlobError?: boolean;
    downloadClickError?: boolean;
  } = {},
) {
  const calls = {
    appended: 0,
    removed: 0,
    clicked: 0,
    revoked: [] as string[],
    objectUrlBlobs: [] as Blob[],
    scaled: [] as Array<[number, number]>,
    drawn: [] as Array<[number, number, number, number]>,
    blobType: "",
  };
  const context =
    options.context === undefined
      ? canvasContext({
          scale: (x: number, y: number) => calls.scaled.push([x, y]),
          drawImage: (
            _image: unknown,
            x: number,
            y: number,
            w: number,
            h: number,
          ) => {
            if (options.drawImageError) {
              throw new DOMException("Canvas is tainted", "SecurityError");
            }
            calls.drawn.push([x, y, w, h]);
          },
        })
      : options.context;

  globalThis.XMLSerializer = class {
    serializeToString() {
      return options.svg ?? BASE_SVG;
    }
  } as typeof XMLSerializer;

  globalThis.Image = imageConstructor(
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => {
          if (options.imageError) {
            this.onerror?.();
          } else {
            this.onload?.();
          }
        });
      }
    },
  );

  globalThis.FileReader = fileReaderConstructor(
    class {
      result: string | ArrayBuffer | null = null;
      onloadend: (() => void) | null = null;

      readAsDataURL(_blob: Blob) {
        this.result =
          "data:image/png;base64," +
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
        queueMicrotask(() => this.onloadend?.());
      }
    },
  );

  globalThis.document = browserDocument({
    createElement(tag: string) {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => context,
          toBlob(callback: BlobCallback, type?: string) {
            if (options.toBlobError) {
              throw new DOMException("Canvas is tainted", "SecurityError");
            }
            calls.blobType = type ?? "";
            callback(new Blob(["png"], { type }));
          },
        };
      }
      return {
        href: "",
        download: "",
        click: () => {
          calls.clicked++;
          if (options.downloadClickError) {
            throw new Error("download blocked");
          }
        },
      };
    },
    body: {
      appendChild: () => calls.appended++,
      removeChild: () => calls.removed++,
    },
  });

  URL.createObjectURL = (blob: Blob | MediaSource) => {
    if (blob instanceof Blob) {
      calls.objectUrlBlobs.push(blob);
    }
    return "blob:visual-export";
  };
  URL.revokeObjectURL = (url: string) => calls.revoked.push(url);

  return calls;
}

afterEach(() => {
  globalThis.document = ORIGINALS.document;
  globalThis.Image = ORIGINALS.Image;
  globalThis.FileReader = ORIGINALS.FileReader;
  globalThis.XMLSerializer = ORIGINALS.XMLSerializer;
  URL.createObjectURL = ORIGINALS.createObjectURL;
  URL.revokeObjectURL = ORIGINALS.revokeObjectURL;
});

test("exportPNG rasterizes the transformed SVG at the requested scale", async () => {
  const calls = installBrowserStubs();
  const blob = await exportPNG(svgElement(), {
    ...DEFAULT_EXPORT_OPTIONS,
    scale: 3,
    background: "custom",
    customBackground: "#112233",
  });

  assert.ok(blob);
  assert.equal(blob.type, "image/png");
  assert.deepEqual(calls.scaled, [[3, 3]]);
  assert.deepEqual(calls.drawn, [[0, 0, 100, 50]]);
  assert.deepEqual(calls.revoked, ["blob:visual-export"]);
  assert.equal(calls.blobType, "image/png");
});

test("exportPNG sizes the serialized SVG to the letterboxed raster canvas", async () => {
  const calls = installBrowserStubs({
    svg: '<svg viewBox="0 0 100 50" width="stale" height="stale"><rect width="100" height="50"/></svg>',
  });

  const blob = await exportPNG(svgElement(), {
    ...DEFAULT_EXPORT_OPTIONS,
    aspectRatio: "1:1",
    scale: 1,
  });

  assert.ok(blob);
  assert.equal(calls.objectUrlBlobs.length, 1);
  const transformedSvg = await calls.objectUrlBlobs[0].text();
  assert.match(transformedSvg, /<svg\b[^>]* width="100" height="100"/);
  assert.ok(transformedSvg.includes('data-letterbox="true"'));
  assert.deepEqual(calls.drawn, [[0, 0, 100, 100]]);
});

test("exportPNG returns null for zero-sized or unrasterizable inputs", async () => {
  installBrowserStubs();
  assert.equal(await exportPNG(svgElement(0, 50)), null);

  installBrowserStubs({ context: null });
  assert.equal(await exportPNG(svgElement()), null);

  installBrowserStubs({ imageError: true });
  assert.equal(await exportPNG(svgElement()), null);
});

test("exportPNG contains asynchronous canvas exceptions and revokes its object URL", async () => {
  const drawFailure = installBrowserStubs({ drawImageError: true });
  assert.equal(await exportPNG(svgElement()), null);
  assert.deepEqual(drawFailure.revoked, ["blob:visual-export"]);

  const blobFailure = installBrowserStubs({ toBlobError: true });
  assert.equal(await exportPNG(svgElement()), null);
  assert.deepEqual(blobFailure.revoked, ["blob:visual-export"]);
});

test("downloadBlob appends, clicks, removes, and revokes the temporary anchor", () => {
  const calls = installBrowserStubs();
  downloadBlob(new Blob(["svg"], { type: "image/svg+xml" }), "diagram.svg");

  assert.equal(calls.appended, 1);
  assert.equal(calls.clicked, 1);
  assert.equal(calls.removed, 1);
  assert.deepEqual(calls.revoked, ["blob:visual-export"]);
});

test("downloadBlob removes its anchor and revokes its URL when the browser blocks the click", () => {
  const calls = installBrowserStubs({ downloadClickError: true });

  assert.throws(
    () =>
      downloadBlob(new Blob(["svg"], { type: "image/svg+xml" }), "diagram.svg"),
    /download blocked/,
  );
  assert.equal(calls.appended, 1);
  assert.equal(calls.removed, 1);
  assert.deepEqual(calls.revoked, ["blob:visual-export"]);
});

test("exportPDF embeds a rasterized PNG on a matching PDF page", async () => {
  const calls = installBrowserStubs();
  const blob = await exportPDF(svgElement(120, 80), {
    ...DEFAULT_EXPORT_OPTIONS,
    scale: 1,
  });

  assert.ok(blob);
  assert.equal(blob.type, "application/pdf");
  assert.deepEqual(calls.scaled, [[2, 2]]);
});

test("exportPDF returns null when the source SVG has no drawable area", async () => {
  installBrowserStubs();
  assert.equal(
    await exportPDF(svgElement(0, 80), DEFAULT_EXPORT_OPTIONS),
    null,
  );
});

test("exportPDF returns null when PNG rasterization fails", async () => {
  installBrowserStubs({ context: null });
  assert.equal(
    await exportPDF(svgElement(120, 80), DEFAULT_EXPORT_OPTIONS),
    null,
  );
});

test("exportPPTX returns null when the source SVG has no drawable area", async () => {
  installBrowserStubs();
  assert.equal(
    await exportPPTX(svgElement(120, 0), undefined, DEFAULT_EXPORT_OPTIONS),
    null,
  );
});

test("exportPPTX uses native shapes for supported visual payloads", async () => {
  const calls = installBrowserStubs();
  const blob = await exportPPTX(
    svgElement(120, 80),
    FIXTURES.flowchart,
    DEFAULT_EXPORT_OPTIONS,
  );

  assert.ok(blob);
  assert.equal(
    blob.type,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
  assert.deepEqual(calls.scaled, [], "native PPTX must not rasterize defaults");
});

test("exportPPTX deliberately falls back to raster when native cannot honor export options", async () => {
  const calls = installBrowserStubs();
  const blob = await exportPPTX(svgElement(120, 80), FIXTURES.flowchart, {
    ...DEFAULT_EXPORT_OPTIONS,
    background: "custom",
    customBackground: "#112233",
    colorMode: "mono",
    aspectRatio: "1:1",
    padding: 10,
  });

  assert.ok(blob);
  assert.equal(
    blob.type,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
  assert.deepEqual(calls.scaled, [[2, 2]]);
  assert.equal(calls.objectUrlBlobs.length, 1);
  const transformedSvg = await calls.objectUrlBlobs[0].text();
  assert.match(transformedSvg, /data-export-bg="true"/);
  assert.match(transformedSvg, /__export_mono__/);
  assert.match(transformedSvg, /data-letterbox="true"/);
});

test("exportPPTX raster fallback sizes the image from the transformed export canvas", async () => {
  installBrowserStubs();
  const blob = await exportPPTX(svgElement(120, 80), FIXTURES.flowchart, {
    ...DEFAULT_EXPORT_OPTIONS,
    background: "custom",
    customBackground: "#112233",
    aspectRatio: "1:1",
    padding: 10,
  });

  assert.ok(blob);
  const xml = await slideXml(blob, 1);
  const imageExt = xml.match(
    /<p:pic>[\s\S]*?<p:spPr>[\s\S]*?<a:xfrm>[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"/,
  );

  assert.ok(imageExt, "expected fallback image dimensions in slide XML");
  assert.equal(imageExt[1], "6172200");
  assert.equal(imageExt[2], "6172200");
});

test("exportPPTX raster fallback respects portrait aspect ratio placement", async () => {
  installBrowserStubs();
  const blob = await exportPPTX(svgElement(120, 80), FIXTURES.flowchart, {
    ...DEFAULT_EXPORT_OPTIONS,
    aspectRatio: "9:16",
  });

  assert.ok(blob);
  const xml = await slideXml(blob, 1);
  const imageExt = xml.match(
    /<p:pic>[\s\S]*?<p:spPr>[\s\S]*?<a:xfrm>[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"/,
  );

  assert.ok(imageExt, "expected fallback image dimensions in slide XML");
  assert.equal(imageExt[2], "6172200");
  assert.ok(
    Math.abs(Number(imageExt[1]) / Number(imageExt[2]) - 9 / 16) < 0.001,
    "fallback image should preserve the requested portrait aspect ratio",
  );
});
