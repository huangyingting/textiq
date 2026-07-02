import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./slide-editor.tsx", import.meta.url),
  "utf8",
);
const sourceReviewController = readFileSync(
  new URL("./use-source-review-controller.ts", import.meta.url),
  "utf8",
);

describe("SlideEditor document-source command surface", () => {
  test("renders document-source command controls", () => {
    assert.equal(source.includes('aria-label="Document source"'), true);
    assert.equal(source.includes("Refresh all source links"), true);
    assert.equal(source.includes("From document"), true);
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
