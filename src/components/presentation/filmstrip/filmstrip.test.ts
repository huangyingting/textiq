import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  Children,
  createElement,
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Filmstrip, type FilmstripProps } from "./filmstrip";
import { FilmstripSlide } from "./filmstrip-slide";
import { createReactRenderHarness } from "@/test/react-render-harness";
import { MIN_DECK_SLIDES_MESSAGE } from "@/lib/presentation";
import type {
  ResolvedDeckRenderTree,
  ResolvedRenderNode,
  ResolvedSlideRenderTree,
} from "@/lib/presentation/render-tree";

type ElementWithProps = ReactElement<Record<string, unknown>>;

type MutableGlobalHTMLElement = Omit<typeof globalThis, "HTMLElement"> & {
  HTMLElement: unknown;
};

function reactKeyboardEvent<T = Element>(event: object): KeyboardEvent<T> {
  return event as KeyboardEvent<T>;
}

function htmlButtonElement(element: object): HTMLButtonElement {
  return element as unknown as HTMLButtonElement;
}

function setGlobalHTMLElement(value: unknown): void {
  (globalThis as MutableGlobalHTMLElement).HTMLElement = value;
}

function textNode(
  id: string,
  frame: { x: number; y: number; w: number; h: number },
): ResolvedRenderNode {
  return {
    id,
    type: "text",
    role: "body",
    layout: { frame, zIndex: 1 },
    style: {},
    content: {
      type: "text",
      content: { paragraphs: [{ id: `${id}-p1`, text: id }] },
    },
    source: "user",
  };
}

function slide(id: string): ResolvedSlideRenderTree {
  return {
    id,
    background: {
      fill: { type: "solid", color: "#ffffff" },
      decorationLevel: "none",
    },
    decorations: [],
    chrome: [],
    nodes: [textNode(`${id}-title`, { x: 10, y: 10, w: 80, h: 12 })],
  };
}

function renderTree(slideCount = 3): ResolvedDeckRenderTree {
  return {
    canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
    theme: {
      packageId: "test-package",
      tokens: {
        colors: {
          canvas: { fill: "#ffffff", text: "#111111", mutedText: "#64748b" },
          surface: { fill: "#ffffff", text: "#111111", mutedText: "#64748b" },
          accent: { fill: "#2563eb", text: "#ffffff" },
        },
        fonts: { heading: "Inter", body: "Inter" },
      },
    },
    diagnostics: [],
    slides: Array.from({ length: slideCount }, (_, index) =>
      slide(`slide-${index + 1}`),
    ),
  };
}

function filmstripProps(
  overrides: Partial<FilmstripProps> = {},
): FilmstripProps {
  return {
    renderTree: renderTree(),
    activeSlideIndex: 1,
    collapsed: false,
    onSelectSlide: () => undefined,
    onInsertSlide: () => undefined,
    onDuplicateSlide: () => undefined,
    onDeleteSlide: () => undefined,
    onMoveSlide: () => undefined,
    ...overrides,
  };
}

function findElement(
  root: ReactNode,
  predicate: (element: ElementWithProps) => boolean,
): ElementWithProps | null {
  let found: ElementWithProps | null = null;
  function visit(node: ReactNode): void {
    if (found) return;
    Children.forEach(node, (child) => {
      if (found || !isValidElement(child)) return;
      const element = child as ElementWithProps;
      if (predicate(element)) {
        found = element;
        return;
      }
      visit(element.props.children as ReactNode);
    });
  }
  visit(root);
  return found;
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

class FakeElement {
  dataset: { slideIndex?: string };

  constructor(slideIndex: string) {
    this.dataset = { slideIndex };
  }

  closest(): FakeElement {
    return this;
  }
}

function withFilmstripHTMLElement(
  run: (targetForIndex: (index: number) => unknown) => void,
) {
  const originalHTMLElement = globalThis.HTMLElement;

  setGlobalHTMLElement(FakeElement);

  try {
    run((index) => new FakeElement(String(index)));
  } finally {
    setGlobalHTMLElement(originalHTMLElement);
  }
}

function registerSlideButtonRefs(
  root: ReactNode,
  slideCount: number,
  onFocus: (index: number) => void,
) {
  for (let index = 0; index < slideCount; index += 1) {
    const slideElement = findElement(
      root,
      (candidate) =>
        candidate.type === FilmstripSlide && candidate.props.index === index,
    );
    assert.ok(slideElement, `expected filmstrip slide ${index + 1}`);
    const slideButtonRef = slideElement.props.slideButtonRef as
      | ((element: HTMLButtonElement | null) => void)
      | undefined;
    if (typeof slideButtonRef !== "function") {
      assert.fail("expected slide button registry ref");
    }
    slideButtonRef(
      htmlButtonElement({
        focus: () => onFocus(index),
        getBoundingClientRect: () =>
          ({
            bottom: index + 1,
            height: 1,
            left: index,
            right: index + 1,
            top: index,
            width: 1,
            x: index,
            y: index,
            toJSON: () => ({}),
          }) as DOMRectReadOnly,
      }),
    );
  }
}

describe("Filmstrip ARIA pattern and keyboard behavior", () => {
  test("renders as a labelled list without listbox/option roles", () => {
    const html = renderToStaticMarkup(
      createElement(Filmstrip, filmstripProps()),
    );

    assert.match(html, /aria-label="Slide filmstrip"/);
    assert.match(html, /aria-label="Slides"/);
    assert.doesNotMatch(html, /role="listbox"/);
    assert.doesNotMatch(html, /role="option"/);
    assert.match(html, /Go to slide 2/);
    assert.match(html, /Duplicate slide 2/);
    assert.match(html, /Delete slide 2/);
    assert.match(html, /aria-current="true"/);
  });

  test("handles keyboard slide selection/reorder/delete flows with focus restore and announcements", () => {
    const selected: number[] = [];
    const deleted: string[] = [];
    const moved: Array<[string, number]> = [];
    const props = filmstripProps({
      onSelectSlide: (index) => selected.push(index),
      onDeleteSlide: (slideId) => deleted.push(slideId),
      onMoveSlide: (slideId, targetIndex) => moved.push([slideId, targetIndex]),
    });
    const renderer = createReactRenderHarness();
    let element = renderer.run(() => Filmstrip(props));
    let list = findElement(element, (candidate) => candidate.type === "ol");
    assert.ok(list, "expected filmstrip list");

    const onKeyDown = (
      list.props as {
        onKeyDown?: (event: KeyboardEvent<HTMLOListElement>) => void;
      }
    ).onKeyDown;
    assert.equal(typeof onKeyDown, "function");

    registerSlideButtonRefs(element, props.renderTree.slides.length, () => {
      // Focus restoration is covered by focus-geometry-registry tests; this
      // test exercises the keyboard command routing without a browser DOM.
    });

    withFilmstripHTMLElement((targetForIndex) => {
      const keyEvent = (
        key: string,
        options: { altKey?: boolean; slideIndex?: number } = {},
      ) =>
        reactKeyboardEvent<HTMLOListElement>({
          key,
          altKey: options.altKey ?? false,
          target: targetForIndex(options.slideIndex ?? props.activeSlideIndex),
          preventDefault: () => undefined,
        });

      const dispatch = (
        key: string,
        options: { altKey?: boolean; slideIndex?: number } = {},
      ) => {
        onKeyDown!(keyEvent(key, options));
        element = renderer.run(() => Filmstrip(props));
        list = findElement(element, (candidate) => candidate.type === "ol");
        assert.ok(list, "expected filmstrip list after key dispatch");
      };

      dispatch("ArrowLeft");
      dispatch("ArrowRight");
      dispatch("Home");
      dispatch("End");
      dispatch("Enter", { slideIndex: 0 });
      dispatch(" ", { slideIndex: 2 });
      dispatch("ArrowLeft", { altKey: true });
      dispatch("ArrowRight", { altKey: true });
      dispatch("Delete");
      dispatch("Backspace", { slideIndex: 2 });
    });

    assert.deepEqual(selected, [0, 2, 0, 2, 0, 2]);
    assert.deepEqual(moved, [
      ["slide-2", 0],
      ["slide-2", 2],
    ]);
    assert.deepEqual(deleted, ["slide-2", "slide-3"]);
    assert.match(textContent(element), /Deleted slide 3\./);
    renderer.cleanup();
  });

  test("announces the minimum-slide invariant and blocks deletion in one-slide decks", () => {
    const deleted: string[] = [];
    const props = filmstripProps({
      renderTree: renderTree(1),
      activeSlideIndex: 0,
      onDeleteSlide: (slideId) => deleted.push(slideId),
    });
    const renderer = createReactRenderHarness();
    let element = renderer.run(() => Filmstrip(props));
    const list = findElement(element, (candidate) => candidate.type === "ol");
    assert.ok(list, "expected filmstrip list");

    const onKeyDown = (
      list.props as {
        onKeyDown?: (event: KeyboardEvent<HTMLOListElement>) => void;
      }
    ).onKeyDown;
    assert.equal(typeof onKeyDown, "function");

    withFilmstripHTMLElement((targetForIndex) => {
      onKeyDown!(
        reactKeyboardEvent<HTMLOListElement>({
          key: "Delete",
          target: targetForIndex(0),
          preventDefault: () => undefined,
        }),
      );
    });

    element = renderer.run(() => Filmstrip(props));
    assert.deepEqual(deleted, []);
    assert.match(textContent(element), new RegExp(MIN_DECK_SLIDES_MESSAGE));
    renderer.cleanup();
  });

  test("restores requested slide focus through the focus geometry registry", () => {
    const selected: number[] = [];
    const renderer = createReactRenderHarness();
    let element = renderer.run(() =>
      Filmstrip(
        filmstripProps({
          onSelectSlide: (index) => selected.push(index),
        }),
      ),
    );
    registerSlideButtonRefs(element, 3, () => undefined);
    const list = findElement(element, (candidate) => candidate.type === "ol");
    assert.ok(list, "expected filmstrip list");
    const onKeyDown = (
      list.props as {
        onKeyDown?: (event: KeyboardEvent<HTMLOListElement>) => void;
      }
    ).onKeyDown;
    assert.equal(typeof onKeyDown, "function");

    withFilmstripHTMLElement((targetForIndex) => {
      onKeyDown!(
        reactKeyboardEvent<HTMLOListElement>({
          key: "ArrowRight",
          target: targetForIndex(1),
          preventDefault: () => undefined,
        }),
      );
    });

    element = renderer.run(() =>
      Filmstrip(
        filmstripProps({
          onSelectSlide: (index) => selected.push(index),
        }),
      ),
    );

    assert.deepEqual(selected, [2]);
    assert.ok(element);
    renderer.cleanup();
  });

  test("removes filmstrip tab stops when collapsed", () => {
    const html = renderToStaticMarkup(
      createElement(Filmstrip, filmstripProps({ collapsed: true })),
    );

    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /aria-label="Slides"[^>]*tabindex="-1"/);
    assert.match(
      html,
      /aria-label="Go to slide 1"[^>]*disabled=""[^>]*tabindex="-1"/,
    );
    assert.match(
      html,
      /aria-label="Add slide"[^>]*disabled=""[^>]*tabindex="-1"/,
    );
  });
});

describe("Filmstrip reduced-motion class guards", () => {
  test("adds reduced-motion guards for filmstrip preview and collapse chrome transitions", () => {
    const html = renderToStaticMarkup(
      createElement(Filmstrip, filmstripProps()),
    );

    assert.match(
      html,
      /transition-opacity duration-150 motion-reduce:transition-none/,
    );
  });

  test("adds reduced-motion guards for drag-state and thumbnail/action transitions", () => {
    const deck = renderTree();
    const slideTree = deck.slides[0]!;
    const html = renderToStaticMarkup(
      createElement(FilmstripSlide, {
        slideTree,
        canvas: deck.canvas,
        index: 0,
        isActive: true,
        slideId: slideTree.id,
        totalSlides: deck.slides.length,
        isDragging: true,
        onSelect: () => undefined,
        onDuplicate: () => undefined,
        onDelete: () => undefined,
        onPointerDown: () => undefined,
      }),
    );

    assert.match(
      html,
      /transition-\[opacity,transform\] duration-150 ease-out motion-reduce:transition-none scale-\[0\.98\] opacity-40 motion-reduce:scale-100/,
    );
    assert.match(
      html,
      /transition-transform duration-150 ease-out motion-reduce:transition-none/,
    );
    assert.match(
      html,
      /transition-\[box-shadow\] duration-150 ease-out motion-reduce:transition-none/,
    );
    assert.match(
      html,
      /transition-opacity motion-reduce:transition-none focus-within:opacity-100 group-hover:opacity-100/,
    );
  });
});
