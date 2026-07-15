import type { Prisma } from "@/generated/prisma/client";
import { markdownToLexicalStateObject } from "@/lib/content/from-markdown";
import { lexicalStateToPlainText } from "@/lib/content/plain-text";

export type DocumentContentProjection = {
  contentJson: Prisma.InputJsonValue;
  content: string;
};

/**
 * Builds the persisted document-body write shape from canonical Lexical JSON.
 *
 * `contentJson` remains the source of truth. `content` is its searchable
 * plain-text projection and must be written in the same create/update so list
 * search cannot drift from the editor state.
 */
export function projectDocumentContent(
  contentJson: unknown,
): DocumentContentProjection {
  return {
    contentJson: contentJson as Prisma.InputJsonValue,
    content: lexicalStateToPlainText(contentJson),
  };
}

export function projectDocumentMarkdown(
  markdown: string,
): DocumentContentProjection {
  return projectDocumentContent(markdownToLexicalStateObject(markdown));
}
