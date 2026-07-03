import assert from "node:assert/strict";
import { test } from "node:test";

import { createHeadlessEditor } from "@lexical/headless";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";

import {
  markdownToLexicalState,
  markdownToLexicalStateObject,
} from "./from-markdown";

test("converts headings H1-H3 into heading nodes with the right tag", () => {
  const { root } = markdownToLexicalStateObject("# One\n\n## Two\n\n### Three");
  assert.equal(root.children.length, 3);
  for (const [index, expectedTag] of ["h1", "h2", "h3"].entries()) {
    const node = root.children[index];
    assert.equal(node.type, "heading");
    assert.equal(node.tag, expectedTag);
  }
  assert.equal((root.children[0].children[0] as { text: string }).text, "One");
});

test("converts a bullet list into a list node with list items", () => {
  const { root } = markdownToLexicalStateObject("- one\n- two\n- three");
  assert.equal(root.children.length, 1);
  const list = root.children[0];
  assert.equal(list.type, "list");
  assert.equal(list.listType, "bullet");
  assert.equal(list.children.length, 3);
  const item = list.children[0] as {
    type: string;
    value: number;
    children: { text: string }[];
  };
  assert.equal(item.type, "listitem");
  assert.equal(item.value, 1);
  assert.equal(item.children[0].text, "one");
});

test("converts plain lines into paragraph nodes", () => {
  const { root } = markdownToLexicalStateObject("Hello world");
  assert.equal(root.children.length, 1);
  const paragraph = root.children[0];
  assert.equal(paragraph.type, "paragraph");
  assert.equal((paragraph.children[0] as { text: string }).text, "Hello world");
});

test("mixes headings, paragraphs, and bullets in document order", () => {
  const { root } = markdownToLexicalStateObject(
    "# Title\n\nIntro paragraph\n\n- a\n- b",
  );
  assert.deepEqual(
    root.children.map((node) => node.type),
    ["heading", "paragraph", "list"],
  );
});

test("converts Markdown pipe tables into Lexical table nodes", () => {
  const { root } = markdownToLexicalStateObject(
    "Before\n\n| Region | ARR |\n| --- | --- |\n| NA | $12M |\n| EU | $8M |\n\nAfter",
  );
  assert.deepEqual(
    root.children.map((node) => node.type),
    ["paragraph", "table", "paragraph"],
  );
  const table = root.children[1];
  assert.ok(table.bid);
  assert.equal(table.children.length, 3);
  const headerRow = table.children[0] as {
    children: Array<{
      children: Array<{ children: Array<{ text?: string }> }>;
    }>;
  };
  assert.equal(headerRow.children[0].children[0].children[0].text, "Region");
  assert.equal(headerRow.children[1].children[0].children[0].text, "ARR");
});

test("Markdown table state parses with Lexical table nodes registered", () => {
  const editor = createHeadlessEditor({
    namespace: "markdown-table-test",
    nodes: [TableNode, TableRowNode, TableCellNode],
    onError(error) {
      throw error;
    },
  });
  assert.doesNotThrow(() => {
    editor.parseEditorState(
      markdownToLexicalState("| Region | ARR |\n| --- | --- |\n| NA | $12M |"),
    );
  });
});

test("empty or whitespace input yields a single empty paragraph", () => {
  for (const input of ["", "   ", "\n\n"]) {
    const { root } = markdownToLexicalStateObject(input);
    assert.equal(root.children.length, 1);
    assert.equal(root.children[0].type, "paragraph");
    assert.equal(root.children[0].children.length, 0);
  }
});

test("returns a valid JSON string with a root node", () => {
  const json = markdownToLexicalState("# Hi");
  const parsed = JSON.parse(json) as { root: { type: string } };
  assert.equal(parsed.root.type, "root");
});
