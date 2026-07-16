import assert from "node:assert/strict";
import { test } from "node:test";

import {
  projectDocumentContent,
  projectDocumentMarkdown,
} from "./content-projection";

test("projects canonical Lexical JSON into searchable document text", () => {
  const contentJson = {
    root: {
      type: "root",
      children: [
        {
          type: "heading",
          tag: "h1",
          children: [{ type: "text", text: "Quarterly plan" }],
        },
        {
          type: "paragraph",
          children: [{ type: "text", text: "Ship the MVP." }],
        },
      ],
    },
  };

  assert.deepEqual(projectDocumentContent(contentJson), {
    contentJson,
    content: "Quarterly plan\nShip the MVP.",
  });
});

test("keeps malformed or empty content searchable as an empty string", () => {
  const contentJson = { root: { type: "root", children: [] } };

  assert.deepEqual(projectDocumentContent(contentJson), {
    contentJson,
    content: "",
  });
});

test("projectDocumentMarkdown derives canonical JSON and searchable text together", () => {
  const projected = projectDocumentMarkdown("# Seed heading\n\nSeed body.");

  assert.equal(projected.content, "Seed heading\nSeed body.");
  assert.equal(
    (projected.contentJson as { root: { children: unknown[] } }).root.children
      .length,
    2,
  );
});
