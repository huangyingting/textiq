/**
 * Pure helper that builds a Lexical editor-state JSON object whose root contains
 * Markdown-derived content followed by one VisualNode decorator block.
 *
 * It delegates headings, paragraphs, lists, and tables to `from-markdown.ts`
 * (including durable `bid` fields) and appends the shape that
 * `VisualNode.exportJSON()` emits for visual blocks, so the result round-trips
 * correctly through Lexical's `parseEditorState`.
 *
 * Intentionally has no `lexical`/React imports so it stays pure and can be
 * used from Node scripts (seed, tests) without a DOM.
 */

import {
  markdownToLexicalStateObject,
  type SerializedLexicalState,
} from "@/lib/content/from-markdown";
import type { Visual } from "@/lib/visual/schema";

/** Matches the shape produced by `VisualNode.exportJSON()`. */
interface SerializedVisualNodeJSON {
  type: "visual";
  version: number;
  visual: Visual;
  visualId: string;
}

type RootChild =
  SerializedLexicalState["root"]["children"][number] | SerializedVisualNodeJSON;

export interface SeedLexicalState {
  root: {
    children: RootChild[];
    direction: null;
    format: "";
    indent: number;
    type: "root";
    version: number;
  };
}

/**
 * Builds a Lexical editor-state JSON with Markdown-derived document content
 * followed by a VisualNode block referencing the given {@link visual} and
 * {@link visualId}.
 *
 * @param markdown - Seed document Markdown. Supports headings, paragraphs,
 *   bullet lists, and pipe tables.
 * @param visual - The {@link Visual} payload embedded in the node.
 * @param visualId - The database `Visual.id` that correlates the node with its
 *   persisted row (used by the contextual editing commands).
 */
export function buildSeedContentJson(
  markdown: string,
  visual: Visual,
  visualId: string,
): SeedLexicalState {
  const content = markdownToLexicalStateObject(markdown);
  const visualBlock: SerializedVisualNodeJSON = {
    type: "visual",
    version: 1,
    visual,
    visualId,
  };

  return {
    root: {
      children: [...content.root.children, visualBlock],
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  };
}
