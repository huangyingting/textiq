import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";

import type { Paragraph } from "@/lib/presentation/schema";

import {
  createInlineTextDomAdapter,
  domToParagraphs,
  inlineTextAlignForCommand,
  paragraphsToHtml,
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

test("inline text DOM adapter serializes list, style, and text-node DOM branches", () => {
  withHappyDom((window) => {
    const container = createContainer(window);
    container.append(
      window.document.createTextNode("loose text") as unknown as Node,
    );
    container.insertAdjacentHTML(
      "beforeend",
      '<ol><li data-list-indent="2"><b>Bold</b><i> Italic</i><u> Under</u><s> Strike</s><a href="https://example.com"> Link</a><span style="font-weight:600;font-style:italic;text-decoration-line:underline line-through;color:#ff0000;font-size:16px"> Styled</span><span aria-hidden="true"> hidden</span><span contenteditable="false"> locked</span><br></li></ol><p data-list-kind="number" data-list-indent="1">dataset list</p>',
    );

    const paragraphs = domToParagraphs(container, "node", [
      { id: "first", text: "" },
      { id: "second", text: "" },
      { id: "third", text: "" },
    ]);

    assert.deepEqual(
      paragraphs.map((paragraph) => paragraph.id),
      ["first", "second", "third"],
    );
    assert.equal(paragraphs[0]?.text, "loose text");
    assert.deepEqual(paragraphs[1]?.list, { kind: "number", indent: 2 });
    assert.equal(
      paragraphs[1]?.runs?.some((run) => run.bold),
      true,
    );
    assert.equal(
      paragraphs[1]?.runs?.some((run) => run.italic),
      true,
    );
    assert.equal(
      paragraphs[1]?.runs?.some((run) => run.underline),
      true,
    );
    assert.equal(
      paragraphs[1]?.runs?.some((run) => run.strikethrough),
      true,
    );
    assert.equal(
      paragraphs[1]?.runs?.some((run) => run.link === "https://example.com"),
      true,
    );
    assert.equal(
      paragraphs[1]?.runs?.some((run) => run.localStyle?.fontSizePt === 12),
      true,
    );
    assert.doesNotMatch(paragraphs[1]?.text ?? "", /hidden|locked|\n/);
    assert.deepEqual(paragraphs[2]?.list, { kind: "number", indent: 1 });
  });
});

test("inline text DOM adapter formats ordered list markers and empty paragraphs", () => {
  const html = paragraphsToHtml([
    { id: "empty", text: "" },
    {
      id: "alpha",
      text: "alpha",
      list: { kind: "number", numberStyle: "lower-alpha" },
    },
    {
      id: "upper",
      text: "upper",
      list: { kind: "number", numberStyle: "upper-alpha" },
    },
    {
      id: "roman",
      text: "roman",
      list: { kind: "number", numberStyle: "lower-roman", indent: 1 },
    },
    { id: "plain", text: "plain" },
    { id: "reset", text: "reset", list: { kind: "number" } },
  ]);

  assert.match(html, /<br>/);
  assert.match(html, />a\.<\/span>/);
  assert.match(html, />B\.<\/span>/);
  assert.match(html, />i\.<\/span>/);
  assert.match(html, />1\.<\/span>/);
});

test("inline text DOM adapter applies and removes toolbar selection commands", () => {
  withHappyDom((window) => {
    const container = createContainer(window);
    container.innerHTML = "<p>Format me</p>";
    const adapter = createInlineTextDomAdapter({
      nodeId: "commands",
      initialParagraphs: [{ id: "p", text: "Format me" }],
    });

    const commands = [
      { command: "bold" },
      { command: "italic" },
      { command: "underline" },
      { command: "strikethrough" },
      { command: "link", value: "https://example.com" },
      { command: "color", value: "#00ff00" },
      { command: "font-size", value: "18pt" },
    ] as const;

    for (const command of commands) {
      selectNodeContents(window, container.firstElementChild ?? container);
      adapter.applyCommand(container, command);
    }
    assert.match(container.innerHTML, /font-weight/);
    assert.match(container.innerHTML, /href="https:\/\/example.com"/);

    selectNodeContents(window, container.querySelector("a") ?? container);
    adapter.applyCommand(container, { command: "unlink" });
    assert.equal(container.querySelector("a"), null);

    selectNodeContents(window, container.firstElementChild ?? container);
    adapter.applyCommand(container, { command: "bullet-list" });
    assert.equal(container.querySelector("ul")?.tagName, "UL");

    selectNodeContents(window, container.querySelector("li") ?? container);
    adapter.applyCommand(container, { command: "numbered-list" });
    assert.equal(container.querySelector("ol")?.tagName, "OL");

    selectNodeContents(window, container.querySelector("li") ?? container);
    adapter.applyCommand(container, { command: "indent-list" });
    assert.equal(
      (container.querySelector("li") as HTMLElement | null)?.dataset.listIndent,
      "1",
    );
    adapter.applyCommand(container, { command: "outdent-list" });
    assert.equal(
      (container.querySelector("li") as HTMLElement | null)?.dataset.listIndent,
      undefined,
    );
  });
});

test("inline text DOM adapter handles null commits and composition cancellation", () => {
  const adapter = createInlineTextDomAdapter({
    nodeId: "null",
    initialParagraphs: [],
  });

  adapter.startComposition();
  adapter.cancel();
  assert.equal(adapter.isComposing(), true);
  assert.equal(adapter.endComposition(null).kind, "none");
  assert.equal(adapter.commit(null).kind, "none");

  const second = createInlineTextDomAdapter({
    nodeId: "cancel",
    initialParagraphs: [],
  });
  assert.equal(second.commit(null).kind, "cancel");
  assert.equal(second.cancel().kind, "none");
});
