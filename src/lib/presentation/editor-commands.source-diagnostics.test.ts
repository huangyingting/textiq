/**
 * Editor command source-diagnostics tests.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { updateNodeSourceMetadata } from "@/lib/presentation/editor-commands";
import { makeTestDeck } from "./editor-commands.test-utils";

describe("updateNodeSourceMetadata", () => {
  test("sets and clears source metadata on a node", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const withSource = updateNodeSourceMetadata(deck, slide.id, nodeId, {
      documentId: "doc-1",
      blockId: "block-1",
      blockKind: "text",
    });
    const sourcedNode = withSource.slides[0].children.find(
      (node) => node.id === nodeId,
    );
    assert.equal(sourcedNode?.source?.blockId, "block-1");

    const cleared = updateNodeSourceMetadata(
      withSource,
      slide.id,
      nodeId,
      undefined,
    );
    const clearedNode = cleared.slides[0].children.find(
      (node) => node.id === nodeId,
    );
    assert.equal(clearedNode?.source, undefined);
  });
});
