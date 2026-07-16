"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireDocumentCapability } from "@/lib/auth/document-permissions";
import {
  createDocumentFromTemplateForUser,
  clampDocumentTitle,
} from "@/lib/document/create";
import { duplicateDocumentForUser } from "@/lib/document/duplicate";
import {
  searchDocumentsForUser,
  type SearchResults,
} from "@/lib/document/list";
import {
  renameDocumentTitle,
  toggleDocumentFavorite,
} from "@/lib/document/mutations";
import {
  restoreDocumentFromTrash,
  softDeleteDocument,
} from "@/lib/document/trash";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

/**
 * Creates a document for the current user seeded from a starter template, then
 * redirects to its editor.
 *
 * The id is resolved via `getTemplateOrBlank`, so an unknown or missing id
 * gracefully falls back to a blank document. The Blank template starts with
 * empty content (mirroring a from-scratch document); named templates seed their
 * Markdown `content`. No AI generation happens here.
 *
 * `redirect` throws `NEXT_REDIRECT`, so it must stay outside any try/catch and
 * run after the document is created.
 */
export async function createDocumentFromTemplate(
  templateId: string,
): Promise<void> {
  const user = await requireUser(redirect);

  const document = await createDocumentFromTemplateForUser(user.id, templateId);

  revalidatePath("/app");
  redirect(`/app/documents/${document.id}`);
}

/**
 * Renames a document. Requires edit access (owner or workspace editor); a
 * viewer or unrelated user is rejected with a clear error via
 * `requireDocumentCapability` (issue #89). The write uses `updateMany` so a
 * concurrent change is a harmless no-op rather than a throw. The title is
 * trimmed and length-clamped, falling back to "Untitled" when empty. Returns
 * the normalized title so the caller can reflect any trimming/fallback.
 */
export async function renameDocument(
  id: string,
  rawTitle: string,
): Promise<{ title: string }> {
  const user = await requireUser(redirect);

  const title = clampDocumentTitle(rawTitle, "Untitled");

  await requireDocumentCapability(user.id, id, "edit");

  await renameDocumentTitle(id, title);

  revalidatePath("/app");
  return { title };
}

/**
 * Duplicates a document the current user may view (owner or any workspace
 * member) into a fresh personal document owned by the current user.
 *
 * View access is authorized via `requireDocumentCapability` (a non-accessible
 * id throws a clear "Document not found." error). The copy reuses the source
 * title (suffixed " (copy)") and content, regenerates every durable document
 * block id in `contentJson`, remaps duplicated deck source refs where
 * possible, and deep-copies every `Visual` row (anchorBlockId, orderIndex,
 * type, title, data) via a nested create in a single statement.
 *
 * Comments and share state are intentionally NOT copied: the new document is
 * private (`isShared` defaults to false, `shareId` stays null) and starts with
 * no comments. The copy is created fresh, so its `createdAt`/`updatedAt` are
 * "now" and it sorts to the top of the dashboard's most-recent ordering.
 */
export async function duplicateDocument(id: string): Promise<void> {
  const user = await requireUser(redirect);

  await requireDocumentCapability(user.id, id, "view");

  await duplicateDocumentForUser(user.id, id);

  revalidatePath("/app");
}

/**
 * Toggles the `favorite` flag on a document the current user may edit (owner or
 * workspace editor).
 *
 * Edit access is authorized via `requireDocumentCapability`; a viewer or
 * unrelated user is rejected with a clear error (issue #89). The current value
 * is read by id and the write uses `updateMany` keyed by id (per the house
 * mutation rule) so a concurrent change is a harmless no-op rather than a throw.
 * Returns the new flag so the caller can reconcile its optimistic state.
 */
export async function toggleFavorite(
  id: string,
): Promise<{ favorite: boolean }> {
  const user = await requireUser(redirect);

  await requireDocumentCapability(user.id, id, "edit");

  const result = await toggleDocumentFavorite(id);

  revalidatePath("/app");
  return result;
}

/**
 * Soft-deletes a document by stamping `deletedAt`. Requires manage access
 * (owner-level); a viewer, editor, or unrelated user is rejected with a clear
 * error via `requireDocumentCapability` (issue #89). The row is retained so the
 * delete can be undone (see `restoreDocument`); every document
 * list/detail/share/embed query excludes `deletedAt != null`, so a soft-deleted
 * document is invisible.
 *
 * The capability check excludes already soft-deleted rows (a double-delete is a
 * clean "Document not found."), and the update uses `updateMany` so a concurrent
 * change is a harmless no-op rather than a throw. The document's
 * `Visual`/`Comment` rows are left intact and only removed by the maintenance
 * sweep once the recovery window has elapsed.
 */
export async function deleteDocument(id: string): Promise<void> {
  const user = await requireUser(redirect);

  await requireDocumentCapability(user.id, id, "manage");

  await softDeleteDocument(id);

  revalidatePath("/app");
}

/**
 * Restores a soft-deleted document by clearing `deletedAt`, reversing
 * `deleteDocument`. Requires manage access (owner-level), authorized via
 * `requireDocumentCapability` with `includeDeleted` so the soft-deleted row is
 * visible to the check; an unauthorized user is rejected with a clear error.
 * The write uses `updateMany` so a concurrent change is a harmless no-op.
 */
export async function restoreDocument(id: string): Promise<void> {
  const user = await requireUser(redirect);

  await requireDocumentCapability(user.id, id, "manage", {
    includeDeleted: true,
  });

  await restoreDocumentFromTrash(id);

  revalidatePath("/app");
}

/**
 * Server-side full-text search across the current user's accessible documents
 * covering **title** and **content** fields. Returns documents matching the
 * query, each shaped identically to `DashboardDocument` so the dashboard can
 * display them directly.
 *
 * The query is trimmed and length-clamped before being used in a DB query.
 * An empty (or whitespace-only) query returns an empty result — the caller
 * should fall back to the full document list in that case.
 *
 * Results are capped at {@link SEARCH_RESULT_LIMIT} (a one-character query can
 * otherwise match the entire corpus on every debounce tick). One extra row is
 * requested so `hasMore` can flag when matches were dropped, and the UI shows a
 * "narrow your search" hint.
 *
 * Provider behaviour is handled by {@link buildDocumentSearchWhere}: SQLite
 * uses LIKE (case-insensitive for ASCII); Postgres uses ILIKE.
 *
 * Access is scoped to the current user via `documentAccessOr` — the same gate
 * used by every other document action.
 */
export async function searchDocuments(
  rawQuery: string,
): Promise<SearchResults> {
  const user = await requireUser(redirect);
  return searchDocumentsForUser(user.id, rawQuery);
}

/**
 * Permanently dismisses first-run onboarding for the current user.
 *
 * Sets `onboardingDismissed = true` on the User row so the checklist is never
 * shown again, regardless of device or session. This is a write-once action:
 * calling it again on an already-dismissed user is a harmless no-op.
 */
export async function dismissOnboarding(): Promise<void> {
  const user = await requireUser(redirect);

  await prisma.user.updateMany({
    where: { id: user.id },
    data: { onboardingDismissed: true },
  });

  revalidatePath("/app");
}
