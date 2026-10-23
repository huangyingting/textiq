import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AssetStorageAdapter } from "@/lib/assets/storage";
import { calculateAssetChecksum } from "@/lib/assets/store";
import { safeParseCurrentDeck } from "@/lib/document/deck-schema";
import { duplicateDocumentForUser } from "@/lib/document/duplicate";
import {
  buildDeck,
  buildImageNode,
  buildSlide,
} from "@/test/builders/presentation-deck";

test("document media duplication is independent, private, and rolls back failed copies", async (t) => {
  const directory = resolve("prisma/.test-dbs");
  await mkdir(directory, { recursive: true });
  const databasePath = resolve(directory, `duplicate-media-${randomUUID()}.db`);
  const databaseUrl = `file:${databasePath}`;
  await promisify(execFile)(
    "npx",
    ["prisma", "db", "push", "--schema", "prisma/schema.sqlite.prisma"],
    {
      env: { ...process.env, DB_PROVIDER: "sqlite", DATABASE_URL: databaseUrl },
    },
  );
  const db = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
  });
  t.after(async () => {
    await db.$disconnect();
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      await rm(`${databasePath}${suffix}`, { force: true });
    }
  });

  const bytes = Buffer.from("independent presentation pixels");
  const checksum = calculateAssetChecksum(bytes);
  const sourceKey = `source-doc/${checksum}.png`;
  const files = new Map<string, Buffer>([[sourceKey, bytes]]);
  const storage: AssetStorageAdapter = {
    async read(key) {
      const value = files.get(key);
      if (!value) throw new Error("asset bytes unavailable");
      return value;
    },
    async store(key, value) {
      files.set(key, value);
      return this.urlFor(key);
    },
    urlFor(key) {
      return `/api/slide-assets/${key}`;
    },
    async delete(key) {
      files.delete(key);
    },
  };

  await db.user.createMany({
    data: [
      { id: "source-owner", email: "source@duplicate.test" },
      { id: "copy-owner", email: "copy@duplicate.test" },
    ],
  });
  const deck = buildDeck(
    [
      buildSlide("content", [
        {
          id: "group",
          type: "group",
          component: "custom",
          children: [buildImageNode("source-image")],
        },
      ]),
    ],
    {
      assets: {
        images: {
          "source-image": {
            id: "source-image",
            src: `${storage.urlFor(sourceKey)}?shareId=original-share&shareMode=present`,
          },
          external: { id: "external", src: "https://example.com/pixels.png" },
        },
      },
      chrome: { logo: { assetId: "source-image" } },
    },
  );
  assert.ok(
    safeParseCurrentDeck(deck).success,
    "source fixture must be current-schema valid",
  );
  await db.document.create({
    data: {
      id: "source-doc",
      ownerId: "source-owner",
      title: "Media source",
      deckJson: JSON.parse(JSON.stringify(deck)) as Prisma.InputJsonValue,
      isShared: true,
      shareId: "original-share",
    },
  });
  await db.asset.createMany({
    data: [
      {
        id: "source-image",
        documentId: "source-doc",
        storageKey: sourceKey,
        checksum,
        mimeType: "image/png",
        byteSize: bytes.byteLength,
        widthPx: 20,
        heightPx: 10,
      },
      {
        id: "unused-image",
        documentId: "source-doc",
        storageKey: "source-doc/unused.png",
        checksum: "unused",
        mimeType: "image/png",
        byteSize: 1,
      },
    ],
  });

  const copy = await duplicateDocumentForUser(
    "copy-owner",
    "source-doc",
    db,
    storage,
  );
  assert.ok(copy);
  const saved = await db.document.findUniqueOrThrow({
    where: { id: copy.id },
    include: { assets: true },
  });
  assert.equal(saved.ownerId, "copy-owner");
  assert.equal(saved.isShared, false);
  assert.equal(saved.shareId, null);
  assert.equal(saved.assets.length, 1, "copy only referenced document assets");
  const asset = saved.assets[0]!;
  assert.notEqual(asset.id, "source-image");
  assert.equal(asset.documentId, copy.id);
  assert.equal(asset.workspaceId, null);
  assert.equal(asset.brandId, null);
  assert.equal(asset.widthPx, 20);
  assert.equal(asset.heightPx, 10);
  assert.equal(asset.deletedAt, null);
  assert.ok(asset.storageKey.startsWith(`${copy.id}/`));
  const parsed = safeParseCurrentDeck(saved.deckJson);
  assert.ok(parsed.success);
  const copiedDeck = parsed.data;
  assert.equal(copiedDeck.assets.images["source-image"], undefined);
  assert.equal(copiedDeck.assets.images[asset.id]?.id, asset.id);
  assert.equal(
    copiedDeck.assets.images[asset.id]?.src,
    storage.urlFor(asset.storageKey),
  );
  assert.equal(copiedDeck.chrome?.logo?.assetId, asset.id);
  assert.equal(
    copiedDeck.assets.images.external?.src,
    "https://example.com/pixels.png",
  );
  const group = copiedDeck.slides[0]!.children[0]!;
  assert.equal(group.type, "group");
  if (group.type !== "group") assert.fail("expected copied group");
  const image = group.children[0]!;
  assert.equal(image.type, "image");
  if (image.type !== "image") assert.fail("expected copied image");
  assert.equal(image.content.assetId, asset.id);

  await t.test("missing source bytes abort the database copy", async () => {
    files.delete(sourceKey);
    const before = await db.document.count();
    await assert.rejects(
      duplicateDocumentForUser("copy-owner", "source-doc", db, storage),
      /asset bytes unavailable/,
    );
    assert.equal(await db.document.count(), before);
    assert.equal(
      await db.asset.count({ where: { document: { ownerId: "copy-owner" } } }),
      1,
    );
    files.set(sourceKey, bytes);
  });

  await t.test("corrupted source bytes abort the database copy", async () => {
    files.set(sourceKey, Buffer.from("corrupted presentation pixels"));
    const before = new Set(files.keys());
    const documentCount = await db.document.count();
    await assert.rejects(
      duplicateDocumentForUser("copy-owner", "source-doc", db, storage),
      /stored bytes are corrupted/,
    );
    assert.equal(await db.document.count(), documentCount);
    assert.deepEqual(new Set(files.keys()), before);
    files.set(sourceKey, bytes);
  });

  await t.test(
    "a partial storage write is cleaned up when duplication fails",
    async () => {
      const before = new Set(files.keys());
      const failingStorage: AssetStorageAdapter = {
        ...storage,
        async store(key, value) {
          files.set(key, value);
          throw new Error("partial storage failure");
        },
      };
      const documentCount = await db.document.count();
      await assert.rejects(
        duplicateDocumentForUser(
          "copy-owner",
          "source-doc",
          db,
          failingStorage,
        ),
        /partial storage failure/,
      );
      assert.equal(await db.document.count(), documentCount);
      assert.deepEqual(new Set(files.keys()), before);
    },
  );

  await t.test(
    "cleanup errors are logged without replacing the original failure",
    async (cleanupTest) => {
      const failure = new Error("original storage failure");
      const logged = cleanupTest.mock.method(console, "error", () => {});
      const failingStorage: AssetStorageAdapter = {
        ...storage,
        async store() {
          throw failure;
        },
        async delete() {
          throw new Error("cleanup unavailable");
        },
      };
      const documentCount = await db.document.count();
      await assert.rejects(
        duplicateDocumentForUser(
          "copy-owner",
          "source-doc",
          db,
          failingStorage,
        ),
        (error) => error === failure,
      );
      assert.equal(await db.document.count(), documentCount);
      assert.equal(logged.mock.callCount(), 1);
      const record = JSON.parse(logged.mock.calls[0]!.arguments[0]);
      assert.equal(record.scope, "document.duplicate");
      assert.equal(record.operation, "asset_cleanup");
      assert.equal(record.message, "cleanup unavailable");
    },
  );

  await db.document.delete({ where: { id: "source-doc" } });
  files.delete(sourceKey);
  assert.deepEqual(
    await storage.read(asset.storageKey),
    bytes,
    "source erasure must not remove copied pixels",
  );
});
