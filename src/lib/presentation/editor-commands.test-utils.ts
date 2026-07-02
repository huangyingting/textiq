import assert from "node:assert/strict";
import type { SlideChildNode } from "@/lib/presentation/schema";
import {
  buildContentSlide,
  buildCoverSlide,
  buildDeck,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";

export function makeTestDeck() {
  resetBuilderCounter();
  return buildDeck([buildCoverSlide(), buildContentSlide()]);
}

export function findNode(
  nodes: readonly SlideChildNode[],
  id: string,
): SlideChildNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === "group") {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

export function assertNoV6ElementsField(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoV6ElementsField);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  assert.equal(
    Object.prototype.hasOwnProperty.call(value, "elements"),
    false,
    "presentation command output must not write legacy Slide.elements fields",
  );
  for (const child of Object.values(value)) {
    assertNoV6ElementsField(child);
  }
}
