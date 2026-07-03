import type { Prisma } from "@/generated/prisma/client";
import { markdownToLexicalState } from "@/lib/content";
import {
  DOCUMENT_CONTENT_MAX_LENGTH,
  DOCUMENT_TITLE_MAX_LENGTH,
} from "@/lib/limits";
import { prisma } from "@/lib/prisma";
import { BLANK_TEMPLATE_ID, getTemplateOrBlank } from "@/lib/templates/catalog";

type DocumentCreateDb = Pick<typeof prisma, "document">;

export type CreatedDocument = { id: string };

export function clampDocumentTitle(rawTitle: string, fallback: string): string {
  return rawTitle.trim().slice(0, DOCUMENT_TITLE_MAX_LENGTH) || fallback;
}

export function clampDocumentContent(content: string): string {
  return content.slice(0, DOCUMENT_CONTENT_MAX_LENGTH);
}

export function importedMarkdownToContentJson(
  content: string,
): Prisma.InputJsonValue {
  return JSON.parse(markdownToLexicalState(content)) as Prisma.InputJsonValue;
}

export function templateContentJsonForId(
  templateId: string,
): Prisma.InputJsonValue | undefined {
  const template = getTemplateOrBlank(templateId);
  if (template.id === BLANK_TEMPLATE_ID) {
    return undefined;
  }
  return importedMarkdownToContentJson(clampDocumentContent(template.content));
}

export async function createDocumentFromTemplateForUser(
  userId: string,
  templateId: string,
  db: DocumentCreateDb = prisma,
): Promise<CreatedDocument> {
  const contentJson = templateContentJsonForId(templateId);

  // Document.content (the plaintext mirror) is deprecated — stop writing it.
  // Physical column drop is a follow-up migration.
  return db.document.create({
    data: { ownerId: userId, ...(contentJson ? { contentJson } : {}) },
    select: { id: true },
  });
}

export async function createDocumentFromImportForUser(
  userId: string,
  content: string,
  rawTitle: string,
  db: DocumentCreateDb = prisma,
): Promise<CreatedDocument> {
  const title = clampDocumentTitle(rawTitle, "Imported document");
  const safeContent = clampDocumentContent(content);
  const contentJson = importedMarkdownToContentJson(safeContent);

  // Document.content (the plaintext mirror) is deprecated — stop writing it.
  // Physical column drop is a follow-up migration.
  return db.document.create({
    data: { ownerId: userId, title, contentJson },
    select: { id: true },
  });
}
