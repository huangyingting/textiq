import "server-only";

import { Prisma } from "@/generated/prisma/client";
import {
  WorkspacePermissionError,
  requireWorkspaceCapability,
} from "@/lib/auth/workspace-capabilities";
import {
  clampDocumentContent,
  clampDocumentTitle,
  importedMarkdownToContentJson,
} from "@/lib/document/create";
import { logError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

import {
  IMPORT_ERROR_CODES,
  importFailure,
  type ImportCreationTarget,
  type ImportRouteCreateSuccess,
  type ImportRouteFailure,
} from "./contract";
import { deriveImportedDocumentTitle } from "./title";
import { processImportUpload, type ImportUploadResult } from "./upload-service";

const LOG_SCOPE = "api.import.application";

type PersistImportDb = Pick<typeof prisma, "$transaction">;

export type PersistImportArgs = {
  userId: string;
  fileName: string;
  markdown: string;
  target: ImportCreationTarget;
};

export async function persistImportedDocument(
  args: PersistImportArgs,
  db: PersistImportDb = prisma,
): Promise<{ id: string }> {
  const rawTitle = deriveImportedDocumentTitle(args.fileName);
  const title = clampDocumentTitle(rawTitle, "Imported document");
  const safeContent = clampDocumentContent(args.markdown);
  const contentJson = importedMarkdownToContentJson(safeContent);

  return db.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        ownerId: args.userId,
        title,
        contentJson,
        ...(args.target.kind === "workspace"
          ? { workspaceId: args.target.workspaceId }
          : {}),
      },
      select: { id: true },
    });

    await tx.documentVersion.create({
      data: {
        documentId: document.id,
        contentJson,
        createdById: args.userId,
      },
      select: { id: true },
    });

    return { id: document.id };
  });
}

function isPrismaConflictError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  );
}

function isPrismaPersistenceError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  );
}

interface ImportApplicationDeps {
  getCurrentUser: typeof getCurrentUser;
  requireWorkspaceCapability: typeof requireWorkspaceCapability;
  processImportUpload: (
    file: File,
    options: { subjectHash: string },
  ) => Promise<ImportUploadResult>;
  persistImportedDocument: (
    args: PersistImportArgs,
  ) => Promise<{ id: string }>;
  logError: typeof logError;
}

const defaultDeps: ImportApplicationDeps = {
  getCurrentUser,
  requireWorkspaceCapability,
  processImportUpload,
  persistImportedDocument: (args) => persistImportedDocument(args),
  logError,
};

export async function createDocumentFromImportUpload(
  input: {
    file: File;
    subjectHash: string;
    target: ImportCreationTarget;
  },
  deps: Partial<ImportApplicationDeps> = {},
): Promise<ImportRouteCreateSuccess | ImportRouteFailure> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  const user = await resolvedDeps.getCurrentUser();

  if (!user?.id) {
    return importFailure(
      IMPORT_ERROR_CODES.UNAUTHORIZED,
      "Sign in to import a document.",
    );
  }

  if (input.target.kind === "workspace") {
    try {
      await resolvedDeps.requireWorkspaceCapability(
        user.id,
        input.target.workspaceId,
        "mutate",
      );
    } catch (error) {
      if (error instanceof WorkspacePermissionError) {
        return importFailure(
          IMPORT_ERROR_CODES.FORBIDDEN,
          "You do not have permission to import documents into this workspace.",
        );
      }
      resolvedDeps.logError(LOG_SCOPE, error, {
        reason: "workspace-authorize-failed",
        target: input.target.kind,
      });
      return importFailure(
        IMPORT_ERROR_CODES.INTERNAL,
        "Import failed unexpectedly. Please try again.",
      );
    }
  }

  const parsed = await resolvedDeps.processImportUpload(input.file, {
    subjectHash: input.subjectHash,
  });
  if (!parsed.ok) {
    return parsed;
  }

  try {
    const document = await resolvedDeps.persistImportedDocument({
      userId: user.id,
      fileName: input.file.name,
      markdown: parsed.markdown,
      target: input.target,
    });
    return {
      ok: true,
      mode: "create",
      documentId: document.id,
      documentPath: `/app/documents/${document.id}`,
    };
  } catch (error) {
    if (isPrismaConflictError(error)) {
      resolvedDeps.logError(LOG_SCOPE, error, {
        reason: "persist-conflict",
        target: input.target.kind,
      });
      return importFailure(
        IMPORT_ERROR_CODES.CONFLICT,
        "A conflicting update prevented the import. Please try again.",
      );
    }
    if (isPrismaPersistenceError(error)) {
      resolvedDeps.logError(LOG_SCOPE, error, {
        reason: "persist-failed",
        target: input.target.kind,
      });
      return importFailure(
        IMPORT_ERROR_CODES.PERSISTENCE,
        "The document could not be saved. Please try again.",
      );
    }
    resolvedDeps.logError(LOG_SCOPE, error, {
      reason: "import-unexpected",
      target: input.target.kind,
    });
    return importFailure(
      IMPORT_ERROR_CODES.INTERNAL,
      "Import failed unexpectedly. Please try again.",
    );
  }
}
