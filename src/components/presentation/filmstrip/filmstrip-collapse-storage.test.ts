import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filmstripCollapsedStorageKey,
  readFilmstripCollapsed,
  writeFilmstripCollapsed,
} from "./filmstrip-collapse-storage";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test("filmstrip storage key is derived per document", () => {
  const docA = filmstripCollapsedStorageKey("doc-1");
  const docB = filmstripCollapsedStorageKey("doc-2");

  assert.notEqual(docA, docB);
  assert.match(docA, /^slide-filmstrip-collapsed:/);
  assert.match(docB, /^slide-filmstrip-collapsed:/);
});

test("filmstrip collapsed state does not leak across document ids", () => {
  const storage = new MemoryStorage();

  writeFilmstripCollapsed("doc-1", true, storage);

  assert.equal(readFilmstripCollapsed("doc-1", storage), true);
  assert.equal(readFilmstripCollapsed("doc-2", storage), false);
});
