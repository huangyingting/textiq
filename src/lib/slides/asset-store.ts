import "server-only";

import { storeAssetWithUpsert } from "@/lib/assets/store";
import { prisma } from "@/lib/prisma";

import { getDefaultStorageAdapter, MIME_TO_EXT } from "./asset-storage";
import type { AssetMeta } from "./asset-upload";

export interface StoreSlideAssetResult {
  assetId: string;
  url: string;
  checksum: string;
  storageKey: string;
}

export async function storeSlideAsset(opts: {
  documentId: string;
  buffer: Buffer;
  meta: AssetMeta;
}): Promise<StoreSlideAssetResult> {
  const { documentId, buffer, meta } = opts;
  const adapter = getDefaultStorageAdapter();

  return storeAssetWithUpsert({
    scopeId: documentId,
    buffer,
    mimeType: meta.mimeType,
    originalName: meta.originalName,
    mimeToExt: MIME_TO_EXT,
    storage: adapter,
    storeBeforeFind: true,
    async findExisting({ checksum }) {
      return prisma.asset.findFirst({
        where: { documentId, checksum },
        select: { id: true, storageKey: true, deletedAt: true },
      });
    },
    async updateExisting(existing) {
      if (existing.deletedAt) {
        await prisma.asset.update({
          where: { id: existing.id },
          data: { deletedAt: null },
        });
      }
    },
    async createAsset(input) {
      return prisma.asset.create({
        data: {
          documentId,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          checksum: input.checksum,
          storageKey: input.storageKey,
          ...(meta.widthPx !== undefined ? { widthPx: meta.widthPx } : {}),
          ...(meta.heightPx !== undefined ? { heightPx: meta.heightPx } : {}),
          ...(input.originalName ? { originalName: input.originalName } : {}),
        },
        select: { id: true },
      });
    },
    async findAfterConflict({ checksum }) {
      return prisma.asset.findFirst({
        where: { documentId, checksum },
        select: { id: true },
      });
    },
  });
}
