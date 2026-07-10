"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireDocumentCapability } from "@/lib/auth/document-permissions";
import { requireUser } from "@/lib/session";
import { permanentDeleteDocument as deleteDocumentPermanently } from "@/lib/document/trash";

/**
 * Permanently removes a single soft-deleted document (hard delete). Requires
 * manage access (owner-level), authorized via `requireDocumentCapability` with
 * `includeDeleted` so the soft-deleted row is visible to the permission check.
 * The associated `Visual`/`Comment` rows cascade away via the existing
 * `onDelete: Cascade` relations.
 *
 * The write uses `deleteMany` with `deletedAt: { not: null }` as a safety guard
 * so a document that has been restored between the UI load and this call is
 * never accidentally hard-deleted.
 */
export async function permanentDeleteDocument(id: string): Promise<void> {
  const user = await requireUser(redirect);

  await requireDocumentCapability(user.id, id, "manage", {
    includeDeleted: true,
  });

  await deleteDocumentPermanently(id);

  revalidatePath("/app/trash");
  revalidatePath("/app");
}
