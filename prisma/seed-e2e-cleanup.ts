import fs from "node:fs/promises";
import path from "node:path";

import type { Prisma } from "../src/generated/prisma/client";
import { deleteDocuments } from "../src/lib/document/document-write-port";
import type { PrismaTransactionRunner } from "../src/lib/prisma-surface";

export const E2E_PRESENTATION_DOCUMENT_ID_PREFIX = "e2eisolated";
export const E2E_PRESENTATION_ASSET_ORIGINAL_NAME =
  "e2e-presentation-fixture.png";

const LEGACY_E2E_PRESENTATION_ASSET_ORIGINAL_NAME = "fixture.png";
const E2E_PRESENTATION_DOCUMENT_ID_PATTERN = /^e2eisolated[a-z0-9]+$/;
const E2E_PRESENTATION_ASSET_STORAGE_KEY_PATTERN =
  /^(e2eisolated[a-z0-9]+)\/[0-9a-f]{64}\.[a-z0-9]+$/;

type CleanupClient = Pick<PrismaTransactionRunner, "$transaction">;

export type E2ESeedCleanupInput = {
  workspaceId: string;
  ownerId: string;
  activeDocumentIds: readonly string[];
};

export type E2ESeedCleanupResult = {
  staleDocumentIds: string[];
  deletedAssetIds: string[];
  deletedAssetStorageKeys: string[];
};

export function isCanonicalE2EPresentationDocumentId(
  documentId: string,
): boolean {
  return E2E_PRESENTATION_DOCUMENT_ID_PATTERN.test(documentId);
}

export function resolveE2EPresentationAssetDirectory(
  assetRoot: string,
  documentId: string,
): string {
  if (!isCanonicalE2EPresentationDocumentId(documentId)) {
    throw new Error(`Invalid E2E presentation document id: ${documentId}`);
  }

  const resolvedRoot = path.resolve(assetRoot);
  const target = path.resolve(resolvedRoot, documentId);
  const relative = path.relative(resolvedRoot, target);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Unsafe E2E presentation asset directory: ${documentId}`);
  }
  return target;
}

export function documentIdFromE2EPresentationAssetStorageKey(
  storageKey: string,
): string | null {
  return (
    E2E_PRESENTATION_ASSET_STORAGE_KEY_PATTERN.exec(storageKey)?.[1] ?? null
  );
}

export async function removeE2EPresentationAssetDirectory(
  assetRoot: string,
  documentId: string,
  warn: (message: string) => void = console.warn,
): Promise<boolean> {
  let target: string;
  try {
    target = resolveE2EPresentationAssetDirectory(assetRoot, documentId);
  } catch {
    warn(`Skipped unsafe E2E asset directory cleanup: ${documentId}`);
    return false;
  }

  let targetStat;
  try {
    targetStat = await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }

  if (targetStat.isSymbolicLink()) {
    await fs.unlink(target);
    return true;
  }

  await fs.rm(target, { force: true, recursive: targetStat.isDirectory() });
  return true;
}

export function buildStaleE2EDocumentWhere(
  input: E2ESeedCleanupInput,
): Prisma.DocumentWhereInput {
  return {
    workspaceId: input.workspaceId,
    ownerId: input.ownerId,
    id: {
      startsWith: E2E_PRESENTATION_DOCUMENT_ID_PREFIX,
      notIn: [...input.activeDocumentIds],
    },
  };
}

export function buildStaleE2EAssetWhere(
  input: E2ESeedCleanupInput,
  staleDocumentIds: readonly string[],
): Prisma.AssetWhereInput {
  const activeStoragePrefixes = input.activeDocumentIds.map((documentId) => ({
    storageKey: { startsWith: `${documentId}/` },
  }));

  return {
    OR: [
      ...(staleDocumentIds.length > 0
        ? [{ documentId: { in: [...staleDocumentIds] } }]
        : []),
      {
        documentId: null,
        workspaceId: input.workspaceId,
        storageKey: {
          startsWith: E2E_PRESENTATION_DOCUMENT_ID_PREFIX,
        },
        originalName: {
          in: [
            E2E_PRESENTATION_ASSET_ORIGINAL_NAME,
            LEGACY_E2E_PRESENTATION_ASSET_ORIGINAL_NAME,
          ],
        },
        ...(activeStoragePrefixes.length > 0
          ? { NOT: activeStoragePrefixes }
          : {}),
      },
    ],
  };
}

export async function cleanupStaleE2EPresentationFixtures(
  db: CleanupClient,
  input: E2ESeedCleanupInput,
): Promise<E2ESeedCleanupResult> {
  return db.$transaction(async (tx) => {
    const staleDocuments = await tx.document.findMany({
      where: buildStaleE2EDocumentWhere(input),
      select: { id: true },
    });
    const staleDocumentIds = staleDocuments.map((document) => document.id);
    const staleAssets = await tx.asset.findMany({
      where: buildStaleE2EAssetWhere(input, staleDocumentIds),
      select: { id: true, storageKey: true },
    });
    const deletedAssetIds = staleAssets.map((asset) => asset.id);

    if (deletedAssetIds.length > 0) {
      await tx.asset.deleteMany({
        where: { id: { in: deletedAssetIds } },
      });
    }
    if (staleDocumentIds.length > 0) {
      await deleteDocuments(tx, {
        where: { id: { in: staleDocumentIds } },
      });
    }

    return {
      staleDocumentIds,
      deletedAssetIds,
      deletedAssetStorageKeys: staleAssets.map((asset) => asset.storageKey),
    };
  });
}
