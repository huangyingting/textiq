import assert from "node:assert/strict";
import { test } from "node:test";
import clarityPackageJson from "../../../prototypes/slide-themes/packages/clarity.package.json";

import {
  getThemePackage,
  listThemePackages,
  resolveThemePackageId,
  resolveThemePackageForDeck,
} from "./theme-package-registry";
import { validateThemePackage } from "./theme-package-schema";

function cloneFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test("getThemePackage resolves generated presentation theme packages by id", () => {
  assert.equal(getThemePackage("ocean")?.id, "ocean");
  assert.equal(getThemePackage("clarity")?.id, "clarity");
});

test("resolveThemePackageForDeck returns the requested presentation package", () => {
  const result = resolveThemePackageForDeck({
    theme: { packageId: "ocean" },
  });

  assert.equal(result.package.id, "ocean");
  assert.equal(result.fallback, false);
  assert.deepEqual(result.diagnostics, []);
});

test("resolveThemePackageForDeck accepts validated custom packages at load boundaries", () => {
  const customPackage = {
    ...cloneFixture(clarityPackageJson),
    id: "brand-kit:user-user-1:custom",
    version: "1.0.0+r1",
    name: "Custom",
  };
  const validation = validateThemePackage(customPackage);
  assert.equal(validation.valid, true);
  if (!validation.valid) return;

  const result = resolveThemePackageForDeck(
    {
      theme: {
        packageId: validation.package.id,
        packageVersion: validation.package.version,
      },
    },
    { customPackages: [validation.package] },
  );

  assert.equal(result.package.id, validation.package.id);
  assert.equal(result.package.version, validation.package.version);
  assert.equal(result.fallback, false);
  assert.deepEqual(result.diagnostics, []);
});

test("resolveThemePackageId shares built-in aliases without blocking custom ids", () => {
  assert.equal(resolveThemePackageId(undefined), "neutral");
  assert.equal(resolveThemePackageId("default"), "clarity");
  assert.equal(resolveThemePackageId("custom-brand"), "custom-brand");
});

test("resolveThemePackageForDeck falls back to neutral with a diagnostic for unknown packages", () => {
  const result = resolveThemePackageForDeck({
    theme: { packageId: "missing-package" },
  });

  assert.equal(result.package.id, "neutral");
  assert.equal(result.fallback, true);
  assert.equal(result.diagnostics[0]?.code, "unknown-theme-package");
  assert.equal(result.diagnostics[0]?.path, "theme.packageId");
});

test("listThemePackages includes neutral and generated runtime packages", () => {
  const ids = listThemePackages().map((themePackage) => themePackage.id);

  assert.ok(ids.includes("neutral"));
  assert.ok(ids.includes("ocean"));
  assert.ok(ids.includes("pulse"));
});

test("listThemePackages returns a stable memoized list", () => {
  const first = listThemePackages();
  const second = listThemePackages();

  assert.equal(first, second);
});

test("listThemePackages keeps all generated packages after validation", () => {
  const ids = new Set(
    listThemePackages().map((themePackage) => themePackage.id),
  );

  for (const id of [
    "neutral",
    "clarity",
    "ocean",
    "aurora",
    "monolith",
    "editorial",
    "noir",
    "terra",
    "pulse",
  ]) {
    assert.ok(ids.has(id), `Expected theme package "${id}" in registry`);
  }
});

test("registry ingestion contract rejects unknown top-level theme package fields", () => {
  const invalidPackage = {
    ...cloneFixture(clarityPackageJson),
    unsupportedField: { enabled: true },
  };

  const result = validateThemePackage(invalidPackage);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "unknown-field" &&
          diagnostic.message.includes(
            "ThemePackage.unsupportedField is not a known theme package field",
          ),
      ),
    );
  }
});

test("registry ingestion contract rejects malformed theme package assets", () => {
  const invalidPackage = {
    ...cloneFixture(clarityPackageJson),
    assets: {
      images: {
        "hero-image": {
          id: "hero-image",
          src: "https://example.com/hero.bmp",
          mimeType: "image/bmp",
        },
      },
    },
  };

  const result = validateThemePackage(invalidPackage);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes(
          "ThemePackage.assets.images.hero-image.mimeType must be one of:",
        ),
      ),
    );
  }
});

test("registry ingestion contract rejects malformed theme package decorations", () => {
  const invalidPackage = {
    ...cloneFixture(clarityPackageJson),
    decorations: {
      badDecoration: {
        id: "badDecoration",
        component: "text",
        role: "themeDecoration",
        layout: {
          frame: { x: 0, y: 0, w: 20, h: 20 },
          zIndex: 0,
        },
        style: {},
        content: { type: "text", text: "fixture decoration" },
        appliesTo: {
          templateKinds: ["cover", "not-a-template"],
        },
      },
    },
  };

  const result = validateThemePackage(invalidPackage);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes(
          "ThemePackage.decorations.badDecoration.appliesTo.templateKinds.1 must be one of:",
        ),
      ),
    );
  }
});
