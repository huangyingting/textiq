import {
  updateLocalStyle,
  updateNodeContent,
  updateNodeLayout,
} from "@/lib/presentation/editor-commands";
import type {
  Deck,
  LayoutBox,
  Paragraph,
  TextNode,
} from "@/lib/presentation/schema";

export type InlineTextAlign = "left" | "center" | "right";
export type InlineEditableNode = TextNode;

export type InlineTextCommit = {
  deck: Deck;
  slideId: string;
  node: InlineEditableNode;
  paragraphs: Paragraph[];
  nextFrame?: LayoutBox["frame"];
  textAlign?: InlineTextAlign;
};

export function applyInlineTextCommit({
  deck,
  slideId,
  node,
  paragraphs,
  nextFrame,
  textAlign,
}: InlineTextCommit): Deck {
  let updated = deck;
  updated = updateNodeContent(updated, slideId, node.id, { paragraphs });
  if (nextFrame) {
    updated = updateNodeLayout(updated, slideId, node.id, {
      frame: nextFrame,
    });
  }
  if (textAlign) {
    updated = updateLocalStyle(updated, slideId, node.id, {
      text: { align: textAlign },
    });
  }
  return updated;
}
