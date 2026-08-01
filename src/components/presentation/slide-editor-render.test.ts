import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SlideEditor } from "./slide-editor";
import { PrecisionGuideOverlays } from "./precision-guides-controls";
import {
  buildDeck,
  buildImageNode,
  buildShapeNode,
  buildSlide,
  buildTableNode,
  buildTextNode,
  buildVisualNode,
} from "@/test/builders/presentation-deck";
import {
  createReactRenderHarness,
  withDefaultDom,
} from "@/test/react-render-harness";

function createHookRenderer() {
  return createReactRenderHarness({ idPrefix: "fake-id" });
}

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

type FakeEventTarget = {
  value: string;
  checked: boolean;
  files: File[];
  closest: () => null;
  focus: () => void;
};

function collectElements(node: ReactNode, elements: ReactElement[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, elements);
    return elements;
  }
  if (!isValidElement(node)) return elements;
  elements.push(node);
  collectElements((node.props as { children?: ReactNode }).children, elements);
  return elements;
}

function mixedDeck() {
  return buildDeck([
    buildSlide(
      "content",
      [
        buildTextNode({ id: "text-1", role: "title" }),
        buildShapeNode({ id: "shape-1" }),
        buildImageNode("img-001", { id: "image-1" }),
        buildVisualNode({ id: "visual-1" }),
        buildTableNode({ id: "table-1" }),
      ],
      { id: "slide-1", name: "Mixed slide" },
    ),
    buildSlide("content", [buildTextNode({ id: "text-2" })], {
      id: "slide-2",
      name: "Summary slide",
    }),
  ]);
}

test("SlideEditor renders the full editor shell for mixed slide content", () => {
  const deck = mixedDeck();
  const actionOk = async () => ({ ok: true as const, data: undefined });

  const html = renderToStaticMarkup(
    createElement(SlideEditor, {
      documentId: "doc-render",
      deck,
      onDeckChange: () => undefined,
      onSave: actionOk,
      onClose: () => undefined,
      onPresent: actionOk,
      onShare: actionOk,
      onExportPptx: async () => undefined,
      onUploadImage: async () => ({
        src: "https://example.com/replacement.png",
        assetId: "replacement",
      }),
    }),
  );

  assert.match(html, /Deck tools/);
  assert.match(html, /data-slide-bottom-dock="true"/);
});
test("SlideEditor top-level handlers tolerate no-op editor callbacks", async () => {
  const actionOk = async () => ({ ok: true as const, data: undefined });
  const renderer = createHookRenderer();
  const tree = renderer.run(() =>
    SlideEditor({
      documentId: "doc-render",
      deck: mixedDeck(),
      onDeckChange: () => undefined,
      onSave: actionOk,
      onClose: () => undefined,
      onPresent: actionOk,
      onShare: actionOk,
      onExportPptx: async () => undefined,
      onUploadImage: async () => ({ src: "", assetId: "replacement" }),
    }),
  );

  const previousHTMLElement = Object.getOwnPropertyDescriptor(
    globalThis,
    "HTMLElement",
  );
  const fakeTarget: FakeEventTarget = {
    value: "1",
    checked: true,
    files: [],
    closest: () => null,
    focus: () => undefined,
  };
  const event = {
    key: "Escape",
    button: 0,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    currentTarget: fakeTarget,
    target: fakeTarget,
  };
  let invoked = 0;
  const handlerPromises: Promise<unknown>[] = [];

  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    writable: true,
    value: class TestHTMLElement {},
  });
  try {
    for (const element of collectElements(tree)) {
      const props = element.props as Record<string, unknown>;
      for (const name of ["onClick", "onKeyDown", "onChange"]) {
        const handler = props[name];
        if (typeof handler !== "function") continue;
        const result = handler(event);
        invoked += 1;
        handlerPromises.push(Promise.resolve(result));
      }
    }
    await Promise.all(handlerPromises);
  } finally {
    renderer.cleanup();
    if (previousHTMLElement) {
      Object.defineProperty(globalThis, "HTMLElement", previousHTMLElement);
    } else {
      Reflect.deleteProperty(globalThis, "HTMLElement");
    }
  }

  assert.ok(invoked > 0);
});

test("SlideEditor ignores an image upload that settles after the editor unmounts", async () => {
  const uploadAttempt = deferred<{
    src: string;
    assetId: string;
  }>();
  const changedDecks: unknown[] = [];
  const renderer = createHookRenderer();
  const tree = renderer.run(() =>
    SlideEditor({
      documentId: "doc-late-image",
      deck: mixedDeck(),
      onDeckChange: (deck) => changedDecks.push(deck),
      onUploadImage: () => uploadAttempt.promise,
    }),
  );
  const elements = collectElements(tree);
  const insertImageSurface = elements.find(
    (element) =>
      typeof (element.props as { onInsertImage?: unknown }).onInsertImage ===
      "function",
  );
  assert.ok(insertImageSurface, "expected an insert-image command surface");
  const fileInput = elements.find(
    (element) =>
      element.type === "input" &&
      (element.props as { type?: string }).type === "file" &&
      String((element.props as { accept?: string }).accept).includes(
        "image/png",
      ),
  );
  assert.ok(fileInput, "expected the image file input");

  (insertImageSurface.props as { onInsertImage: () => void }).onInsertImage();
  const target = {
    files: [new File(["image"], "late.png", { type: "image/png" })],
    value: "late.png",
  };
  (fileInput.props as { onChange: (event: unknown) => void }).onChange({
    currentTarget: target,
  });
  assert.equal(target.value, "");
  assert.deepEqual(changedDecks, []);

  renderer.cleanup();
  assert.deepEqual(changedDecks, []);
  uploadAttempt.resolve({
    src: "https://textiq.test/api/slide-assets/late.png",
    assetId: "asset-late",
  });
  await waitForAsyncDrain();
  await waitForAsyncDrain();

  assert.deepEqual(changedDecks, []);
});

test("SlideEditor ignores an image insertion upload after its initiating slide is removed", async () => {
  await withDefaultDom(async () => {
    const uploadAttempt = deferred<{
      src: string;
      assetId: string;
    }>();
    const changedDecks: unknown[] = [];
    const renderer = createHookRenderer();
    const initialDeck = buildDeck([
      buildSlide("content", [], { id: "slide-1" }),
      buildSlide("content", [], { id: "slide-2" }),
    ]);
    const renderEditor = (deck: typeof initialDeck) =>
      renderer.run(() =>
        SlideEditor({
          documentId: "doc-removed-image-target",
          deck,
          onDeckChange: (nextDeck) => changedDecks.push(nextDeck),
          onUploadImage: () => uploadAttempt.promise,
        }),
      );
    try {
      const tree = renderEditor(initialDeck);
      const elements = collectElements(tree);
      const insertImageSurface = elements.find(
        (element) =>
          typeof (element.props as { onInsertImage?: unknown })
            .onInsertImage === "function",
      );
      assert.ok(insertImageSurface, "expected an insert-image command surface");
      const fileInput = elements.find(
        (element) =>
          element.type === "input" &&
          (element.props as { type?: string }).type === "file" &&
          String((element.props as { accept?: string }).accept).includes(
            "image/png",
          ),
      );
      assert.ok(fileInput, "expected the image file input");

      (
        insertImageSurface.props as { onInsertImage: () => void }
      ).onInsertImage();
      const target = {
        files: [
          new File(["image"], "removed-target.png", { type: "image/png" }),
        ],
        value: "removed-target.png",
      };
      (fileInput.props as { onChange: (event: unknown) => void }).onChange({
        currentTarget: target,
      });
      assert.equal(target.value, "");

      renderEditor({
        ...initialDeck,
        slides: initialDeck.slides.filter((slide) => slide.id !== "slide-1"),
      });
      uploadAttempt.resolve({
        src: "https://textiq.test/api/slide-assets/removed-target.png",
        assetId: "asset-removed-target",
      });
      await waitForAsyncDrain();
      await waitForAsyncDrain();

      assert.deepEqual(
        changedDecks,
        [],
        "a removed initiating slide must not receive an orphan asset mutation",
      );
    } finally {
      renderer.cleanup();
    }
  });
});

test("SlideEditor ignores an image replacement upload after its target node is removed", async () => {
  await withDefaultDom(async () => {
    const uploadAttempt = deferred<{
      src: string;
      assetId: string;
    }>();
    const changedDecks: unknown[] = [];
    const renderer = createHookRenderer();
    const initialDeck = mixedDeck();
    const renderEditor = (deck: typeof initialDeck) =>
      renderer.run(() =>
        SlideEditor({
          documentId: "doc-removed-image-node",
          deck,
          onDeckChange: (nextDeck) => changedDecks.push(nextDeck),
          onUploadImage: () => uploadAttempt.promise,
        }),
      );

    try {
      const initialElements = collectElements(renderEditor(initialDeck));
      const canvas = initialElements.find(
        (element) =>
          typeof (element.props as { onNodeFocus?: unknown }).onNodeFocus ===
          "function",
      );
      assert.ok(canvas, "expected the slide canvas focus surface");
      (canvas.props as { onNodeFocus: (nodeId: string) => void }).onNodeFocus(
        "image-1",
      );

      const selectedElements = collectElements(renderEditor(initialDeck));
      const replaceImageSurface = selectedElements.find(
        (element) =>
          typeof (element.props as { onReplaceImage?: unknown })
            .onReplaceImage === "function",
      );
      assert.ok(
        replaceImageSurface,
        "expected the selected-image replacement surface",
      );
      const fileInput = selectedElements.find(
        (element) =>
          element.type === "input" &&
          (element.props as { type?: string }).type === "file" &&
          String((element.props as { accept?: string }).accept).includes(
            "image/png",
          ),
      );
      assert.ok(fileInput, "expected the image replacement file input");

      (
        replaceImageSurface.props as { onReplaceImage: () => void }
      ).onReplaceImage();
      const target = {
        files: [new File(["image"], "removed-node.png", { type: "image/png" })],
        value: "removed-node.png",
      };
      (fileInput.props as { onChange: (event: unknown) => void }).onChange({
        currentTarget: target,
      });

      renderEditor({
        ...initialDeck,
        slides: initialDeck.slides.map((slide) =>
          slide.id === "slide-1"
            ? {
                ...slide,
                children: slide.children.filter(
                  (node) => node.id !== "image-1",
                ),
              }
            : slide,
        ),
      });
      uploadAttempt.resolve({
        src: "https://textiq.test/api/slide-assets/removed-node.png",
        assetId: "asset-removed-node",
      });
      await waitForAsyncDrain();
      await waitForAsyncDrain();

      assert.deepEqual(
        changedDecks,
        [],
        "a removed image node must not receive an orphan asset mutation",
      );
    } finally {
      renderer.cleanup();
    }
  });
});

test("SlideEditor ignores a background upload after its initiating slide is removed", async () => {
  await withDefaultDom(async () => {
    const uploadAttempt = deferred<{
      src: string;
      assetId: string;
    }>();
    const changedDecks: unknown[] = [];
    const renderer = createHookRenderer();
    const initialDeck = buildDeck([
      buildSlide("content", [], { id: "slide-1" }),
      buildSlide("content", [], { id: "slide-2" }),
    ]);
    const renderEditor = (deck: typeof initialDeck) =>
      renderer.run(() =>
        SlideEditor({
          documentId: "doc-removed-background-target",
          deck,
          onDeckChange: (nextDeck) => changedDecks.push(nextDeck),
          onUploadImage: () => uploadAttempt.promise,
        }),
      );

    try {
      const elements = collectElements(renderEditor(initialDeck));
      const fileInputs = elements.filter(
        (element) =>
          element.type === "input" &&
          (element.props as { type?: string }).type === "file" &&
          String((element.props as { accept?: string }).accept).includes(
            "image/png",
          ),
      );
      const backgroundInput = fileInputs[1];
      assert.ok(backgroundInput, "expected the background image file input");

      const target = {
        files: [
          new File(["image"], "removed-background.png", {
            type: "image/png",
          }),
        ],
        value: "removed-background.png",
      };
      (
        backgroundInput.props as { onChange: (event: unknown) => void }
      ).onChange({ currentTarget: target });

      renderEditor({
        ...initialDeck,
        slides: initialDeck.slides.filter((slide) => slide.id !== "slide-1"),
      });
      uploadAttempt.resolve({
        src: "https://textiq.test/api/slide-assets/removed-background.png",
        assetId: "asset-removed-background",
      });
      await waitForAsyncDrain();
      await waitForAsyncDrain();

      assert.deepEqual(
        changedDecks,
        [],
        "a removed slide must not receive an orphan background asset mutation",
      );
    } finally {
      renderer.cleanup();
    }
  });
});

test("PrecisionGuideOverlays keeps editor chrome off by default and renders persisted overlays", () => {
  const hidden = renderToStaticMarkup(
    createElement(PrecisionGuideOverlays, {
      preferences: {
        gridVisible: false,
        rulersVisible: false,
        guidesVisible: false,
        customGuides: [],
      },
    }),
  );
  assert.doesNotMatch(hidden, /data-precision-grid-overlay/);
  assert.doesNotMatch(hidden, /data-precision-ruler-overlay/);

  const visible = renderToStaticMarkup(
    createElement(PrecisionGuideOverlays, {
      preferences: {
        gridVisible: true,
        rulersVisible: true,
        guidesVisible: true,
        customGuides: [{ axis: "x", positionPct: 25 }],
      },
    }),
  );
  assert.match(visible, /data-precision-grid-overlay="true"/);
  assert.match(visible, /data-precision-ruler-overlay="true"/);
  assert.match(visible, /data-precision-guides-overlay="true"/);
});
