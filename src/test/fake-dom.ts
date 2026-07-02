export type TestElementDataset = Record<string, string>;

export type TestElementFactory = {
  createElement: (
    dataset?: TestElementDataset,
    frame?: DOMRect,
    children?: TestHTMLElement[],
  ) => TestHTMLElement;
  setCanvasElement: (element: TestHTMLElement) => void;
};

export class TestHTMLElement {
  readonly focused = {
    count: 0,
    valueOf() {
      return this.count;
    },
  };

  constructor(
    readonly dataset: TestElementDataset = {},
    private readonly frame: DOMRect = makeDOMRect(0, 0, 1000, 562.5),
    private readonly children: TestHTMLElement[] = [],
    private readonly getCanvasElement?: () => TestHTMLElement | undefined,
  ) {}

  closest(selector: string): TestHTMLElement | null {
    if (selector.includes("input") || selector.includes("button")) return null;
    if (selector.includes("[data-slide-canvas")) {
      return this.getCanvasElement?.() ?? this;
    }
    if (selector.includes("[data-node-id]")) {
      return this.dataset.nodeId ? this : null;
    }
    if (
      selector.includes("[data-resize-handle]") ||
      selector.includes("[data-crop-handle]") ||
      selector.includes("[data-rotation-handle]") ||
      selector.includes("[data-connector-endpoint]")
    ) {
      return null;
    }
    return null;
  }

  querySelector(): TestHTMLElement | null {
    return this.children[0] ?? this.getCanvasElement?.() ?? this;
  }

  querySelectorAll(): TestHTMLElement[] {
    return this.children;
  }

  hasAttribute(name: string): boolean {
    return this.dataset[name] === "true";
  }

  getAttribute(name: string): string | null {
    return this.dataset[name] ?? null;
  }

  getBoundingClientRect(): DOMRect {
    return this.frame;
  }

  focus(): void {
    this.focused.count += 1;
  }

  click(): void {
    this.focused.count += 1;
  }

  setPointerCapture(): void {
    // Pointer capture test double.
  }

  releasePointerCapture(): void {
    // Pointer capture test double.
  }
}

export function createTestElementFactory(): TestElementFactory {
  let canvasElement: TestHTMLElement | undefined;
  return {
    createElement: (dataset, frame, children) =>
      new TestHTMLElement(dataset, frame, children, () => canvasElement),
    setCanvasElement: (element) => {
      canvasElement = element;
    },
  };
}

export function makeDOMRect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}
