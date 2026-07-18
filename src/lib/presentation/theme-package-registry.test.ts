import assert from "node:assert/strict";
import { test } from "node:test";
import clarityPackageJson from "../../../prototypes/slide-themes/packages/clarity.package.json";

import {
  getThemePackage,
  listThemePackageCatalog,
  listThemePackages,
  mergeThemePackageCatalogEntries,
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

test("resolveThemePackageForDeck preserves built-in package resolution", () => {
  const result = resolveThemePackageForDeck({
    theme: { packageId: "ocean", packageVersion: "ignored-for-built-ins" },
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
    {
      activePackages: [validation.package],
    },
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

test("catalog dedup keeps the newest persisted same-id snapshot independent of the active render package", () => {
  const active = {
    ...cloneFixture(clarityPackageJson),
    id: "brand-kit:user-user-1:custom",
    version: "1.0.0+r1",
  };
  const latest = { ...active, version: "2.0.0+r1" };
  const other = {
    ...cloneFixture(clarityPackageJson),
    id: "brand-kit:user-user-1:other",
    version: "3.0.0+r1",
  };
  const packages = mergeThemePackageCatalogEntries([
    {
      package: active as never,
      source: "custom",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      package: latest as never,
      source: "custom",
      createdAt: "2026-02-01T00:00:00.000Z",
    },
    {
      package: other as never,
      source: "custom",
      createdAt: "2026-01-15T00:00:00.000Z",
    },
  ]);

  assert.deepEqual(
    packages.map((entry) => [
      entry.package.id,
      entry.package.version,
      entry.createdAt,
    ]),
    [
      [latest.id, latest.version, "2026-02-01T00:00:00.000Z"],
      [other.id, other.version, "2026-01-15T00:00:00.000Z"],
    ],
  );
});

test("catalog ordering uses persisted recency with deterministic id and version ties", () => {
  const first = {
    ...cloneFixture(clarityPackageJson),
    id: "brand-kit:user-user-1:a",
    version: "1.0.0+r1",
  };
  const second = { ...first, id: "brand-kit:user-user-1:b" };
  const entries = mergeThemePackageCatalogEntries([
    {
      package: second as never,
      source: "custom",
      createdAt: "2026-03-01T00:00:00.000Z",
    },
    {
      package: first as never,
      source: "custom",
      createdAt: "2026-03-01T00:00:00.000Z",
    },
    ...listThemePackageCatalog(),
  ]);

  assert.deepEqual(
    entries.slice(0, 2).map((entry) => entry.package.id),
    [first.id, second.id],
  );
  assert.equal(entries.at(-1)?.source, "built-in");
});

test("missing-version custom references never resolve from a same-id latest catalog entry", () => {
  const latest = {
    ...cloneFixture(clarityPackageJson),
    id: "brand-kit:user-user-1:custom",
    version: "2.0.0+r1",
  };
  const catalogEntries = mergeThemePackageCatalogEntries([
    {
      package: latest as never,
      source: "custom",
      createdAt: "2026-04-01T00:00:00.000Z",
    },
  ]);
  const result = resolveThemePackageForDeck({
    theme: { packageId: latest.id },
  });

  assert.equal(catalogEntries[0]?.package.version, latest.version);
  assert.equal(result.package.id, "neutral");
  assert.equal(result.fallback, true);
  assert.equal(result.diagnostics[0]?.code, "unknown-theme-package");
});

test("mismatched custom package IDs or versions use the safe fallback path", () => {
  const active = {
    ...cloneFixture(clarityPackageJson),
    id: "brand-kit:user-user-1:custom",
    version: "1.0.0+r1",
  };
  const latest = { ...active, version: "2.0.0+r1" };
  const catalogEntries = mergeThemePackageCatalogEntries([
    {
      package: latest as never,
      source: "custom",
      createdAt: "2026-04-01T00:00:00.000Z",
    },
  ]);
  const versionMismatch = resolveThemePackageForDeck(
    {
      theme: {
        packageId: latest.id,
        packageVersion: latest.version,
      },
    },
    {
      activePackages: [active as never],
    },
  );
  const idMismatch = resolveThemePackageForDeck(
    {
      theme: {
        packageId: "brand-kit:user-user-1:other",
        packageVersion: active.version,
      },
    },
    {
      activePackages: [active as never],
    },
  );

  assert.equal(catalogEntries[0]?.package.version, latest.version);
  for (const result of [versionMismatch, idMismatch]) {
    assert.equal(result.package.id, "neutral");
    assert.equal(result.fallback, true);
    assert.equal(result.diagnostics[0]?.code, "unknown-theme-package");
  }
});

test("an exact active custom package resolves independently of newer catalog state", () => {
  const active = {
    ...cloneFixture(clarityPackageJson),
    id: "brand-kit:user-user-1:custom",
    version: "1.0.0+r1",
  };
  const latest = { ...active, version: "2.0.0+r1" };
  const catalogEntries = mergeThemePackageCatalogEntries([
    {
      package: latest as never,
      source: "custom",
      createdAt: "2026-04-01T00:00:00.000Z",
    },
  ]);
  const result = resolveThemePackageForDeck(
    {
      theme: {
        packageId: active.id,
        packageVersion: active.version,
      },
    },
    { activePackages: [active as never] },
  );

  assert.equal(catalogEntries[0]?.package.version, latest.version);
  assert.equal(result.package.version, active.version);
  assert.equal(result.fallback, false);
});

test("invalid exact active custom snapshots use the safe fallback path", () => {
  const invalid = {
    id: "brand-kit:user-user-1:custom",
    version: "1.0.0+r1",
  };
  const result = resolveThemePackageForDeck(
    {
      theme: {
        packageId: invalid.id,
        packageVersion: invalid.version,
      },
    },
    { activePackages: [invalid as never] },
  );

  assert.equal(result.package.id, "neutral");
  assert.equal(result.fallback, true);
  assert.equal(result.diagnostics[0]?.code, "unknown-theme-package");
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
