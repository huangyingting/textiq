import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import {
  buildDeck,
  buildMinimalThemePackage,
  buildShapeNode,
  buildSlide,
  buildTextContent,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import { createServerRenderHarness } from "@/test/react-server-renderer";
import {
  DeckGenerationDiagnosticsNotice,
  DeckGenerationPreview,
  diffDecks,
} from "./deck-generation-preview";
import { PresentMode } from "./present-mode";
import {
  PresenterPanelPresentation,
  SlideOverviewPanelPresentation,
} from "./present-mode/presenter-tools";
import { PublicPresentViewer } from "./public-present-viewer";

type ElementProps = Record<string, unknown>;

type PortalLike = {
  children?: ReactNode;
  [key: string]: unknown;
};

function createHookRenderer({ runEffects = false } = {}) {
  return createServerRenderHarness({
    idPrefix: "presenter-coverage-id",
    runEffects,
    runLayoutEffects: runEffects,
  });
}

function collectElements(node: ReactNode, elements: ReactElement[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, elements);
    return elements;
  }
  if (isValidElement(node)) {
    elements.push(node);
    collectElements(
      (node.props as { children?: ReactNode }).children,
      elements,
    );
    return elements;
  }
  const maybePortal = node as PortalLike | null;
  if (maybePortal && maybePortal["$$typeof"] === Symbol.for("react.portal")) {
    collectElements(maybePortal.children, elements);
  }
  return elements;
}

function propsOf(element: ReactElement): ElementProps {
  return element.props as ElementProps;
}

function findProps(
  tree: ReactNode,
  predicate: (props: ElementProps) => boolean,
) {
  const element = collectElements(tree).find((candidate) =>
    predicate(propsOf(candidate)),
  );
  assert.ok(element);
  return propsOf(element);
}

function clickByLabel(tree: ReactNode, label: string) {
  const props = findProps(
    tree,
    (candidate) =>
      candidate.label === label || candidate["aria-label"] === label,
  );
  assert.equal(typeof props.onClick, "function", label);
  return (props.onClick as () => unknown)();
}

function buttonText(props: ElementProps): string {
  const textFromChild = (child: unknown): string => {
    if (typeof child === "string" || typeof child === "number") {
      return String(child);
    }
    if (Array.isArray(child)) return child.map(textFromChild).join("");
    if (isValidElement(child)) return textFromChild(propsOf(child).children);
    return "";
  };
  const children = props.children;
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(textFromChild).join("").trim();
  }
  return "";
}

function clickButtonText(tree: ReactNode, text: string) {
  const props = findProps(
    tree,
    (candidate) =>
      buttonText(candidate) === text && typeof candidate.onClick === "function",
  );
  return (props.onClick as () => unknown)();
}

async function withHappyDom<T>(
  run: (window: Window) => T | Promise<T>,
): Promise<T> {
  const window = new Window({ url: "https://textiq.test/present#2" });
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>(
    [
      "window",
      "document",
      "Node",
      "Element",
      "HTMLElement",
      "ResizeObserver",
      "KeyboardEvent",
      "TouchEvent",
      "CustomEvent",
      "fetch",
      "performance",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 720,
  });
  Object.assign(window.document.body.style, { overflow: "" });
  Object.assign(window.document.documentElement.style, { overflow: "" });
  const runTimer = (callback: () => void) => {
    callback();
    return 0;
  };
  window.setTimeout = runTimer as unknown as typeof window.setTimeout;
  window.clearTimeout = (() =>
    undefined) as unknown as typeof window.clearTimeout;
  window.setInterval = (() => 0) as unknown as typeof window.setInterval;
  window.clearInterval = (() =>
    undefined) as unknown as typeof window.clearInterval;
  const globals: Record<string, unknown> = {
    window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    KeyboardEvent: window.KeyboardEvent,
    TouchEvent: window.TouchEvent,
    CustomEvent: window.CustomEvent,
    ResizeObserver: class {
      observe(): void {
        // no-op for direct hook rendering
      }
      disconnect(): void {
        // no-op for direct hook rendering
      }
    },
    performance: { now: () => 25 },
    setTimeout: runTimer,
    clearTimeout: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
  };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  try {
    return await run(window);
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    window.close();
  }
}

function deckWithLabels() {
  return buildDeck([
    buildSlide(
      "content",
      [
        buildTextNode({
          id: "title-one",
          role: "title",
          content: buildTextContent(["Launch plan"]),
        }),
      ],
      { id: "slide-one", name: "Launch plan", notes: "Talk track" },
    ),
    buildSlide(
      "content",
      [
        buildShapeNode({
          id: "shape-two",
          content: { shape: "rect" },
        }),
      ],
      { id: "slide-two", notes: "Second notes" },
    ),
  ]);
}

function diagnostic(message: string): PresentationDiagnostic {
  return {
    code: "local-style-overrides",
    category: "validation",
    severity: "warning",
    message,
    target: { scope: "deck" },
  };
}

test("PresentMode toggles controls, notes, overview, timer, laser, and exit handlers", async () => {
  await withHappyDom(async () => {
    const deck = deckWithLabels();
    let closeCalls = 0;
    const renderer = createHookRenderer({ runEffects: true });
    let tree = renderer.run(() =>
      PresentMode({
        deck,
        themePackage: buildMinimalThemePackage(),
        onClose: () => {
          closeCalls += 1;
        },
      }),
    );
    tree = renderer.run(() =>
      PresentMode({
        deck,
        themePackage: buildMinimalThemePackage(),
        onClose: () => closeCalls++,
      }),
    );

    clickByLabel(tree, "Show keyboard shortcuts");
    tree = renderer.run(() =>
      PresentMode({
        deck,
        themePackage: buildMinimalThemePackage(),
        onClose: () => closeCalls++,
      }),
    );
    assert.ok(
      collectElements(tree).some((element) => propsOf(element).onClose),
      "keyboard help overlay exposes an onClose callback",
    );
    clickByLabel(tree, "Hide keyboard shortcuts");

    tree = renderer.run(() =>
      PresentMode({
        deck,
        themePackage: buildMinimalThemePackage(),
        onClose: () => closeCalls++,
      }),
    );
    clickByLabel(tree, "Show speaker notes");
    clickByLabel(tree, "Show slide overview");
    clickByLabel(tree, "Show timer");
    clickByLabel(tree, "Enable laser pointer");
    tree = renderer.run(() =>
      PresentMode({
        deck,
        themePackage: buildMinimalThemePackage(),
        onClose: () => closeCalls++,
      }),
    );

    assert.ok(
      collectElements(tree).some(
        (element) =>
          typeof element.type === "function" &&
          element.type.name === "PresenterPanelPresentation",
      ),
    );
    const overview = findProps(
      tree,
      (props) =>
        Array.isArray(props.slides) && typeof props.onJump === "function",
    );
    (overview.onJump as (index: number) => void)(1);
    tree = renderer.run(() =>
      PresentMode({
        deck,
        themePackage: buildMinimalThemePackage(),
        onClose: () => closeCalls++,
      }),
    );

    assert.ok(
      collectElements(tree).some(
        (element) => propsOf(element).laserActive === true,
      ),
      "laser icon receives active state",
    );
    await clickByLabel(tree, "Enter fullscreen");
    clickByLabel(tree, "Exit presentation");
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(closeCalls, 1);
  });
});

test("PublicPresentViewer drives navigation, embed chrome, and recovery details", async () => {
  await withHappyDom(() => {
    const deck = deckWithLabels();
    const renderer = createHookRenderer({ runEffects: true });
    let tree = renderer.run(() =>
      PublicPresentViewer({
        deck,
        themePackage: buildMinimalThemePackage(),
        title: "Published Launch",
        showAttribution: true,
      }),
    );
    const root = findProps(
      tree,
      (props) => props["aria-label"] === "Presentation: Published Launch",
    );
    (root.onTouchStart as (event: unknown) => void)({
      touches: [{ clientX: 300 }],
    });
    (root.onTouchEnd as (event: unknown) => void)({
      changedTouches: [{ clientX: 100 }],
    });
    clickByLabel(tree, "Next slide");
    tree = renderer.run(() =>
      PublicPresentViewer({
        deck,
        themePackage: buildMinimalThemePackage(),
        title: "Published Launch",
      }),
    );
    clickByLabel(tree, "Previous slide");

    const embedHtml = renderToStaticMarkup(
      createElement(PublicPresentViewer, {
        deck,
        themePackage: buildMinimalThemePackage(),
        title: "Embed Launch",
        embed: true,
      }),
    );
    const recoveryWithoutDetails = renderToStaticMarkup(
      createElement(PublicPresentViewer, {
        deck,
        title: "Recovery",
        showAttribution: true,
        recovery: { error: "Cannot parse", diagnostics: [] },
      }),
    );

    assert.doesNotMatch(embedHtml, /Presentation controls/);
    assert.match(embedHtml, /2 \/ 2/);
    assert.match(
      recoveryWithoutDetails,
      /Presentation deck could not be opened/,
    );
    assert.doesNotMatch(recoveryWithoutDetails, /<ul/);
  });
});

test("Presenter tools resolve fallback labels and safe overview handlers", () => {
  const deck = buildDeck([
    buildSlide(
      "content",
      [
        buildTextNode({
          id: "group-label-text",
          content: buildTextContent(["Nested shape label"]),
        }),
      ],
      { id: "unnamed", name: "\n", notes: "Notes fallback" },
    ),
  ]);
  const themePackage = buildMinimalThemePackage();
  const currentSlide = deck.slides[0];
  assert.ok(currentSlide);
  const resolved = renderToStaticMarkup(
    createElement(PresenterPanelPresentation, {
      currentSlide,
      currentIndex: 0,
      total: 1,
      canvas: { format: "16:9", width: 0, height: 0, unit: "percent" },
    }),
  );
  const renderTree = {
    canvas: { format: "16:9", width: 0, height: 0, unit: "percent" },
    theme: {
      tokens: themePackage.tokens,
      packageId: themePackage.id,
      packageVersion: themePackage.version,
    },
    diagnostics: [],
    slides: [
      {
        id: "slide-tree",
        background: {
          fill: { type: "solid", color: "#fff" },
          decorationLevel: "none",
        },
        decorations: [],
        chrome: [],
        nodes: [],
      },
    ],
  } satisfies Parameters<
    typeof SlideOverviewPanelPresentation
  >[0]["renderTree"];
  const overviewPropsInput = {
    slides: deck.slides,
    renderTree,
    currentIndex: 0,
    onJump: () => undefined,
    onClose: () => undefined,
  } satisfies Parameters<typeof SlideOverviewPanelPresentation>[0];
  const overview = SlideOverviewPanelPresentation(overviewPropsInput);
  const overviewProps = findProps(overview, (props) => props.role === "dialog");
  (overviewProps.onClick as (event: { stopPropagation: () => void }) => void)({
    stopPropagation: () => undefined,
  });

  assert.equal(themePackage.id, "test-package");
  assert.match(resolved, /Nested shape label/);
  assert.match(
    renderToStaticMarkup(
      createElement(SlideOverviewPanelPresentation, overviewPropsInput),
    ),
    /Current/,
  );
});

test("DeckGenerationPreview renders diagnostics, applies actions, and handles regeneration outcomes", async () => {
  await withHappyDom(async () => {
    const baselineDeck = buildDeck([
      buildSlide("content", [buildTextNode({ id: "same" })], {
        id: "same-slide",
      }),
    ]);
    const proposedDeck = buildDeck([
      buildSlide("content", [buildTextNode({ id: "same" })], {
        id: "same-slide",
      }),
      buildSlide("content", [buildTextNode({ id: "new" })], {
        id: "new-slide",
      }),
    ]);
    const diff = diffDecks(baselineDeck, proposedDeck, {
      stringifySlide: (slide) => slide.id,
    });
    assert.equal(diff.added, 1);
    assert.match(diff.summary, /2 slides/);

    let reviewed = 0;
    const notice = DeckGenerationDiagnosticsNotice({
      diagnosticsCount: 1,
      isRegenerating: false,
      onReview: () => {
        reviewed += 1;
      },
    });
    assert.ok(notice);
    clickButtonText(notice, "Review AI diagnostics (1)");
    assert.equal(reviewed, 1);
    assert.equal(
      DeckGenerationDiagnosticsNotice({
        diagnosticsCount: 0,
        isRegenerating: false,
        onReview: () => undefined,
      }),
      null,
    );

    const calls: string[] = [];
    let failFetch = false;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async () =>
        failFetch
          ? new Response(JSON.stringify({ error: "No credits" }), {
              status: 402,
            })
          : new Response(
              JSON.stringify({
                deck: proposedDeck,
                truncated: false,
                diagnostics: [diagnostic("Fresh diagnostic")],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
    });

    const renderer = createHookRenderer({ runEffects: true });
    const props = {
      proposedDeck,
      baselineDeck,
      themePackage: buildMinimalThemePackage(),
      truncated: true,
      generationDiagnostics: [diagnostic("Initial diagnostic")],
      contentJson: "{}",
      options: { length: "short" as const },
      onApply: () => calls.push("apply"),
      onDerive: () => calls.push("derive"),
      onCancel: () => calls.push("cancel"),
    };
    let tree = renderer.run(() => DeckGenerationPreview(props));
    clickButtonText(tree, "Cancel");
    clickButtonText(tree, "Use derived deck instead");
    clickButtonText(tree, "Apply");
    await clickButtonText(tree, "Regenerate");
    tree = renderer.run(() => DeckGenerationPreview(props));
    failFetch = true;
    await clickButtonText(tree, "Regenerate");
    tree = renderer.run(() => DeckGenerationPreview(props));

    assert.deepEqual(calls, ["cancel", "derive", "apply"]);
    assert.ok(
      collectElements(tree).some((element) =>
        String(propsOf(element).children ?? "").includes(
          "showing the previous draft",
        ),
      ),
    );
  });
});
