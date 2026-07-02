import assert from "node:assert/strict";
import * as React from "react";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import type { DeckV7 } from "@/lib/presentation-vnext/schema";
import {
  buildDeckV7,
  buildImageNode,
  buildSlideV7,
} from "@/test/builders/deck-v7";
import { createServerRenderHarness } from "@/test/react-server-renderer";
import { SlideCanvasVNext } from "./slide-canvas";

export type ElementLike = ReactElement<Record<string, unknown>>;

export function collectElements(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
  collected: ElementLike[] = [],
): ElementLike[] {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, predicate, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  if (predicate(element)) collected.push(element);
  const props = element.props as { children?: ReactNode };
  collectElements(props.children, predicate, collected);
  return collected;
}

export function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (!isValidElement(node)) return "";
  const props = node.props as { children?: ReactNode };
  return flattenText(props.children);
}

export function createHookRenderer() {
  return createServerRenderHarness({ preferServerSnapshot: true });
}

export function findRequiredElement(
  root: ReactNode,
  predicate: (element: ElementLike) => boolean,
  message: string,
): ElementLike {
  const [element] = collectElements(root, predicate);
  assert.ok(element, message);
  return element;
}

export function buildEditorDeck(): DeckV7 {
  const imageNodeId = "image-primary";
  return buildDeckV7(
    [
      buildSlideV7(
        "content",
        [
          buildImageNode("img-001", {
            id: imageNodeId,
            name: "Primary image",
            content: { assetId: "img-001", alt: "Primary image" },
          }),
        ],
        { id: "slide-1", name: "Slide 1" },
      ),
    ],
    {
      title: "Failure coverage deck",
    },
  );
}

export async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

export async function withWindow<T>(run: () => Promise<T> | T): Promise<T> {
  const globalWithWindow = globalThis as {
    window?: { setTimeout: typeof setTimeout };
  };
  const previousWindow = globalWithWindow.window;
  globalWithWindow.window = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
  };
  try {
    return await run();
  } finally {
    if (previousWindow === undefined)
      Reflect.deleteProperty(globalWithWindow, "window");
    else globalWithWindow.window = previousWindow;
  }
}

export type PointerListenerType = "pointermove" | "pointerup" | "pointercancel";

export type MockElementFactory = (args?: {
  closestMap?: Record<string, unknown>;
  queryMap?: Record<string, unknown>;
  rect?: { left: number; top: number; width: number; height: number };
}) => HTMLElement;

export function withPointerWindow<T>(
  run: (
    listeners: Map<PointerListenerType, (event: PointerEvent) => void>,
  ) => T,
): T {
  const globalWithWindow = globalThis as {
    window?: {
      setTimeout: typeof setTimeout;
      addEventListener: (
        type: PointerListenerType,
        listener: (event: PointerEvent) => void,
      ) => void;
      removeEventListener: (
        type: PointerListenerType,
        listener: (event: PointerEvent) => void,
      ) => void;
    };
  };
  const previousWindow = globalWithWindow.window;
  const listeners = new Map<
    PointerListenerType,
    (event: PointerEvent) => void
  >();
  globalWithWindow.window = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  try {
    return run(listeners);
  } finally {
    if (previousWindow === undefined)
      Reflect.deleteProperty(globalWithWindow, "window");
    else globalWithWindow.window = previousWindow;
  }
}

export function withMockHTMLElement<T>(
  run: (createElement: MockElementFactory) => T,
): T {
  const globalWithHTMLElement = globalThis as typeof globalThis & {
    HTMLElement?: typeof HTMLElement;
  };
  const previousHTMLElement = globalWithHTMLElement.HTMLElement;

  class MockHTMLElement {
    private readonly closestMap: Record<string, unknown>;
    private readonly queryMap: Record<string, unknown>;
    private readonly rect: {
      left: number;
      top: number;
      width: number;
      height: number;
    };

    constructor(args?: {
      closestMap?: Record<string, unknown>;
      queryMap?: Record<string, unknown>;
      rect?: { left: number; top: number; width: number; height: number };
    }) {
      this.closestMap = args?.closestMap ?? {};
      this.queryMap = args?.queryMap ?? {};
      this.rect = args?.rect ?? { left: 0, top: 0, width: 1000, height: 500 };
    }

    closest(selector: string): Element | null {
      return (this.closestMap[selector] ?? null) as Element | null;
    }

    querySelector(selector: string): Element | null {
      return (this.queryMap[selector] ?? null) as Element | null;
    }

    getBoundingClientRect(): DOMRect {
      const { left, top, width, height } = this.rect;
      return {
        x: left,
        y: top,
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        toJSON: () => ({}),
      } as DOMRect;
    }

    setPointerCapture() {
      // Pointer capture is intentionally inert in these component tests.
    }

    releasePointerCapture() {
      // Pointer capture is intentionally inert in these component tests.
    }
  }

  globalWithHTMLElement.HTMLElement =
    MockHTMLElement as unknown as typeof HTMLElement;
  try {
    return run((args) => new MockHTMLElement(args) as unknown as HTMLElement);
  } finally {
    if (previousHTMLElement === undefined) {
      Reflect.deleteProperty(globalWithHTMLElement, "HTMLElement");
    } else {
      globalWithHTMLElement.HTMLElement = previousHTMLElement;
    }
  }
}

export function stageCanvasFrom(root: ReactNode): ReactElement {
  return findRequiredElement(
    root,
    (element) => element.type === SlideCanvasVNext,
    "Expected stage canvas to render.",
  );
}

export function nodePointerDownFrom(
  root: ReactNode,
): NonNullable<
  React.ComponentProps<typeof SlideCanvasVNext>["onNodePointerDown"]
> {
  const onNodePointerDown = (
    stageCanvasFrom(root).props as {
      onNodePointerDown?: React.ComponentProps<
        typeof SlideCanvasVNext
      >["onNodePointerDown"];
    }
  ).onNodePointerDown;
  assert.ok(onNodePointerDown);
  return onNodePointerDown;
}

export function focusNode(root: ReactNode, nodeId: string) {
  const onNodeFocus = (
    stageCanvasFrom(root).props as {
      onNodeFocus?: React.ComponentProps<
        typeof SlideCanvasVNext
      >["onNodeFocus"];
    }
  ).onNodeFocus;
  assert.ok(onNodeFocus);
  onNodeFocus(nodeId, {} as React.FocusEvent);
}

export function clickNode(
  root: ReactNode,
  listeners: Map<PointerListenerType, (event: PointerEvent) => void>,
  createElement: MockElementFactory,
  nodeId: string,
  options: {
    clientX?: number;
    clientY?: number;
    canvasRect?: { left: number; top: number; width: number; height: number };
    shiftKey?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
  } = {},
) {
  const canvasElement = createElement({
    rect: options.canvasRect ?? { left: 0, top: 0, width: 1000, height: 1000 },
  });
  const currentTarget = createElement({
    closestMap: {
      '[data-slide-canvas-vnext="true"]': canvasElement,
    },
  });
  const clientX = options.clientX ?? 100;
  const clientY = options.clientY ?? 100;
  nodePointerDownFrom(root)(nodeId, {
    button: 0,
    pointerId: 1,
    clientX,
    clientY,
    shiftKey: options.shiftKey ?? false,
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    altKey: options.altKey ?? false,
    target: currentTarget,
    currentTarget,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  } as unknown as React.PointerEvent);
  listeners.get("pointerup")?.({
    clientX,
    clientY,
  } as PointerEvent);
}
