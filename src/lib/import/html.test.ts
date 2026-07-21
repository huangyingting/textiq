import assert from "node:assert/strict";
import { test } from "node:test";

import { htmlToMarkdown } from "./html";

test("htmlToMarkdown converts h1–h3 to markdown headings", () => {
  const result = htmlToMarkdown("<h1>Title</h1><h2>Section</h2><h3>Sub</h3>");
  assert.ok(result.includes("# Title"));
  assert.ok(result.includes("## Section"));
  assert.ok(result.includes("### Sub"));
});

test("htmlToMarkdown promotes h4–h6 to h3", () => {
  const result = htmlToMarkdown("<h4>Deep heading</h4>");
  assert.ok(result.includes("### Deep heading"));
});

test("htmlToMarkdown converts unordered lists to bullet items", () => {
  const result = htmlToMarkdown(
    "<ul><li>Alpha</li><li>Beta</li><li>Gamma</li></ul>",
  );
  assert.ok(result.includes("- Alpha"));
  assert.ok(result.includes("- Beta"));
  assert.ok(result.includes("- Gamma"));
});

test("htmlToMarkdown converts ordered lists to bullet items (normalized)", () => {
  const result = htmlToMarkdown("<ol><li>First</li><li>Second</li></ol>");
  assert.ok(result.includes("- First"));
  assert.ok(result.includes("- Second"));
});

test("htmlToMarkdown strips inline tags and keeps text", () => {
  const result = htmlToMarkdown(
    "<p>Hello <strong>world</strong> and <em>friends</em>.</p>",
  );
  assert.ok(result.includes("Hello"));
  assert.ok(result.includes("world"));
  assert.ok(result.includes("friends"));
});

test("htmlToMarkdown decodes HTML entities", () => {
  const result = htmlToMarkdown(
    "<p>&lt;code&gt; &amp; &quot;quotes&quot; &#128512; &#x1F600; &#xD800; &#9999999999; &bogus;</p>",
  );
  assert.ok(result.includes("<code>"));
  assert.ok(result.includes("&"));
  assert.ok(result.includes('"quotes"'));
  assert.ok(result.includes("😀 😀"));
  assert.ok(result.includes("&#xD800;"));
  assert.ok(result.includes("&#9999999999;"));
  assert.ok(result.includes("&bogus;"));
});

test("htmlToMarkdown removes script and style blocks entirely", () => {
  const result = htmlToMarkdown(
    "<style>body { color: red }</style><p>Visible</p><script>alert(1)</script>",
  );
  assert.ok(!result.includes("color:"));
  assert.ok(!result.includes("alert"));
  assert.ok(result.includes("Visible"));
});

test("htmlToMarkdown removes HTML comments", () => {
  const result = htmlToMarkdown("<!-- hidden comment --><p>Content</p>");
  assert.ok(!result.includes("hidden comment"));
  assert.ok(result.includes("Content"));
});

test("htmlToMarkdown extracts body content when present", () => {
  const result = htmlToMarkdown(
    "<html><head><title>T</title></head><body><h1>Hello</h1></body></html>",
  );
  assert.ok(result.includes("# Hello"));
  assert.ok(!result.includes("title"));
});

test("htmlToMarkdown converts simple tables to Markdown pipe tables", () => {
  const result = htmlToMarkdown(
    "<table><caption>Revenue</caption><tr><th>Region</th><th>ARR</th></tr><tr><td>NA</td><td>$12M</td></tr></table>",
  );
  assert.equal(
    result.trim(),
    "Revenue\n| Region | ARR |\n| --- | --- |\n| NA | $12M |",
  );
});

test("htmlToMarkdown escapes pipes inside table cells", () => {
  const result = htmlToMarkdown(
    "<table><tr><th>Metric | Name</th><th>Value</th></tr><tr><td>ACV | ARR</td><td>10 | 20</td></tr></table>",
  );
  assert.equal(
    result.trim(),
    "| Metric \\| Name | Value |\n| --- | --- |\n| ACV \\| ARR | 10 \\| 20 |",
  );
});

test("htmlToMarkdown returns empty string for empty input", () => {
  assert.equal(htmlToMarkdown("").trim(), "");
  assert.equal(htmlToMarkdown("   ").trim(), "");
});
