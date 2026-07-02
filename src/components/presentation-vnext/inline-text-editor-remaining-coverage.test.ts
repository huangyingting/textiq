import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { INLINE_TEXT_COMMAND_EVENT_V7 } from "@/lib/presentation-vnext/inline-text-commands";
import type { Paragraph } from "@/lib/presentation-vnext/schema";
import { createReactHookRenderer } from "@/test/react-server-renderer";
import {
  inlineTextAlignForCommand,
  InlineTextEditorVNext,
} from "./inline-text-editor";

type HookRendererOptions = {
  runEffects?: boolean;
  firstRefCurrent?: unknown;
};

function createHookRenderer({
  runEffects = false,
  firstRefCurrent,
}: HookRendererOptions = {}) {
  return createReactHookRenderer({
    firstRefCurrent,
    idPrefix: "inline-remaining-id",
    runEffects,
    runLayoutEffects: runEffects,
  });
}

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

function editorProps(
  overrides: Partial<Parameters<typeof InlineTextEditorVNext>[0]> = {},
) {
  return {
    nodeId: "text-remaining",
    initialParagraphs: [{ id: "p-1", text: "Initial" }],
    frame: { x: 5, y: 10, w: 40, h: 12 },
    onCommit: () => undefined,
    onCancel: () => undefined,
    ...overrides,
  } satisfies Parameters<typeof InlineTextEditorVNext>[0];
}

function withHappyDom<T>(run: (window: Window) => T): T {
  const window = new Window({ url: "https://textiq.test/slides" });
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>(
    [
      "window",
      "document",
      "Node",
      "Element",
      "HTMLElement",
      "HTMLAnchorElement",
      "NodeFilter",
      "Range",
      "CustomEvent",
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const globalValues: Record<string, unknown> = {
    window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLAnchorElement: window.HTMLAnchorElement,
    NodeFilter: window.NodeFilter,
    Range: window.Range,
    CustomEvent: window.CustomEvent,
  };
  for (const [key, value] of Object.entries(globalValues)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  try {
    return run(window);
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    window.close();
  }
}

function selectNodeContents(window: Window, node: unknown) {
  const range = window.document.createRange();
  range.selectNodeContents(
    node as Parameters<typeof range.selectNodeContents>[0],
  );
  const selection = window.getSelection();
  assert.ok(selection);
  selection.removeAllRanges();
  selection.addRange(range);
}

test("InlineTextEditorVNext mounts rich HTML, places client caret, and commits auto-height text", () => {
  withHappyDom((window) => {
    const container = window.document.createElement("div");
    window.document.body.append(container);
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      value: 120,
    });
    (
      window.document as typeof window.document & {
        caretRangeFromPoint: () => Range;
      }
    ).caretRangeFromPoint = () => {
      const textNode = container.querySelector("span")?.firstChild;
      assert.ok(textNode);
      const clientRange = window.document.createRange();
      clientRange.setStart(textNode, 3);
      clientRange.collapse(true);
      return clientRange as unknown as Range;
    };
    const commits: Array<{
      paragraphs: Paragraph[];
      frame?: { x: number; y: number; w: number; h: number };
    }> = [];
    const initialParagraphs: Paragraph[] = [
      {
        id: "p-rich",
        text: "Unsafe & <tag>",
        runs: [
          { text: "Unsafe & ", bold: true },
          {
            text: "<tag>",
            italic: true,
            localStyle: { color: "#123456", fontSizePt: 14 },
          },
        ],
      },
      {
        id: "p-list",
        text: "Numbered",
        list: { kind: "number", indent: 2 },
        runs: [{ text: "Numbered", underline: true, strikethrough: true }],
      },
    ];

    const tree = createHookRenderer({
      runEffects: true,
      firstRefCurrent: container,
    }).run(() =>
      InlineTextEditorVNext(
        editorProps({
          initialParagraphs,
          canvasRect: {
            height: 200,
            width: 400,
            left: 0,
            right: 400,
            top: 0,
            bottom: 200,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          } as DOMRect,
          autoHeight: true,
          initialCaret: { kind: "client", x: 11, y: 12 },
          onCommit: (_nodeId, paragraphs, frame) => {
            commits.push({ paragraphs, frame });
          },
        }),
      ),
    );

    const editor = collectElements(tree).find(
      (element) =>
        (element.props as { "data-inline-editor-vnext"?: string })[
          "data-inline-editor-vnext"
        ] === "text-remaining",
    );
    assert.ok(editor);
    assert.match(container.innerHTML, /Unsafe &amp;/);
    assert.match(container.innerHTML, /&lt;tag&gt;/);
    assert.match(container.innerHTML, /data-list-kind="number"/);
    assert.equal(
      window.getSelection()?.anchorNode,
      container.querySelector("span")?.firstChild,
    );
    assert.equal(window.getSelection()?.anchorOffset, 3);

    (editor.props as { onInput: () => void }).onInput();
    assert.equal(container.style.height, "60%");
    (editor.props as { onBlur: () => void }).onBlur();

    assert.equal(commits.length, 1);
    assert.equal(commits[0]?.frame?.h, 60);
    assert.deepEqual(
      commits[0]?.paragraphs.map((paragraph) => paragraph.id),
      ["p-rich", "p-list"],
    );
    assert.equal(commits[0]?.paragraphs[1]?.list?.indent, 2);
  });
});

test("InlineTextEditorVNext applies toolbar formatting, list, link, and unlink commands", () => {
  withHappyDom((window) => {
    const container = window.document.createElement("div");
    window.document.body.append(container);
    const commits: Paragraph[][] = [];

    const tree = createHookRenderer({
      runEffects: true,
      firstRefCurrent: container,
    }).run(() =>
      InlineTextEditorVNext(
        editorProps({
          initialParagraphs: [{ id: "p-command", text: "Command text" }],
          onCommit: (_nodeId, paragraphs) => commits.push(paragraphs),
        }),
      ),
    );
    const editor = collectElements(tree).find(
      (element) =>
        (element.props as { "data-inline-editor-vnext"?: string })[
          "data-inline-editor-vnext"
        ] === "text-remaining",
    );
    assert.ok(editor);
    container.focus();
    selectNodeContents(window, container.firstElementChild ?? container);

    const dispatch = (command: string, value?: string) => {
      window.document.dispatchEvent(
        new window.CustomEvent(INLINE_TEXT_COMMAND_EVENT_V7, {
          detail: { command, value },
        }),
      );
    };

    for (const command of ["bold", "italic", "underline", "strikethrough"]) {
      dispatch(command);
    }
    dispatch("color", "#0f172a");
    dispatch("font-size", "18pt");
    dispatch("link", "https://example.com/source");
    assert.ok(container.querySelector("a[href='https://example.com/source']"));
    dispatch("unlink");
    assert.equal(container.querySelector("a"), null);

    container.focus();
    selectNodeContents(window, container.firstElementChild ?? container);
    dispatch("bullet-list");
    assert.ok(container.querySelector("ul li"));
    dispatch("numbered-list");
    assert.ok(container.querySelector("ol li"));
    selectNodeContents(window, container.querySelector("li") ?? container);
    dispatch("indent-list");
    dispatch("indent-list");
    dispatch("outdent-list");
    const listItem = container.querySelector("li") as HTMLElement | null;
    assert.equal(listItem?.dataset.listIndent, "1");

    (editor.props as { onBlur: () => void }).onBlur();
    assert.equal(commits.length, 1);
    assert.equal(commits[0]?.[0]?.list?.kind, "number");
    assert.equal(commits[0]?.[0]?.list?.indent, 1);
  });
});

test("InlineTextEditorVNext maps alignment commands and cancels safely without a mounted editor", () => {
  assert.equal(inlineTextAlignForCommand("align-left"), "left");
  assert.equal(inlineTextAlignForCommand("align-center"), "center");
  assert.equal(inlineTextAlignForCommand("align-right"), "right");
  assert.equal(inlineTextAlignForCommand("bold"), undefined);

  let cancelCalls = 0;
  const tree = createHookRenderer().run(() =>
    InlineTextEditorVNext(
      editorProps({
        onCancel: () => {
          cancelCalls += 1;
        },
      }),
    ),
  );
  const editor = collectElements(tree).find(
    (element) =>
      (element.props as { "data-inline-editor-vnext"?: string })[
        "data-inline-editor-vnext"
      ] === "text-remaining",
  );
  assert.ok(editor);

  (editor.props as { onBlur: () => void }).onBlur();
  (editor.props as { onBlur: () => void }).onBlur();
  assert.equal(cancelCalls, 1);
});
