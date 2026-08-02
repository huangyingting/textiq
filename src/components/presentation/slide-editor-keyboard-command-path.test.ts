import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, describe, test } from "node:test";
import { createElement, useState, type ReactNode } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

import type { Deck, SlideChildNode } from "@/lib/presentation/schema";
import type {
  SlideEditorProps,
  SlideEditorVisualPickResult,
} from "./slide-editor";
import {
  buildDeck,
  buildShapeNode,
  buildSlide,
  buildVisualNode,
} from "@/test/builders/presentation-deck";

const require = createRequire(import.meta.url);
const reactDom = require("react-dom") as {
  createPortal: (children: ReactNode) => ReactNode;
};
const originalCreatePortal = reactDom.createPortal;
reactDom.createPortal = (children) => children;

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const [message] = args;
  if (
    typeof message === "string" &&
    message.startsWith("react-test-renderer is deprecated")
  ) {
    return;
  }
  originalConsoleError(...args);
};

after(() => {
  reactDom.createPortal = originalCreatePortal;
  console.error = originalConsoleError;
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let SlideEditorComponent:
  (typeof import("./slide-editor"))["SlideEditor"] | undefined;

async function getSlideEditor() {
  SlideEditorComponent ??= (await import("./slide-editor")).SlideEditor;
  return SlideEditorComponent;
}

type KeyboardEventStub = {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  preventDefault: () => void;
  shiftKey: boolean;
  target: EventTarget | null;
  defaultPrevented: boolean;
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

class TestClipboardItem {
  readonly types: string[];

  constructor(readonly data: Record<string, Blob>) {
    this.types = Object.keys(data);
  }

  async getType(type: string): Promise<Blob> {
    return this.data[type] ?? new Blob();
  }
}

function installClipboard(
  clipboard: Partial<{
    read: () => Promise<ClipboardItem[]>;
    write: (items: ClipboardItem[]) => Promise<void>;
  }>,
): () => void {
  const previousNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const previousClipboardItem = Object.getOwnPropertyDescriptor(
    globalThis,
    "ClipboardItem",
  );

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {
      clipboard,
      permissions: {
        query: async () => ({ state: "granted" }),
      },
    },
  });
  Object.defineProperty(globalThis, "ClipboardItem", {
    configurable: true,
    writable: true,
    value: TestClipboardItem,
  });

  return () => {
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      delete (globalThis as { navigator?: unknown }).navigator;
    }
    if (previousClipboardItem) {
      Object.defineProperty(globalThis, "ClipboardItem", previousClipboardItem);
    } else {
      delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
    }
  };
}

function shapeNode(
  id: string,
  name: string,
  frame: { x: number; y: number; w: number; h: number },
  zIndex: number,
): SlideChildNode {
  return buildShapeNode({
    id,
    name,
    layout: { frame, zIndex },
  });
}

function connectorNode(): SlideChildNode {
  return {
    id: "connector-1",
    type: "connector",
    role: "connector",
    layout: { frame: { x: 20, y: 0, w: 60, h: 10 }, zIndex: 3 },
    style: { ref: "connector.primary" },
    content: {
      from: { kind: "node", nodeId: "source", anchor: "right" },
      to: { kind: "node", nodeId: "target", anchor: "left" },
      routing: "straight",
    },
  };
}

function connectorDeck(): Deck {
  return buildDeck([
    buildSlide(
      "content",
      [
        shapeNode("source", "Source", { x: 10, y: 20, w: 20, h: 10 }, 1),
        shapeNode("target", "Target", { x: 70, y: 20, w: 20, h: 10 }, 2),
      ],
      { id: "slide-1" },
    ),
  ]);
}

function deckWithSelectedConnectorFirst(): Deck {
  return buildDeck([
    buildSlide(
      "content",
      [
        connectorNode(),
        shapeNode("source", "Source", { x: 10, y: 20, w: 20, h: 10 }, 1),
        shapeNode("target", "Target", { x: 70, y: 20, w: 20, h: 10 }, 2),
      ],
      { id: "slide-1" },
    ),
  ]);
}

function rotationDeck(): Deck {
  return buildDeck([
    buildSlide(
      "content",
      [shapeNode("box", "Box", { x: 10, y: 10, w: 20, h: 10 }, 1)],
      { id: "slide-1" },
    ),
  ]);
}

function visualDeck(): Deck {
  return buildDeck([
    buildSlide(
      "content",
      [
        buildVisualNode({
          id: "visual-node",
          content: { visualId: "original-visual" },
        }),
      ],
      { id: "slide-1" },
    ),
  ]);
}

function createNodeMock(
  element?: { props?: Record<string, unknown> },
  focusLog: string[] = [],
) {
  const focusTarget =
    typeof element?.props?.["data-node-id"] === "string"
      ? element.props["data-node-id"]
      : element?.props?.["data-slide-editor"] === "true"
        ? "editor"
        : null;
  return {
    addEventListener: () => undefined,
    blur: () => undefined,
    childNodes: [],
    click: () => undefined,
    contains: () => false,
    focus: () => {
      if (focusTarget) focusLog.push(focusTarget);
    },
    getBoundingClientRect: () => ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    innerHTML: "",
    nodeType: 1,
    querySelector: () => null,
    querySelectorAll: () => [],
    removeEventListener: () => undefined,
    setPointerCapture: () => undefined,
    style: {},
  };
}

function installBrowserGlobals(): () => void {
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  const fakeDocument = {
    activeElement: { focus: () => undefined },
    addEventListener: () => undefined,
    body: createNodeMock(),
    createElement: () => createNodeMock(),
    dispatchEvent: () => true,
    querySelector: () => null,
    removeEventListener: () => undefined,
  };
  const fakeWindow = {
    addEventListener: () => undefined,
    cancelAnimationFrame: () => undefined,
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    getSelection: () => null,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    matchMedia: () => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      matches: false,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
    requestAnimationFrame: () => 0,
    removeEventListener: () => undefined,
    setTimeout: globalThis.setTimeout.bind(globalThis),
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: fakeDocument,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: fakeWindow,
  });
  return () => {
    if (previousDocument) {
      Object.defineProperty(globalThis, "document", previousDocument);
    } else {
      delete (globalThis as { document?: unknown }).document;
    }
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  };
}

async function renderSlideEditor(
  initialDeck: Deck,
  overrides: Pick<SlideEditorProps, "onPickVisual" | "onUploadImage"> = {},
) {
  const SlideEditor = await getSlideEditor();
  const restore = installBrowserGlobals();
  let currentDeck = initialDeck;
  const deckChanges: Deck[] = [];
  const focusLog: string[] = [];
  let setDeckFromTest: ((nextDeck: Deck) => void) | undefined;
  let setDocumentIdFromTest: ((nextDocumentId: string) => void) | undefined;

  function StatefulSlideEditor() {
    const [deck, setDeck] = useState(initialDeck);
    const [documentId, setDocumentId] = useState("keyboard-command-path");
    setDeckFromTest = setDeck;
    setDocumentIdFromTest = setDocumentId;
    currentDeck = deck;
    return createElement(SlideEditor, {
      documentId,
      deck,
      ...overrides,
      onDeckChange: (nextDeck) => {
        deckChanges.push(nextDeck);
        currentDeck = nextDeck;
        setDeck(nextDeck);
      },
    });
  }

  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(StatefulSlideEditor), {
      createNodeMock: (element) =>
        createNodeMock(
          element as unknown as { props?: Record<string, unknown> },
          focusLog,
        ),
    });
  });

  return {
    renderer: renderer!,
    deckChanges,
    focusLog,
    get currentDeck() {
      return currentDeck;
    },
    updateDeck(update: (deck: Deck) => Deck) {
      assert.ok(setDeckFromTest, "expected the stateful editor to be mounted");
      act(() => setDeckFromTest?.(update(currentDeck)));
    },
    updateDocumentId(documentId: string) {
      assert.ok(
        setDocumentIdFromTest,
        "expected the stateful editor to be mounted",
      );
      act(() => setDocumentIdFromTest?.(documentId));
    },
    press(key: string, options: Partial<KeyboardEventStub> = {}) {
      const event = keyEvent(key, options);
      act(() => {
        const editor = renderer!.root.findByProps({
          "data-slide-editor": "true",
        });
        (
          editor.props as { onKeyDown: (event: KeyboardEventStub) => void }
        ).onKeyDown(event);
      });
      return event;
    },
    liveRegionText() {
      const [liveRegion] = renderer!.root.findAll(
        (node) =>
          node.props["aria-live"] === "polite" &&
          node.props["aria-atomic"] === "true" &&
          node.props.className === "sr-only",
      );
      assert.ok(liveRegion, "stage live region should be rendered");
      return textContent(liveRegion);
    },
    cleanup() {
      act(() => renderer!.unmount());
      restore();
    },
  };
}

async function flushScheduledEffects() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function keyEvent(
  key: string,
  options: Partial<KeyboardEventStub> = {},
): KeyboardEventStub {
  const event: KeyboardEventStub = {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    key,
    metaKey: false,
    preventDefault: () => {
      event.defaultPrevented = true;
    },
    shiftKey: false,
    target: null,
    ...options,
  };
  return event;
}

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : textContent(child)))
    .join("");
}

function findNode(deck: Deck, id: string): SlideChildNode {
  const node = deck.slides[0]?.children.find((child) => child.id === id);
  assert.ok(node, `expected node ${id} to exist`);
  return node;
}

describe("SlideEditor keyboard command path", () => {
  test("competing image upload entry paths serialize and preserve every mutation", async () => {
    const uploads = [
      deferred<{ src: string; assetId: string }>(),
      deferred<{ src: string; assetId: string }>(),
      deferred<{ src: string; assetId: string }>(),
    ];
    let uploadCalls = 0;
    const restoreClipboard = installClipboard({
      read: async () => [
        new TestClipboardItem({
          "image/png": new Blob(["clipboard-image"], { type: "image/png" }),
        }) as unknown as ClipboardItem,
      ],
    });
    const editor = await renderSlideEditor(rotationDeck(), {
      onUploadImage: () => {
        const upload = uploads[uploadCalls];
        uploadCalls += 1;
        assert.ok(upload, "unexpected extra image upload");
        return upload.promise;
      },
    });

    try {
      const [insertImageSurface] = editor.renderer.root.findAll(
        (node) => typeof node.props.onInsertImage === "function",
      );
      assert.ok(insertImageSurface, "expected an insert-image command surface");
      const [imageFileInput, backgroundFileInput] =
        editor.renderer.root.findAll(
          (node) =>
            node.type === "input" &&
            node.props.type === "file" &&
            String(node.props.accept).includes("image/png"),
        );
      assert.ok(imageFileInput, "expected the image file input");
      assert.ok(backgroundFileInput, "expected the background file input");

      act(() => {
        insertImageSurface.props.onInsertImage();
        imageFileInput.props.onChange({
          currentTarget: {
            files: [
              new File(["file-image"], "inserted.png", {
                type: "image/png",
              }),
            ],
            value: "inserted.png",
          },
        });
        backgroundFileInput.props.onChange({
          currentTarget: {
            files: [
              new File(["background-image"], "background.png", {
                type: "image/png",
              }),
            ],
            value: "background.png",
          },
        });
      });
      const pasteEvent = editor.press("v", { ctrlKey: true });
      assert.equal(pasteEvent.defaultPrevented, true);

      await act(async () => {
        for (let attempt = 0; attempt < 10 && uploadCalls < 1; attempt += 1) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      });
      assert.equal(
        uploadCalls,
        1,
        "the clipboard upload must wait behind the active file upload",
      );
      assert.equal(
        editor.renderer.root.findByProps({
          "data-slide-editor": "true",
        }).props["aria-busy"],
        true,
      );
      assert.equal(
        textContent(
          editor.renderer.root.findByProps({
            "data-image-upload-status": "true",
          }),
        ),
        "Uploading image… 2 queued.",
      );

      await act(async () => {
        uploads[0]?.resolve({
          src: "https://textiq.test/api/slide-assets/file.png",
          assetId: "asset-file",
        });
        await uploads[0]?.promise;
        for (let attempt = 0; attempt < 10 && uploadCalls < 2; attempt += 1) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      });
      assert.equal(uploadCalls, 2);
      assert.deepEqual(
        editor.currentDeck.slides[0]?.children
          .filter((node) => node.type === "image")
          .map((node) => node.content.assetId),
        ["asset-file"],
      );

      await act(async () => {
        uploads[1]?.resolve({
          src: "https://textiq.test/api/slide-assets/background.png",
          assetId: "asset-background",
        });
        await uploads[1]?.promise;
        for (let attempt = 0; attempt < 10 && uploadCalls < 3; attempt += 1) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      });
      assert.equal(uploadCalls, 3);
      assert.equal(
        editor.currentDeck.slides[0]?.localStyle?.slide?.background?.type,
        "image",
      );
      const background =
        editor.currentDeck.slides[0]?.localStyle?.slide?.background;
      assert.equal(background?.type, "image");
      assert.ok(background && "assetId" in background);
      if (background && "assetId" in background) {
        assert.equal(background.assetId, "asset-background");
      }

      await act(async () => {
        uploads[2]?.resolve({
          src: "https://textiq.test/api/slide-assets/clipboard.png",
          assetId: "asset-clipboard",
        });
        await uploads[2]?.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
      });

      const imageAssetIds = editor.currentDeck.slides[0]?.children
        .filter((node) => node.type === "image")
        .map((node) => node.content.assetId)
        .sort();
      assert.deepEqual(imageAssetIds, ["asset-clipboard", "asset-file"]);
      assert.ok(editor.currentDeck.assets.images["asset-file"]);
      assert.ok(editor.currentDeck.assets.images["asset-background"]);
      assert.ok(editor.currentDeck.assets.images["asset-clipboard"]);
      assert.equal(
        editor.renderer.root.findByProps({
          "data-slide-editor": "true",
        }).props["aria-busy"],
        false,
      );
      assert.equal(
        editor.renderer.root.findAllByProps({
          "data-image-upload-status": "true",
        }).length,
        0,
      );
    } finally {
      for (const [index, upload] of uploads.entries()) {
        upload.resolve({
          src: `https://textiq.test/api/slide-assets/cleanup-${index}.png`,
          assetId: `asset-cleanup-${index}`,
        });
      }
      editor.cleanup();
      restoreClipboard();
    }
  });

  test("a failed image upload does not poison the queued operation behind it", async () => {
    const backgroundUpload = deferred<{ src: string; assetId: string }>();
    let uploadCalls = 0;
    const editor = await renderSlideEditor(rotationDeck(), {
      onUploadImage: () => {
        uploadCalls += 1;
        if (uploadCalls === 1) {
          return Promise.reject(new Error("first upload failed"));
        }
        return backgroundUpload.promise;
      },
    });

    try {
      const [insertImageSurface] = editor.renderer.root.findAll(
        (node) => typeof node.props.onInsertImage === "function",
      );
      assert.ok(insertImageSurface);
      const [imageFileInput, backgroundFileInput] =
        editor.renderer.root.findAll(
          (node) =>
            node.type === "input" &&
            node.props.type === "file" &&
            String(node.props.accept).includes("image/png"),
        );
      assert.ok(imageFileInput);
      assert.ok(backgroundFileInput);

      act(() => {
        insertImageSurface.props.onInsertImage();
        imageFileInput.props.onChange({
          currentTarget: {
            files: [new File(["bad"], "bad.png", { type: "image/png" })],
            value: "bad.png",
          },
        });
        backgroundFileInput.props.onChange({
          currentTarget: {
            files: [
              new File(["background"], "background.png", {
                type: "image/png",
              }),
            ],
            value: "background.png",
          },
        });
      });

      await act(async () => {
        for (let attempt = 0; attempt < 10 && uploadCalls < 2; attempt += 1) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      });
      assert.equal(uploadCalls, 2);

      await act(async () => {
        backgroundUpload.resolve({
          src: "https://textiq.test/api/slide-assets/background.png",
          assetId: "asset-background",
        });
        await backgroundUpload.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
      });

      const background =
        editor.currentDeck.slides[0]?.localStyle?.slide?.background;
      assert.equal(background?.type, "image");
      assert.ok(background && "assetId" in background);
      if (background && "assetId" in background) {
        assert.equal(background.assetId, "asset-background");
      }
      assert.equal(
        editor.currentDeck.slides[0]?.children.some(
          (node) => node.type === "image",
        ),
        false,
      );
      assert.equal(
        editor.renderer.root.findAllByProps({
          "data-image-upload-status": "true",
        }).length,
        0,
      );
    } finally {
      backgroundUpload.resolve({ src: "", assetId: "cleanup" });
      editor.cleanup();
    }
  });

  test("repeated visual insertion activation starts only one picker request", async () => {
    const visualPick = deferred<SlideEditorVisualPickResult | undefined>();
    let visualPicks = 0;
    const editor = await renderSlideEditor(rotationDeck(), {
      onPickVisual: () => {
        visualPicks += 1;
        return visualPick.promise;
      },
    });

    try {
      const [insertVisualSurface] = editor.renderer.root.findAll(
        (node) => typeof node.props.onInsertVisual === "function",
      );
      assert.ok(
        insertVisualSurface,
        "expected an insert-visual command surface",
      );

      act(() => {
        void insertVisualSurface.props.onInsertVisual();
        void insertVisualSurface.props.onInsertVisual();
      });

      assert.equal(
        visualPicks,
        1,
        "the editor must claim the picker operation before awaiting it",
      );
    } finally {
      await act(async () => {
        visualPick.resolve(undefined);
        await visualPick.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
      });
      editor.cleanup();
    }
  });

  test("a visual replacement settling after a newer deck update preserves the newer content", async () => {
    const visualPick = deferred<SlideEditorVisualPickResult | undefined>();
    const editor = await renderSlideEditor(visualDeck(), {
      onPickVisual: () => visualPick.promise,
    });

    try {
      editor.press("Tab");
      const [replaceVisualSurface] = editor.renderer.root.findAll(
        (node) => typeof node.props.onReplaceVisual === "function",
      );
      assert.ok(
        replaceVisualSurface,
        "expected a replace-visual command surface",
      );
      act(() => {
        void replaceVisualSurface.props.onReplaceVisual();
      });

      editor.updateDeck((deck) => ({
        ...deck,
        slides: deck.slides.map((slide) =>
          slide.id === "slide-1"
            ? {
                ...slide,
                children: [
                  ...slide.children,
                  shapeNode(
                    "collaborator-node",
                    "Collaborator node",
                    { x: 50, y: 50, w: 20, h: 10 },
                    2,
                  ),
                ],
              }
            : slide,
        ),
      }));

      await act(async () => {
        visualPick.resolve({ visualId: "replacement-visual" });
        await visualPick.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
      });

      assert.equal(
        editor.currentDeck.slides[0]?.children.some(
          (node) => node.id === "collaborator-node",
        ),
        true,
      );
      const replaced = editor.currentDeck.slides[0]?.children.find(
        (node) => node.id === "visual-node",
      );
      assert.equal(replaced?.type, "visual");
      if (replaced?.type === "visual") {
        assert.equal(replaced.content.visualId, "replacement-visual");
      }
    } finally {
      editor.cleanup();
    }
  });

  test("a visual pick settling after a newer deck update preserves the newer content", async () => {
    const visualPick = deferred<SlideEditorVisualPickResult | undefined>();
    let visualPicks = 0;
    const editor = await renderSlideEditor(rotationDeck(), {
      onPickVisual: () => {
        visualPicks += 1;
        return visualPick.promise;
      },
    });

    try {
      const [insertVisualSurface] = editor.renderer.root.findAll(
        (node) => typeof node.props.onInsertVisual === "function",
      );
      assert.ok(
        insertVisualSurface,
        "expected an insert-visual command surface",
      );
      act(() => insertVisualSurface.props.onInsertVisual());
      assert.equal(visualPicks, 1);

      editor.updateDeck((deck) => ({
        ...deck,
        slides: deck.slides.map((slide) =>
          slide.id === "slide-1"
            ? {
                ...slide,
                children: [
                  ...slide.children,
                  shapeNode(
                    "collaborator-node",
                    "Collaborator node",
                    { x: 50, y: 50, w: 20, h: 10 },
                    2,
                  ),
                ],
              }
            : slide,
        ),
      }));
      assert.equal(
        editor.currentDeck.slides[0]?.children.some(
          (node) => node.id === "collaborator-node",
        ),
        true,
      );

      await act(async () => {
        visualPick.resolve({ visualId: "picked-visual" });
        await visualPick.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
      });

      assert.equal(
        editor.currentDeck.slides[0]?.children.some(
          (node) => node.id === "collaborator-node",
        ),
        true,
      );
      assert.equal(
        editor.currentDeck.slides[0]?.children.some(
          (node) =>
            node.type === "visual" && node.content.visualId === "picked-visual",
        ),
        true,
      );
    } finally {
      editor.cleanup();
    }
  });

  test("a cut settling after a newer deck update preserves the newer content", async () => {
    const clipboardWrite = deferred<void>();
    let clipboardWrites = 0;
    const restoreClipboard = installClipboard({
      write: () => {
        clipboardWrites += 1;
        return clipboardWrite.promise;
      },
    });
    const editor = await renderSlideEditor(rotationDeck());

    try {
      editor.press("Tab");
      const cutEvent = editor.press("x", { ctrlKey: true });
      assert.equal(cutEvent.defaultPrevented, true);

      await act(async () => {
        for (
          let attempt = 0;
          attempt < 10 && clipboardWrites === 0;
          attempt += 1
        ) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      });
      assert.equal(clipboardWrites, 1);
      assert.equal(
        editor.currentDeck.slides[0]?.children.some(
          (node) => node.id === "box",
        ),
        false,
      );

      editor.updateDeck((deck) => ({
        ...deck,
        slides: deck.slides.map((slide) =>
          slide.id === "slide-1"
            ? {
                ...slide,
                children: [
                  ...slide.children,
                  shapeNode(
                    "collaborator-node",
                    "Collaborator node",
                    { x: 50, y: 50, w: 20, h: 10 },
                    2,
                  ),
                ],
              }
            : slide,
        ),
      }));

      await act(async () => {
        clipboardWrite.resolve();
        await clipboardWrite.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
      });

      assert.equal(
        editor.currentDeck.slides[0]?.children.some(
          (node) => node.id === "box",
        ),
        false,
      );
      assert.equal(
        editor.currentDeck.slides[0]?.children.some(
          (node) => node.id === "collaborator-node",
        ),
        true,
      );
    } finally {
      editor.cleanup();
      restoreClipboard();
    }
  });

  test("a paste settling after a newer deck update preserves the newer content", async () => {
    const clipboardRead = deferred<ClipboardItem[]>();
    let clipboardReads = 0;
    const restoreClipboard = installClipboard({
      read: () => {
        clipboardReads += 1;
        return clipboardRead.promise;
      },
    });
    const editor = await renderSlideEditor(rotationDeck());

    try {
      const pasteEvent = editor.press("v", { ctrlKey: true });
      assert.equal(pasteEvent.defaultPrevented, true);

      await act(async () => {
        for (
          let attempt = 0;
          attempt < 10 && clipboardReads === 0;
          attempt += 1
        ) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      });
      assert.equal(clipboardReads, 1);

      editor.updateDeck((deck) => ({
        ...deck,
        slides: deck.slides.map((slide) =>
          slide.id === "slide-1"
            ? {
                ...slide,
                children: [
                  ...slide.children,
                  shapeNode(
                    "collaborator-node",
                    "Collaborator node",
                    { x: 50, y: 50, w: 20, h: 10 },
                    2,
                  ),
                ],
              }
            : slide,
        ),
      }));

      await act(async () => {
        clipboardRead.resolve([
          new TestClipboardItem({
            "text/plain": new Blob(["Pasted text"], { type: "text/plain" }),
          }) as unknown as ClipboardItem,
        ]);
        await clipboardRead.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
      });

      assert.equal(
        editor.currentDeck.slides[0]?.children.some(
          (node) => node.id === "collaborator-node",
        ),
        true,
      );
      assert.equal(
        editor.currentDeck.slides[0]?.children.some(
          (node) => node.type === "text",
        ),
        true,
      );
    } finally {
      editor.cleanup();
      restoreClipboard();
    }
  });

  test("same-turn repeated paste preserves every requested mutation", async () => {
    const clipboardReads = [
      deferred<ClipboardItem[]>(),
      deferred<ClipboardItem[]>(),
    ];
    let readCalls = 0;
    const restoreClipboard = installClipboard({
      read: () => {
        const read = clipboardReads[readCalls];
        readCalls += 1;
        assert.ok(read, "unexpected extra clipboard read");
        return read.promise;
      },
    });
    const editor = await renderSlideEditor(rotationDeck());

    try {
      const firstPaste = editor.press("v", { ctrlKey: true });
      const secondPaste = editor.press("v", { ctrlKey: true });
      assert.equal(firstPaste.defaultPrevented, true);
      assert.equal(secondPaste.defaultPrevented, true);

      await act(async () => {
        for (let attempt = 0; attempt < 10 && readCalls < 1; attempt += 1) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      });
      assert.equal(
        readCalls,
        1,
        "the second paste must wait for the first paste mutation",
      );
      assert.equal(
        editor.renderer.root.findByProps({
          "data-slide-editor": "true",
        }).props["aria-busy"],
        true,
      );
      assert.equal(
        textContent(
          editor.renderer.root.findByProps({
            "data-clipboard-paste-status": "true",
          }),
        ),
        "Pasting… 1 queued.",
      );

      await act(async () => {
        clipboardReads[0]?.resolve([
          new TestClipboardItem({
            "text/plain": new Blob(["First pasted text"], {
              type: "text/plain",
            }),
          }) as unknown as ClipboardItem,
        ]);
        await clipboardReads[0]?.promise;
        for (let attempt = 0; attempt < 10 && readCalls < 2; attempt += 1) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      });
      assert.equal(readCalls, 2);
      assert.match(
        JSON.stringify(editor.currentDeck.slides[0]?.children),
        /First pasted text/,
      );

      await act(async () => {
        clipboardReads[1]?.resolve([
          new TestClipboardItem({
            "text/plain": new Blob(["Second pasted text"], {
              type: "text/plain",
            }),
          }) as unknown as ClipboardItem,
        ]);
        await clipboardReads[1]?.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
      });

      const pastedTextNodes = editor.currentDeck.slides[0]?.children.filter(
        (node) => node.type === "text",
      );
      const serializedPastedText = JSON.stringify(pastedTextNodes);
      assert.match(serializedPastedText, /First pasted text/);
      assert.match(serializedPastedText, /Second pasted text/);
      assert.equal(
        pastedTextNodes?.length,
        2,
        "each intentional paste must create its own node",
      );
      assert.equal(
        editor.renderer.root.findByProps({
          "data-slide-editor": "true",
        }).props["aria-busy"],
        false,
      );
      assert.equal(
        editor.renderer.root.findAllByProps({
          "data-clipboard-paste-status": "true",
        }).length,
        0,
      );
    } finally {
      for (const read of clipboardReads) read.resolve([]);
      editor.cleanup();
      restoreClipboard();
    }
  });

  test("paste immediately after copy waits for the initiated clipboard write", async () => {
    const clipboardWrite = deferred<void>();
    let clipboardItems: ClipboardItem[] = [
      new TestClipboardItem({
        "text/plain": new Blob(["Stale clipboard text"], {
          type: "text/plain",
        }),
      }) as unknown as ClipboardItem,
    ];
    let clipboardReads = 0;
    let clipboardWrites = 0;
    const restoreClipboard = installClipboard({
      read: async () => {
        clipboardReads += 1;
        return clipboardItems;
      },
      write: async (items) => {
        clipboardWrites += 1;
        await clipboardWrite.promise;
        clipboardItems = items;
      },
    });
    const editor = await renderSlideEditor(rotationDeck());

    try {
      editor.press("Tab");
      const copyEvent = editor.press("c", { ctrlKey: true });
      const pasteEvent = editor.press("v", { ctrlKey: true });
      assert.equal(copyEvent.defaultPrevented, true);
      assert.equal(pasteEvent.defaultPrevented, true);

      await act(async () => {
        for (
          let attempt = 0;
          attempt < 10 && clipboardWrites < 1;
          attempt += 1
        ) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      });
      assert.equal(clipboardWrites, 1);
      assert.equal(
        clipboardReads,
        0,
        "paste must not read the system clipboard before the copy write settles",
      );

      await act(async () => {
        clipboardWrite.resolve();
        await clipboardWrite.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
      });

      assert.equal(clipboardReads, 1);
      assert.equal(
        editor.currentDeck.slides[0]?.children.filter(
          (node) => node.type === "shape",
        ).length,
        2,
        "paste must duplicate the shape copied by the preceding operation",
      );
      assert.equal(
        editor.currentDeck.slides[0]?.children.some(
          (node) => node.type === "text",
        ),
        false,
        "paste must not consume the stale pre-copy clipboard payload",
      );
    } finally {
      clipboardWrite.resolve();
      editor.cleanup();
      restoreClipboard();
    }
  });

  test("a failed clipboard write makes paste prefer the in-editor copy", async () => {
    let clipboardReads = 0;
    let clipboardWrites = 0;
    const restoreClipboard = installClipboard({
      read: async () => {
        clipboardReads += 1;
        return [
          new TestClipboardItem({
            "text/plain": new Blob(["Stale clipboard text"], {
              type: "text/plain",
            }),
          }) as unknown as ClipboardItem,
        ];
      },
      write: async () => {
        clipboardWrites += 1;
        throw new Error("clipboard write failed");
      },
    });
    const editor = await renderSlideEditor(rotationDeck());

    try {
      editor.press("Tab");
      const copyEvent = editor.press("c", { ctrlKey: true });
      const pasteEvent = editor.press("v", { ctrlKey: true });
      assert.equal(copyEvent.defaultPrevented, true);
      assert.equal(pasteEvent.defaultPrevented, true);

      await act(async () => {
        for (
          let attempt = 0;
          attempt < 10 && clipboardReads < 1;
          attempt += 1
        ) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      });

      assert.equal(clipboardWrites, 1);
      assert.equal(clipboardReads, 1);
      assert.equal(
        editor.currentDeck.slides[0]?.children.filter(
          (node) => node.type === "shape",
        ).length,
        2,
      );
      assert.equal(
        editor.currentDeck.slides[0]?.children.some(
          (node) => node.type === "text",
        ),
        false,
        "stale system clipboard text must not override the in-editor copy",
      );
    } finally {
      editor.cleanup();
      restoreClipboard();
    }
  });

  test("changing documents invalidates running and queued clipboard paste work", async () => {
    const clipboardReads = [
      deferred<ClipboardItem[]>(),
      deferred<ClipboardItem[]>(),
    ];
    let readCalls = 0;
    const restoreClipboard = installClipboard({
      read: () => {
        const read = clipboardReads[readCalls];
        readCalls += 1;
        assert.ok(read, "unexpected extra clipboard read");
        return read.promise;
      },
    });
    const editor = await renderSlideEditor(rotationDeck());

    try {
      editor.press("v", { ctrlKey: true });
      await act(async () => {
        for (let attempt = 0; attempt < 10 && readCalls < 1; attempt += 1) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      });
      assert.equal(readCalls, 1);

      editor.updateDocumentId("replacement-document");
      editor.press("v", { ctrlKey: true });
      await act(async () => {
        for (let attempt = 0; attempt < 10 && readCalls < 2; attempt += 1) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      });
      assert.equal(
        readCalls,
        2,
        "the replacement document must not wait for the stale paste queue",
      );

      await act(async () => {
        clipboardReads[0]?.resolve([
          new TestClipboardItem({
            "text/plain": new Blob(["Stale document paste"], {
              type: "text/plain",
            }),
          }) as unknown as ClipboardItem,
        ]);
        await clipboardReads[0]?.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
      });
      assert.doesNotMatch(
        JSON.stringify(editor.currentDeck.slides[0]?.children),
        /Stale document paste/,
      );

      await act(async () => {
        clipboardReads[1]?.resolve([
          new TestClipboardItem({
            "text/plain": new Blob(["Replacement document paste"], {
              type: "text/plain",
            }),
          }) as unknown as ClipboardItem,
        ]);
        await clipboardReads[1]?.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
      });
      const serializedDeck = JSON.stringify(editor.currentDeck);
      assert.match(serializedDeck, /Replacement document paste/);
      assert.doesNotMatch(serializedDeck, /Stale document paste/);
    } finally {
      for (const read of clipboardReads) read.resolve([]);
      editor.cleanup();
      restoreClipboard();
    }
  });

  test("creates a connector from c and Enter through the editor root keydown handler", async () => {
    const editor = await renderSlideEditor(connectorDeck());
    try {
      editor.press("Tab");
      const startEvent = editor.press("c");

      assert.equal(startEvent.defaultPrevented, true);
      assert.equal(
        editor.liveRegionText(),
        "Connector target Target. Press Enter to connect.",
      );

      const commitEvent = editor.press("Enter");
      assert.equal(commitEvent.defaultPrevented, true);

      const connector = editor.currentDeck.slides[0]?.children.find(
        (node) => node.type === "connector",
      );
      assert.ok(connector);
      assert.equal(connector.content.from.kind, "node");
      assert.equal(connector.content.to.kind, "node");
      if (connector.content.from.kind === "node") {
        assert.equal(connector.content.from.nodeId, "source");
        assert.equal(connector.content.from.anchor, "right");
      }
      if (connector.content.to.kind === "node") {
        assert.equal(connector.content.to.nodeId, "target");
        assert.equal(connector.content.to.anchor, "left");
      }
      assert.equal(editor.liveRegionText(), "Connected Source to Target");
      assert.equal(editor.deckChanges.length, 1);
    } finally {
      editor.cleanup();
    }
  });

  test("cycles a selected connector endpoint anchor through the editor root keydown handler", async () => {
    const editor = await renderSlideEditor(deckWithSelectedConnectorFirst());
    try {
      editor.press("Tab");
      const event = editor.press("c");

      assert.equal(event.defaultPrevented, true);
      const connector = findNode(editor.currentDeck, "connector-1");
      assert.equal(connector.type, "connector");
      if (
        connector.type === "connector" &&
        connector.content.to.kind === "node"
      ) {
        assert.equal(connector.content.to.anchor, "right");
      } else {
        assert.fail("expected connector to endpoint to stay node-bound");
      }
      assert.equal(
        editor.liveRegionText(),
        "Reattached connector to endpoint to right",
      );
      assert.equal(editor.deckChanges.length, 1);
    } finally {
      editor.cleanup();
    }
  });

  test("free-draws both connector endpoints from the editor root keyboard path", async () => {
    const editor = await renderSlideEditor(deckWithSelectedConnectorFirst());
    try {
      editor.press("Tab");
      const startEvent = editor.press("Enter");

      assert.equal(startEvent.defaultPrevented, true);
      assert.equal(
        editor.liveRegionText(),
        "Editing connector end endpoint. Use Arrow keys to move, Shift+Arrow for 5%, Tab to switch endpoints, Enter or Escape to finish.",
      );

      const moveEndEvent = editor.press("ArrowRight");
      assert.equal(moveEndEvent.defaultPrevented, true);
      let connector = findNode(editor.currentDeck, "connector-1");
      assert.equal(connector.type, "connector");
      if (connector.type !== "connector") {
        assert.fail("expected a connector");
      }
      assert.deepEqual(connector.content.from, {
        kind: "node",
        nodeId: "source",
        anchor: "right",
      });
      assert.deepEqual(connector.content.to, {
        kind: "point",
        point: { x: 100, y: 0 },
      });
      assert.deepEqual(connector.layout?.frame, {
        x: 30,
        y: 25,
        w: 41,
        h: 1,
      });
      assert.equal(
        editor.liveRegionText(),
        "Moved connector end endpoint right by 1%",
      );

      const switchEvent = editor.press("Tab");
      assert.equal(switchEvent.defaultPrevented, true);
      assert.equal(editor.liveRegionText(), "Editing connector start endpoint");

      const moveStartEvent = editor.press("ArrowUp", { shiftKey: true });
      assert.equal(moveStartEvent.defaultPrevented, true);
      connector = findNode(editor.currentDeck, "connector-1");
      assert.equal(connector.type, "connector");
      if (connector.type !== "connector") {
        assert.fail("expected a connector");
      }
      assert.deepEqual(connector.content.from, {
        kind: "point",
        point: { x: 0, y: 0 },
      });
      assert.deepEqual(connector.content.to, {
        kind: "point",
        point: { x: 100, y: 100 },
      });
      assert.deepEqual(connector.layout?.frame, {
        x: 30,
        y: 20,
        w: 41,
        h: 5,
      });
      assert.equal(
        editor.liveRegionText(),
        "Moved connector start endpoint up by 5%",
      );

      const finishEvent = editor.press("Enter");
      assert.equal(finishEvent.defaultPrevented, true);
      assert.equal(
        editor.liveRegionText(),
        "Connector endpoint editing finished",
      );
      assert.equal(editor.deckChanges.length, 2);

      const restartEvent = editor.press("Enter");
      const escapeEvent = editor.press("Escape");
      assert.equal(restartEvent.defaultPrevented, true);
      assert.equal(escapeEvent.defaultPrevented, true);
      assert.equal(
        editor.liveRegionText(),
        "Connector endpoint editing finished",
      );
      assert.equal(editor.deckChanges.length, 2);
    } finally {
      editor.cleanup();
    }
  });

  test("updates rotation and the live region for shifted bracket shortcuts through the editor root keydown handler", async () => {
    const editor = await renderSlideEditor(rotationDeck());
    try {
      editor.press("Tab");
      const event = editor.press("}", { shiftKey: true });
      await flushScheduledEffects();

      assert.equal(event.defaultPrevented, true);
      const box = findNode(editor.currentDeck, "box");
      assert.equal(box.layout?.rotation, 1);
      assert.equal(editor.liveRegionText(), "Rotated Box to 1°");
      assert.equal(editor.deckChanges.length, 1);
    } finally {
      editor.cleanup();
    }
  });

  test("traverses in reading order and preserves move and resize announcements after deck updates", async () => {
    const editor = await renderSlideEditor(connectorDeck());
    try {
      editor.press("Tab");
      await flushScheduledEffects();
      assert.equal(editor.liveRegionText(), "Source selected");

      editor.press("Tab");
      await flushScheduledEffects();
      assert.equal(editor.liveRegionText(), "Target selected");

      editor.press("Tab", { shiftKey: true });
      await flushScheduledEffects();
      assert.equal(editor.liveRegionText(), "Source selected");

      const moveEvent = editor.press("ArrowRight");
      await flushScheduledEffects();
      assert.equal(moveEvent.defaultPrevented, true);
      assert.equal(findNode(editor.currentDeck, "source").layout?.frame.x, 11);
      assert.equal(editor.liveRegionText(), "Moved 1 node right");

      const resizeEvent = editor.press("ArrowDown", {
        altKey: true,
        shiftKey: true,
      });
      await flushScheduledEffects();
      assert.equal(resizeEvent.defaultPrevented, true);
      assert.equal(findNode(editor.currentDeck, "source").layout?.frame.h, 15);
      assert.equal(editor.liveRegionText(), "Resized 1 node");
      assert.equal(editor.deckChanges.length, 2);

      editor.press("Tab");
      await flushScheduledEffects();
      assert.equal(editor.liveRegionText(), "Target selected");
    } finally {
      editor.cleanup();
    }
  });

  test("deletion keeps its result announcement and restores focus to the replacement node", async () => {
    const editor = await renderSlideEditor(connectorDeck());
    try {
      editor.press("Tab");
      await flushScheduledEffects();
      editor.focusLog.length = 0;

      const event = editor.press("Delete");
      await flushScheduledEffects();

      assert.equal(event.defaultPrevented, true);
      assert.equal(
        editor.currentDeck.slides[0]?.children.some(
          (node) => node.id === "source",
        ),
        false,
      );
      assert.equal(editor.liveRegionText(), "Deleted 1 node, 1 remaining");
      assert.equal(editor.focusLog.at(-1), "target");
      assert.equal(editor.deckChanges.length, 1);

      const finalDeleteEvent = editor.press("Delete");
      await flushScheduledEffects();
      assert.equal(finalDeleteEvent.defaultPrevented, true);
      assert.equal(editor.currentDeck.slides[0]?.children.length, 0);
      assert.equal(editor.liveRegionText(), "Deleted 1 node, 0 remaining");
      assert.equal(editor.focusLog.at(-1), "editor");
      assert.equal(editor.deckChanges.length, 2);
    } finally {
      editor.cleanup();
    }
  });
});
