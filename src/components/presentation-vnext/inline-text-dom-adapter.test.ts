import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";

import type { Paragraph } from "@/lib/presentation-vnext/schema";

import {
  createInlineTextDomAdapter,
  inlineTextAlignForCommand,
  type InlineTextAdapterExit,
} from "./inline-text-dom-adapter";

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

function createContainer(window: Window): HTMLElement {
  const container = window.document.createElement("div");
  window.document.body.append(container);
  return container as unknown as HTMLElement;
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

function assertCommit(
  exit: InlineTextAdapterExit,
): asserts exit is Extract<InlineTextAdapterExit, { kind: "commit" }> {
  assert.equal(exit.kind, "commit");
}

test("inline text DOM adapter maps toolbar alignment commands", () => {
  assert.equal(inlineTextAlignForCommand("align-left"), "left");
  assert.equal(inlineTextAlignForCommand("align-center"), "center");
  assert.equal(inlineTextAlignForCommand("align-right"), "right");
  assert.equal(inlineTextAlignForCommand("bold"), undefined);
});

test("inline text DOM adapter mounts rich HTML and commits serialized content once", () => {
  withHappyDom((window) => {
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
        text: "箇条書き",
        list: { kind: "bullet", indent: 2 },
      },
    ];
    const container = createContainer(window);
    const adapter = createInlineTextDomAdapter({
      nodeId: "text-adapter",
      initialParagraphs,
    });

    adapter.mountInitialHtml(container);
    assert.match(container.innerHTML, /Unsafe &amp;/);
    assert.match(container.innerHTML, /&lt;tag&gt;/);
    assert.match(container.innerHTML, /data-list-kind="bullet"/);
    assert.match(container.innerHTML, />•<\/span>/);

    selectNodeContents(window, container.firstElementChild ?? container);
    adapter.applyCommand(container, { command: "align-center" });

    const exit = adapter.commit(container);
    assertCommit(exit);
    assert.equal(exit.textAlign, "center");
    assert.equal(exit.paragraphs[0]?.id, "p-rich");
    assert.equal(exit.paragraphs[0]?.text, "Unsafe & <tag>");
    assert.equal(exit.paragraphs[0]?.runs?.[0]?.bold, true);
    assert.equal(exit.paragraphs[1]?.id, "p-list");
    assert.equal(exit.paragraphs[1]?.text, "箇条書き");
    assert.doesNotMatch(exit.paragraphs[1]?.text ?? "", /•/);
    assert.deepEqual(exit.paragraphs[1]?.list, { kind: "bullet", indent: 2 });
    assert.equal(adapter.commit(container).kind, "none");
  });
});

test("inline text DOM adapter cancels empty Escape without later committing", () => {
  withHappyDom((window) => {
    const container = createContainer(window);
    const adapter = createInlineTextDomAdapter({
      nodeId: "text-empty",
      initialParagraphs: [{ id: "p-empty", text: "" }],
    });
    adapter.mountInitialHtml(container);
    container.textContent = "  ";

    assert.equal(adapter.commitOrCancelForEscape(container).kind, "cancel");
    assert.equal(adapter.commit(container).kind, "none");
  });
});

test("inline text DOM adapter defers blur commit during IME composition and preserves CJK text", () => {
  withHappyDom((window) => {
    const container = createContainer(window);
    const adapter = createInlineTextDomAdapter({
      nodeId: "text-ime",
      initialParagraphs: [{ id: "p-ime", text: "" }],
    });
    adapter.mountInitialHtml(container);

    adapter.startComposition();
    container.textContent = "中文入力かな交じり";

    assert.equal(adapter.isComposing(), true);
    assert.equal(adapter.commitOrCancelForEscape(container).kind, "none");
    assert.equal(adapter.commitForTab(container).kind, "none");
    assert.equal(adapter.commit(container).kind, "none");

    const exit = adapter.endComposition(container);
    assertCommit(exit);
    assert.equal(adapter.isComposing(), false);
    assert.deepEqual(exit.paragraphs, [
      { id: "p-ime", text: "中文入力かな交じり" },
    ]);
  });
});
