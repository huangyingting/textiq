import assert from "node:assert/strict";
import { test } from "node:test";

import {
  anchorPositionForBlock,
  commentBlockAtY,
  computeCommentCardPosition,
  isInRightCommentGutter,
  isTextCommentBlock,
  isVisualCommentBlock,
  normalizeInlineAnchorText,
  preferredRightSideCardLeft,
  type AnchorPosition,
} from "./inline-comment-dom";

function anchor(partial: Partial<AnchorPosition> = {}): AnchorPosition {
  return {
    text: "Paragraph",
    top: 120,
    iconLeft: 820,
    markerLeft: 820,
    ...partial,
  };
}

class FakeElement {
  children: FakeElement[] = [];
  textContent: string | null;
  private rect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    height: number;
  };
  private visual: boolean;

  constructor({
    text = "",
    rect = { top: 0, bottom: 0, left: 0, right: 0, height: 0 },
    visual = false,
    children = [],
  }: {
    text?: string;
    rect?: {
      top: number;
      bottom: number;
      left: number;
      right: number;
      height: number;
    };
    visual?: boolean;
    children?: FakeElement[];
  } = {}) {
    this.textContent = text;
    this.rect = rect;
    this.visual = visual;
    this.children = children;
  }

  closest(): FakeElement | null {
    return this.visual ? this : null;
  }

  querySelector(): FakeElement | null {
    return this.visual || this.children.some((child) => child.visual)
      ? this
      : null;
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

function asHTMLElement(element: FakeElement): HTMLElement {
  return element as unknown as HTMLElement;
}

function withFakeHTMLElement(run: () => void): void {
  const original = globalThis.HTMLElement;
  const originalWindow = globalThis.window;
  Reflect.set(globalThis, "HTMLElement", FakeElement);
  Reflect.set(globalThis, "window", { innerWidth: 1024 });
  try {
    run();
  } finally {
    Reflect.set(globalThis, "HTMLElement", original);
    Reflect.set(globalThis, "window", originalWindow);
  }
}

test("normalizeInlineAnchorText collapses whitespace and truncates", () => {
  assert.equal(normalizeInlineAnchorText("  Hello\n\nworld  "), "Hello world");
  assert.equal(normalizeInlineAnchorText("x".repeat(400)).length, 280);
});

test("preferredRightSideCardLeft places the card after the gutter button", () => {
  assert.equal(preferredRightSideCardLeft(anchor({ iconLeft: 100 })), 144);
});

test("computeCommentCardPosition clamps card to viewport", () => {
  const result = computeCommentCardPosition({
    anchor: anchor({ top: 5, iconLeft: 980 }),
    viewportWidth: 1000,
    viewportHeight: 300,
    measuredWidth: 240,
    measuredHeight: 120,
  });

  assert.equal(result.top, 10);
  assert.equal(result.left, 724);
  assert.equal(result.maxHeight, 280);
});

test("text and visual block detection use normalized text and visual markers", () => {
  withFakeHTMLElement(() => {
    const textBlock = new FakeElement({ text: "  Paragraph text  " });
    const emptyBlock = new FakeElement({ text: "   " });
    const visualBlock = new FakeElement({ text: "Caption", visual: true });
    const wrapperBlock = new FakeElement({
      text: "Wrapper",
      children: [new FakeElement({ visual: true })],
    });

    assert.equal(isVisualCommentBlock(asHTMLElement(textBlock)), false);
    assert.equal(isVisualCommentBlock(asHTMLElement(wrapperBlock)), true);
    assert.equal(isTextCommentBlock(asHTMLElement(textBlock)), true);
    assert.equal(
      isTextCommentBlock(
        asHTMLElement(new FakeElement({ text: null as never })),
      ),
      false,
    );
    assert.equal(isTextCommentBlock(asHTMLElement(emptyBlock)), false);
    assert.equal(isTextCommentBlock(asHTMLElement(visualBlock)), false);
  });
});

test("isTextCommentBlock rejects wrapper blocks that contain visual chrome", () => {
  withFakeHTMLElement(() => {
    const wrapperBlock = new FakeElement({
      text: "Chart caption",
      children: [new FakeElement({ visual: true })],
    });

    assert.equal(isTextCommentBlock(asHTMLElement(wrapperBlock)), false);
  });
});

test("commentBlockAtY returns direct hits, nearby text blocks, and skips visual blocks", () => {
  withFakeHTMLElement(() => {
    const first = new FakeElement({
      text: "First",
      rect: { top: 10, bottom: 40, left: 0, right: 100, height: 30 },
    });
    const visual = new FakeElement({
      text: "Visual",
      visual: true,
      rect: { top: 50, bottom: 80, left: 0, right: 100, height: 30 },
    });
    const second = new FakeElement({
      text: "Second",
      rect: { top: 120, bottom: 150, left: 0, right: 100, height: 30 },
    });
    const root = new FakeElement({ children: [first, visual, second] });

    const rootElement = asHTMLElement(root);
    assert.equal(commentBlockAtY(rootElement, 20), first);
    assert.equal(commentBlockAtY(rootElement, 60), null);
    assert.equal(commentBlockAtY(rootElement, 95), second);
    assert.equal(commentBlockAtY(rootElement, 300), null);
  });
});

test("gutter and anchor helpers return null when there is no right gutter room", () => {
  withFakeHTMLElement(() => {
    const root = new FakeElement({
      rect: { top: 0, bottom: 100, left: 4, right: 1000, height: 100 },
    });
    const block = new FakeElement({
      text: "Paragraph",
      rect: { top: 20, bottom: 60, left: 10, right: 100, height: 40 },
    });

    assert.equal(isInRightCommentGutter(asHTMLElement(root), 130), false);
    assert.equal(
      anchorPositionForBlock(asHTMLElement(block), asHTMLElement(root)),
      null,
    );
  });
});

test("anchorPositionForBlock and gutter hit testing use right-side button geometry", () => {
  withFakeHTMLElement(() => {
    const root = new FakeElement({
      rect: { top: 0, bottom: 100, left: 100, right: 300, height: 100 },
    });
    const block = new FakeElement({
      text: "  Paragraph\nanchor  ",
      rect: { top: 20, bottom: 60, left: 120, right: 280, height: 40 },
    });

    assert.equal(isInRightCommentGutter(asHTMLElement(root), 320), true);
    assert.deepEqual(
      anchorPositionForBlock(asHTMLElement(block), asHTMLElement(root)),
      {
        text: "Paragraph anchor",
        top: 40,
        iconLeft: 308,
        markerLeft: 308,
      },
    );
  });
});

test("computeCommentCardPosition uses default dimensions when unmeasured", () => {
  assert.deepEqual(
    computeCommentCardPosition({
      anchor: anchor({ text: "Default", top: 500, iconLeft: 100 }),
      viewportWidth: 640,
      viewportHeight: 480,
      measuredWidth: 0,
      measuredHeight: 0,
    }),
    {
      anchorText: "Default",
      top: 230,
      left: 144,
      maxHeight: 460,
    },
  );
});

test("computeCommentCardPosition caps measured dimensions to small viewports", () => {
  assert.deepEqual(
    computeCommentCardPosition({
      anchor: anchor({ text: "Small", top: 300, iconLeft: 10 }),
      viewportWidth: 120,
      viewportHeight: 120,
      measuredWidth: 500,
      measuredHeight: 500,
    }),
    {
      anchorText: "Small",
      top: 10,
      left: 36,
      maxHeight: 180,
    },
  );
});
