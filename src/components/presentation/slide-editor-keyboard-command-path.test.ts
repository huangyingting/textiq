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
import {
  buildDeck,
  buildShapeNode,
  buildSlide,
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
  | (typeof import("./slide-editor"))["SlideEditor"]
  | undefined;

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

function createNodeMock() {
  return {
    addEventListener: () => undefined,
    blur: () => undefined,
    childNodes: [],
    contains: () => false,
    focus: () => undefined,
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
    clearTimeout: () => undefined,
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
    setTimeout: () => 0,
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

async function renderSlideEditor(initialDeck: Deck) {
  const SlideEditor = await getSlideEditor();
  const restore = installBrowserGlobals();
  let currentDeck = initialDeck;
  const deckChanges: Deck[] = [];

  function StatefulSlideEditor() {
    const [deck, setDeck] = useState(initialDeck);
    currentDeck = deck;
    return createElement(SlideEditor, {
      documentId: "keyboard-command-path",
      deck,
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
      createNodeMock,
    });
  });

  return {
    renderer: renderer!,
    deckChanges,
    get currentDeck() {
      return currentDeck;
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

  test("updates rotation and the live region for shifted bracket shortcuts through the editor root keydown handler", async () => {
    const editor = await renderSlideEditor(rotationDeck());
    try {
      editor.press("Tab");
      const event = editor.press("}", { shiftKey: true });

      assert.equal(event.defaultPrevented, true);
      const box = findNode(editor.currentDeck, "box");
      assert.equal(box.layout?.rotation, 1);
      assert.equal(editor.liveRegionText(), "Rotated Box to 1°");
      assert.equal(editor.deckChanges.length, 1);
    } finally {
      editor.cleanup();
    }
  });
});
