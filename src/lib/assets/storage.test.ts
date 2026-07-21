import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  deriveAssetStorageKey,
  LocalAssetStorageAdapter,
} from "@/lib/assets/storage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_ROOT = path.join(__dirname, "__test_output__", "assets-storage");

describe("neutral LocalAssetStorageAdapter", () => {
  before(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  });

  after(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  });

  it("stores, reads, urls, and deletes through the neutral adapter contract", async () => {
    const adapter = new LocalAssetStorageAdapter(TEST_ROOT, "/api/test-assets");
    const key = "scope/checksum.png";
    const bytes = Buffer.from("asset-bytes");

    const url = await adapter.store(key, bytes, "image/png");
    assert.equal(url, "/api/test-assets/scope/checksum.png");
    assert.deepEqual(await adapter.read(key), bytes);
    const stat = await adapter.stat(key);
    assert.equal(stat.size, bytes.length);
    assert.ok(stat.mtime instanceof Date);
    const stream = await adapter.stream(key);
    const reader = stream.getReader();
    const chunks: Buffer[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(Buffer.from(value));
    }
    assert.deepEqual(Buffer.concat(chunks), bytes);

    await adapter.delete(key);
    await assert.rejects(
      () => adapter.read(key),
      (err: NodeJS.ErrnoException) => err.code === "ENOENT",
    );
  });

  it("rejects traversal-capable storage keys before touching disk", async () => {
    const adapter = new LocalAssetStorageAdapter(TEST_ROOT, "/api/test-assets");
    const traversalKeys = [
      "../escape.png",
      "/absolute/escape.png",
      "scope/%2e%2e/escape.png",
      "scope//escape.png",
    ];

    for (const key of traversalKeys) {
      await assert.rejects(
        () => adapter.store(key, Buffer.from("asset-bytes"), "image/png"),
        /Invalid asset storage key/,
      );
      await assert.rejects(
        () => adapter.read(key),
        /Invalid asset storage key/,
      );
      assert.throws(() => adapter.urlFor(key), /Invalid asset storage key/);
    }

    await assert.rejects(
      () => fs.stat(path.join(TEST_ROOT, "..", "escape.png")),
      (err: NodeJS.ErrnoException) => err.code === "ENOENT",
    );
  });
});

describe("deriveAssetStorageKey", () => {
  it("partitions by scope id and uses MIME-derived extensions", () => {
    const map = { "image/png": "png", "font/woff2": "woff2" };

    assert.equal(
      deriveAssetStorageKey("scope-a", "abc", "image/png", map),
      "scope-a/abc.png",
    );
    assert.equal(
      deriveAssetStorageKey("scope-a", "abc", "font/woff2", map),
      "scope-a/abc.woff2",
    );
    assert.equal(
      deriveAssetStorageKey("scope-a", "abc", "text/html", map),
      "scope-a/abc.bin",
    );
  });
});
