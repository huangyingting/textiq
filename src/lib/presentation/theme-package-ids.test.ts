import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BUILT_IN_THEME_PACKAGE_IDS,
  DEFAULT_BUILT_IN_THEME_PACKAGE_ID,
  isBuiltInThemePackageId,
  resolveBuiltInThemePackageId,
} from "./theme-package-ids";

test("built-in theme package id catalog is canonical and excludes fallbacks", () => {
  assert.deepEqual(BUILT_IN_THEME_PACKAGE_IDS, [
    "clarity",
    "ocean",
    "aurora",
    "monolith",
    "editorial",
    "noir",
    "terra",
    "pulse",
  ]);
  assert.equal(DEFAULT_BUILT_IN_THEME_PACKAGE_ID, "clarity");
  assert.equal(isBuiltInThemePackageId("ocean"), true);
  assert.equal(isBuiltInThemePackageId("neutral"), false);
});

test("built-in theme package id resolution keeps only shared aliases", () => {
  assert.equal(resolveBuiltInThemePackageId("default"), "clarity");
  assert.equal(resolveBuiltInThemePackageId("pulse"), "pulse");
  assert.equal(resolveBuiltInThemePackageId("custom-brand"), undefined);
});
