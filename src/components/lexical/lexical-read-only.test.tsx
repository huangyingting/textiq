/**
 * Direct behavior coverage for `LexicalReadOnly` (#1947).
 *
 * `LexicalReadOnly` is a directive-free, hook-free pure component (no
 * `LexicalComposer`, no client-only APIs), so it is rendered with
 * `react-dom/server`'s `renderToStaticMarkup` — the same pattern already used
 * for other presentational components in this codebase (e.g.
 * `src/components/presentation/slide-editor-save-status.test.tsx`) — and
 * assertions are made against the resulting HTML structure (tag names,
 * classes, attributes, nesting), not against pixels or the component's
 * internal implementation strings.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildContentJson,
  buildEditorState,
  buildHeadingNode,
  buildHorizontalRuleNode,
  buildListNode,
  buildParagraphNode,
  buildQuoteNode,
  buildTextNode,
  buildVisualLexicalNode,
  FORMAT_BOLD,
  FORMAT_CODE,
  FORMAT_ITALIC,
} from "@/test/builders/lexical";
import { buildVisual } from "@/test/builders/visual";

import { LexicalReadOnly } from "./lexical-read-only";

const IS_STRIKETHROUGH = 1 << 2;
const IS_UNDERLINE = 1 << 3;
const IS_SUBSCRIPT = 1 << 5;
const IS_SUPERSCRIPT = 1 << 6;

function render(state: unknown, className?: string): string {
  return renderToStaticMarkup(
    createElement(LexicalReadOnly, { state, className }),
  );
}

// ---------------------------------------------------------------------------
// Empty / malformed root input
// ---------------------------------------------------------------------------

test("renders the no-content placeholder for an empty children array", () => {
  const html = render(buildEditorState([]));
  assert.match(html, /<div><p class="[^"]*">No content yet\.<\/p><\/div>/);
});

test("passes className through directly (no ds-prose class) on the empty placeholder", () => {
  const html = render(buildEditorState([]), "custom-empty");
  assert.match(html, /^<div class="custom-empty">/);
  assert.ok(!html.includes("ds-prose"));
});

test("renders the no-content placeholder for a non-JSON string, undefined, non-object, and rootless input", () => {
  assert.match(render("not valid json {"), /No content yet\./);
  assert.match(render(undefined), /No content yet\./);
  assert.match(render(42), /No content yet\./);
  assert.match(render({}), /No content yet\./);
  assert.match(render({ root: {} }), /No content yet\./);
  assert.match(render({ root: { children: [] } }), /No content yet\./);
});

test("parses a JSON-string editor state identically to the equivalent object", () => {
  const asObject = render(
    buildEditorState([buildParagraphNode("Round-tripped")]),
  );
  const asString = render(
    buildContentJson([buildParagraphNode("Round-tripped")]),
  );
  assert.equal(asObject, asString);
  assert.match(asString, /Round-tripped/);
});

// ---------------------------------------------------------------------------
// Wrapper className
// ---------------------------------------------------------------------------

test("wraps non-empty content in a div with the ds-prose class, plus any className", () => {
  const html = render(
    buildEditorState([buildParagraphNode("Hi")]),
    "extra-class",
  );
  assert.match(html, /^<div class="ds-prose extra-class">/);
});

test("omits the trailing space when no className is supplied", () => {
  const html = render(buildEditorState([buildParagraphNode("Hi")]));
  assert.match(html, /^<div class="ds-prose">/);
});

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------

test("renders heading levels 1-3 with their respective tags and classes", () => {
  const html = render(
    buildEditorState([
      buildHeadingNode(1, "Title One"),
      buildHeadingNode(2, "Title Two"),
      buildHeadingNode(3, "Title Three"),
    ]),
  );
  assert.match(html, /<h1 class="[^"]*text-3xl[^"]*">Title One<\/h1>/);
  assert.match(html, /<h2 class="[^"]*text-2xl[^"]*">Title Two<\/h2>/);
  assert.match(html, /<h3 class="[^"]*text-xl[^"]*">Title Three<\/h3>/);
});

test("defaults a heading with a missing/unknown tag to h2", () => {
  const html = render(
    buildEditorState([
      { ...buildHeadingNode(1, "Untagged"), tag: undefined } as never,
    ]),
  );
  assert.match(html, /<h2[^>]*>Untagged<\/h2>/);
});

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

test("renders a quote block as a blockquote", () => {
  const html = render(buildEditorState([buildQuoteNode("A quote")]));
  assert.match(
    html,
    /<blockquote class="[^"]*italic[^"]*">A quote<\/blockquote>/,
  );
});

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

test("renders an unordered list with list items", () => {
  const html = render(
    buildEditorState([buildListNode(["one", "two"], { listType: "bullet" })]),
  );
  assert.match(
    html,
    /<ul class="[^"]*list-disc[^"]*"><li>one<\/li><li>two<\/li><\/ul>/,
  );
});

test("renders an ordered list with list items", () => {
  const html = render(
    buildEditorState([buildListNode(["one", "two"], { listType: "number" })]),
  );
  assert.match(
    html,
    /<ol class="[^"]*list-decimal[^"]*"><li>one<\/li><li>two<\/li><\/ol>/,
  );
});

test("renders nested lists inside a parent list item", () => {
  const nested = {
    type: "list",
    listType: "bullet",
    tag: "ul",
    children: [
      {
        type: "listitem",
        children: [
          buildTextNode("Parent item"),
          {
            type: "list",
            listType: "number",
            tag: "ol",
            children: [
              {
                type: "listitem",
                children: [buildTextNode("Child item")],
              },
            ],
          },
        ],
      },
    ],
  };
  const html = render(buildEditorState([nested as never]));
  assert.match(
    html,
    /<li class="list-none">Parent item<ol[^>]*><li>Child item<\/li><\/ol><\/li>/,
  );
});

// ---------------------------------------------------------------------------
// Horizontal rule
// ---------------------------------------------------------------------------

test("renders a horizontal rule block as hr", () => {
  const html = render(buildEditorState([buildHorizontalRuleNode()]));
  assert.match(html, /<hr class="[^"]*"\/?>/);
});

// ---------------------------------------------------------------------------
// Visual blocks
// ---------------------------------------------------------------------------

test("renders a valid visual block via VisualRenderer inside a data-block-visual wrapper", () => {
  const visual = buildVisual({ title: "Sales funnel" });
  const html = render(
    buildEditorState([buildVisualLexicalNode("visual-1", visual)]),
  );
  assert.match(html, /<div data-block-visual="true" class="[^"]*">/);
  assert.match(html, /<svg[^>]*role="img"[^>]*aria-label="Sales funnel"/);
});

test("renders a fallback message for a malformed visual payload", () => {
  const html = render(
    buildEditorState([
      { type: "visual", version: 1, visual: {}, visualId: "bad" } as never,
    ]),
  );
  assert.match(
    html,
    /<div data-block-visual="true" class="[^"]*">This visual could not be displayed\.<\/div>/,
  );
  assert.ok(!html.includes("<svg"));
});

// ---------------------------------------------------------------------------
// Paragraphs
// ---------------------------------------------------------------------------

test("renders an empty paragraph as a bare line break", () => {
  const html = render(buildEditorState([buildParagraphNode("")]));
  assert.match(html, /<p class="[^"]*"><br\/?><\/p>/);
});

test("renders a non-empty paragraph with its inline content", () => {
  const html = render(buildEditorState([buildParagraphNode("Hello world")]));
  assert.match(html, /<p class="[^"]*">Hello world<\/p>/);
});

// ---------------------------------------------------------------------------
// Unknown block type fallback
// ---------------------------------------------------------------------------

test("falls back to a plain div for an unrecognized block type", () => {
  const html = render(
    buildEditorState([
      {
        type: "some-future-block",
        children: [buildTextNode("Unrecognized content")],
      } as never,
    ]),
  );
  assert.match(html, /<div class="[^"]*">Unrecognized content<\/div>/);
});

test("skips non-record entries in the block children array", () => {
  const html = render(
    buildEditorState([
      null as never,
      buildParagraphNode("Kept"),
      "a string, not a node" as never,
    ]),
  );
  assert.match(html, /Kept/);
});

// ---------------------------------------------------------------------------
// Inline formatting bitmask combinations
// ---------------------------------------------------------------------------

function paragraphWithFormat(
  format: number,
): ReturnType<typeof buildParagraphNode> {
  return buildParagraphNode([buildTextNode("styled", { format })]);
}

test("renders bold text", () => {
  const html = render(buildEditorState([paragraphWithFormat(FORMAT_BOLD)]));
  assert.match(html, /<strong class="[^"]*">styled<\/strong>/);
});

test("renders italic text", () => {
  const html = render(buildEditorState([paragraphWithFormat(FORMAT_ITALIC)]));
  assert.match(html, /<em class="[^"]*">styled<\/em>/);
});

test("renders inline code text", () => {
  const html = render(buildEditorState([paragraphWithFormat(FORMAT_CODE)]));
  assert.match(html, /<code class="[^"]*">styled<\/code>/);
});

test("renders underline text", () => {
  const html = render(buildEditorState([paragraphWithFormat(IS_UNDERLINE)]));
  assert.match(html, /<span class="underline">styled<\/span>/);
});

test("renders strikethrough text", () => {
  const html = render(
    buildEditorState([paragraphWithFormat(IS_STRIKETHROUGH)]),
  );
  assert.match(html, /<span class="line-through">styled<\/span>/);
});

test("renders combined underline+strikethrough text with a single dual-decoration span", () => {
  const html = render(
    buildEditorState([paragraphWithFormat(IS_UNDERLINE | IS_STRIKETHROUGH)]),
  );
  assert.match(
    html,
    /<span class="\[text-decoration:underline_line-through\]">styled<\/span>/,
  );
  // Must not also emit the single-decoration spans.
  assert.ok(!html.includes('class="underline"'));
  assert.ok(!html.includes('class="line-through"'));
});

test("renders subscript and superscript text", () => {
  const sub = render(buildEditorState([paragraphWithFormat(IS_SUBSCRIPT)]));
  assert.match(sub, /<sub>styled<\/sub>/);

  const sup = render(buildEditorState([paragraphWithFormat(IS_SUPERSCRIPT)]));
  assert.match(sup, /<sup>styled<\/sup>/);
});

test("nests bold+italic in the expected outer-to-inner order (italic outermost)", () => {
  const html = render(
    buildEditorState([paragraphWithFormat(FORMAT_BOLD | FORMAT_ITALIC)]),
  );
  assert.match(
    html,
    /<em class="italic"><strong class="font-semibold">styled<\/strong><\/em>/,
  );
});

test("nests every format flag in the documented code -> bold -> italic -> decoration -> sub -> sup order", () => {
  const allFormats =
    FORMAT_BOLD |
    FORMAT_ITALIC |
    FORMAT_CODE |
    IS_UNDERLINE |
    IS_STRIKETHROUGH |
    IS_SUBSCRIPT |
    IS_SUPERSCRIPT;
  const html = render(buildEditorState([paragraphWithFormat(allFormats)]));
  assert.match(
    html,
    /<sup><sub><span class="\[text-decoration:underline_line-through\]"><em class="italic"><strong class="font-semibold"><code class="[^"]*">styled<\/code><\/strong><\/em><\/span><\/sub><\/sup>/,
  );
});

// ---------------------------------------------------------------------------
// Other inline node types
// ---------------------------------------------------------------------------

test("renders a linebreak node as <br>", () => {
  const html = render(
    buildEditorState([
      buildParagraphNode([
        buildTextNode("Line one"),
        { type: "linebreak", version: 1 } as never,
        buildTextNode("Line two"),
      ]),
    ]),
  );
  assert.match(html, /Line one<br\/?>Line two/);
});

test("renders a tab node as a literal tab character", () => {
  const html = render(
    buildEditorState([
      buildParagraphNode([
        buildTextNode("Before"),
        { type: "tab", version: 1 } as never,
        buildTextNode("After"),
      ]),
    ]),
  );
  assert.ok(html.includes("Before\tAfter"));
});

test("renders link and autolink nodes as anchors with target/rel and recursive inline content", () => {
  const html = render(
    buildEditorState([
      buildParagraphNode([
        {
          type: "link",
          version: 1,
          url: "https://example.com",
          children: [buildTextNode("bold link", { format: FORMAT_BOLD })],
        } as never,
        {
          type: "autolink",
          version: 1,
          url: "https://auto.example.com",
          children: [buildTextNode("auto")],
        } as never,
      ]),
    ]),
  );
  assert.match(
    html,
    /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer nofollow" class="[^"]*"><strong class="font-semibold">bold link<\/strong><\/a>/,
  );
  assert.match(html, /<a href="https:\/\/auto\.example\.com"[^>]*>auto<\/a>/);
});

test("defaults a link with a missing url to '#'", () => {
  const html = render(
    buildEditorState([
      buildParagraphNode([
        {
          type: "link",
          version: 1,
          children: [buildTextNode("nowhere")],
        } as never,
      ]),
    ]),
  );
  assert.match(html, /<a href="#"/);
});

test("falls back to rendering children for an unrecognized inline node type", () => {
  const html = render(
    buildEditorState([
      buildParagraphNode([
        {
          type: "mention",
          version: 1,
          children: [buildTextNode("@someone")],
        } as never,
      ]),
    ]),
  );
  assert.match(html, /<p[^>]*>@someone<\/p>/);
});

test("renders empty string for a text node missing its text field", () => {
  const html = render(
    buildEditorState([
      buildParagraphNode([{ type: "text", version: 1 } as never]),
    ]),
  );
  assert.match(html, /<p class="[^"]*"><\/p>/);
});
