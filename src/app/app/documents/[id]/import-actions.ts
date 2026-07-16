"use server";

import type { ImportActionResult } from "@/lib/action-ports";
import { IMPORT_PARSE_TIMEOUT_MS } from "@/lib/import/format-registry";
import { processImportUpload } from "@/lib/import/upload-service";

import { requireDocumentActionContext } from "./document-context";

export async function parseDocumentImportForEditor(
  documentId: string,
  file: File,
): Promise<ImportActionResult<{ markdown: string }>> {
  const { user } = await requireDocumentActionContext(documentId, "edit");
  const result = await processImportUpload(file, {
    subjectHash: user.id,
    deadlineAt: Date.now() + IMPORT_PARSE_TIMEOUT_MS,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: result.error.code,
        status: result.error.status,
        message: result.error.message,
      },
    };
  }

  return {
    ok: true,
    data: {
      markdown: result.markdown,
    },
  };
}
