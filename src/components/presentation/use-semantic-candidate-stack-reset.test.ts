import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useSemanticCandidateStackReset } from "./use-semantic-candidate-stack-reset";

type ResetInputs = {
  activeSlideChildren: unknown;
  activeSlideId: unknown;
  contextMenu: unknown;
  sourceDocumentId: unknown;
  selection: unknown;
};

describe("useSemanticCandidateStackReset", () => {
  test("resets overlap cycling when slide, document, selection, context, or node stack changes", () => {
    const candidateStackRef: { current: readonly string[] } = {
      current: ["top", "covered"],
    };
    const initial: ResetInputs = {
      activeSlideChildren: ["top", "covered"],
      activeSlideId: "slide-a",
      contextMenu: null,
      sourceDocumentId: "document-a",
      selection: { selectedNodeIds: ["top"] },
    };

    function Harness(inputs: ResetInputs) {
      useSemanticCandidateStackReset({ candidateStackRef, ...inputs });
      return null;
    }

    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(createElement(Harness, initial));
    });
    assert.deepEqual(candidateStackRef.current, []);

    for (const [key, value] of [
      ["activeSlideChildren", ["covered", "top"]],
      ["activeSlideId", "slide-b"],
      ["sourceDocumentId", "document-b"],
      ["selection", { selectedNodeIds: ["covered"] }],
      ["contextMenu", { nodeId: "covered" }],
    ] as const) {
      candidateStackRef.current = ["top", "covered"];
      act(() => {
        renderer.update(createElement(Harness, { ...initial, [key]: value }));
      });
      assert.deepEqual(candidateStackRef.current, [], `${key} should reset`);
    }

    act(() => renderer.unmount());
  });
});
