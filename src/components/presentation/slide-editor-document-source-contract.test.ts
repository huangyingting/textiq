import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./slide-editor.tsx", import.meta.url),
  "utf8",
);
const topToolbarSource = readFileSync(
  new URL("./slide-editor-top-toolbar.tsx", import.meta.url),
  "utf8",
);
const editorAndToolbarSource = `${source}\n${topToolbarSource}`;
const sourceReviewController = readFileSync(
  new URL("./use-source-review-controller.ts", import.meta.url),
  "utf8",
);
const contextToolbarSource = readFileSync(
  new URL("./toolbar/floating-toolbar.tsx", import.meta.url),
  "utf8",
);

describe("SlideEditor document-source command surface", () => {
  test("renders document-source command controls", () => {
    assert.equal(
      editorAndToolbarSource.includes("const sourceActionLabel"),
      true,
    );
    assert.equal(
      editorAndToolbarSource.includes("handleDocumentSourceAction"),
      true,
    );
    assert.equal(
      editorAndToolbarSource.includes("Refresh all source links"),
      true,
    );
    assert.equal(editorAndToolbarSource.includes("Review source links"), true);
  });

  test("relocates the From document insert list to the slide context toolbar", () => {
    assert.equal(contextToolbarSource.includes('label="From document"'), true);
    assert.equal(
      contextToolbarSource.includes("onInsertDocumentSourceBlock"),
      true,
    );
    // The deck toolbar no longer carries the slide-scoped insert list.
    assert.equal(topToolbarSource.includes("From document"), false);
  });

  test("wires document source block insertion commands", () => {
    assert.equal(source.includes("handleInsertDocumentSourceBlock"), true);
    assert.equal(source.includes("documentInsertBlocks"), true);
    assert.equal(
      sourceReviewController.includes("documentSourceInsertBlocks"),
      true,
    );
  });
});
