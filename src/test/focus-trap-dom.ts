export class FocusTrapTestElement {
  focusCount = 0;
  tagName: string;
  parentElement: FocusTrapTestElement | null = null;
  listener?: (event: KeyboardEvent) => void;
  private attrs: Record<string, string>;

  constructor(
    private readonly focusables: FocusTrapTestElement[] = [],
    tagName = "BUTTON",
    attrs: Record<string, string> = {},
  ) {
    this.tagName = tagName;
    this.attrs = attrs;
  }

  /** Setting hiddenAncestor creates a synthetic hidden parent for filtering. */
  set hiddenAncestor(value: boolean) {
    if (value) {
      const parent = new FocusTrapTestElement([], "DIV", {
        "aria-hidden": "true",
      });
      this.parentElement = parent;
    } else {
      this.parentElement = null;
    }
  }

  focus(): void {
    this.focusCount += 1;
    Object.defineProperty(document, "activeElement", {
      configurable: true,
      value: this,
    });
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  hasAttribute(name: string): boolean {
    return name in this.attrs;
  }

  closest(selector: string): FocusTrapTestElement | null {
    if (selector === "[aria-hidden='true']" && this.parentElement) {
      return this.parentElement.getAttribute("aria-hidden") === "true"
        ? this
        : null;
    }
    return null;
  }

  querySelectorAll(): FocusTrapTestElement[] {
    return this.focusables;
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === "keydown") {
      this.listener = listener as (event: KeyboardEvent) => void;
    }
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type === "keydown" && this.listener === listener) {
      this.listener = undefined;
    }
  }
}

export function installFocusTrapDom(activeElement: FocusTrapTestElement) {
  const globalRef = globalThis as typeof globalThis & {
    document?: unknown;
    HTMLElement?: unknown;
  };
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalRef,
    "document",
  );
  const previousHTMLElement = Object.getOwnPropertyDescriptor(
    globalRef,
    "HTMLElement",
  );

  Object.defineProperty(globalRef, "document", {
    configurable: true,
    value: { activeElement },
  });
  Object.defineProperty(globalRef, "HTMLElement", {
    configurable: true,
    value: FocusTrapTestElement,
  });

  return () => {
    if (previousDocument) {
      Object.defineProperty(globalRef, "document", previousDocument);
    } else {
      Reflect.deleteProperty(globalRef, "document");
    }
    if (previousHTMLElement) {
      Object.defineProperty(globalRef, "HTMLElement", previousHTMLElement);
    } else {
      Reflect.deleteProperty(globalRef, "HTMLElement");
    }
  };
}
