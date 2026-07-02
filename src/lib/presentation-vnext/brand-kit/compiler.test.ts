import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDeckV7,
  buildTextNode,
  buildThemeBinding,
  buildSlideV7,
} from "@/test/builders/deck-v7";

import { resolveDeckRenderTree } from "../render-resolver";
import { validateThemePackage } from "../theme-package-schema";
import { compileBrandKitDraft } from "./compiler";
import type { BrandKitDraftV1 } from "./schema";

export function buildValidBrandKitDraft(
  overrides: Partial<BrandKitDraftV1> = {},
): BrandKitDraftV1 {
  return {
    schemaVersion: 1,
    id: "draft-1",
    name: "Acme Brand",
    slug: "acme-brand",
    scope: { kind: "user", ownerId: "user-1" },
    sourcePresetId: "clarity",
    version: "1.2.3",
    revision: {
      id: "revision-7",
      number: 7,
      createdAt: "2026-07-02T13:22:11.000Z",
    },
    palette: {
      backgrounds: {
        canvas: "#ffffff",
        muted: "#f8fafc",
        inverse: "#0f172a",
      },
      surfaces: {
        default: "#ffffff",
        elevated: "#f1f5f9",
        subtle: "#e0f2fe",
      },
      text: {
        primary: "#111827",
        secondary: "#475569",
        inverse: "#f8fafc",
        accent: "#2563eb",
      },
      accents: {
        primary: "#2563eb",
        secondary: "#0ea5e9",
      },
      borders: {
        default: "#cbd5e1",
        strong: "#64748b",
      },
      charts: ["#2563eb", "#0ea5e9", "#22c55e", "#f59e0b"],
      states: {
        success: { fill: "#dcfce7", text: "#166534" },
        warning: { fill: "#fef3c7", text: "#92400e" },
        danger: { fill: "#fee2e2", text: "#991b1b" },
        info: { fill: "#dbeafe", text: "#1e40af" },
      },
    },
    typography: {
      display: {
        family: "Inter, system-ui, sans-serif",
        sizePt: 42,
        weight: 800,
        lineHeight: 1.1,
      },
      heading: {
        family: "Inter, system-ui, sans-serif",
        sizePt: 24,
        weight: 700,
        lineHeight: 1.2,
      },
      body: {
        family: "Inter, system-ui, sans-serif",
        sizePt: 14,
        weight: 400,
        lineHeight: 1.45,
      },
      caption: {
        family: "Inter, system-ui, sans-serif",
        sizePt: 10,
        weight: 500,
        lineHeight: 1.3,
        letterSpacingEm: 0.02,
      },
      mono: {
        family: "Roboto Mono, monospace",
        sizePt: 11,
        weight: 500,
        lineHeight: 1.3,
      },
      data: {
        family: "Inter, system-ui, sans-serif",
        sizePt: 38,
        weight: 800,
        lineHeight: 1.05,
      },
    },
    assets: {
      logo: {
        id: "acme-logo",
        src: "https://assets.example.com/acme.svg",
        alt: "Acme logo",
        mimeType: "image/svg+xml",
      },
    },
    decorations: {
      background: "subtle",
      chrome: "default",
    },
    ...overrides,
  };
}

test("compileBrandKitDraft compiles a valid draft into a valid immutable ThemePackageV1 snapshot", () => {
  const result = compileBrandKitDraft(buildValidBrandKitDraft());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.package.id, "brand-kit:user-user-1:acme-brand");
  assert.equal(result.package.version, "1.2.3+r7");
  assert.equal(result.package.name, "Acme Brand");
  assert.equal(result.package.assets?.images?.["acme-logo"]?.id, "acme-logo");
  assert.equal(Object.isFrozen(result.package), true);
  assert.equal(validateThemePackage(result.package).valid, true);
});

test("compileBrandKitDraft returns field-addressable warnings while still compiling", () => {
  const draft = buildValidBrandKitDraft({
    palette: {
      ...buildValidBrandKitDraft().palette,
      charts: ["#2563eb", "#0ea5e9"],
    },
  });
  const result = compileBrandKitDraft(draft);

  assert.equal(result.ok, true);
  assert.equal(result.diagnostics[0]?.severity, "warning");
  assert.equal(result.diagnostics[0]?.code, "sparse-chart-palette");
  assert.equal(result.diagnostics[0]?.path, "palette.charts");
});

test("compileBrandKitDraft rejects invalid drafts with authoring field diagnostics", () => {
  const result = compileBrandKitDraft({
    ...buildValidBrandKitDraft(),
    slug: "Bad Slug",
    palette: {
      ...buildValidBrandKitDraft().palette,
      accents: { primary: "blue", secondary: "#0ea5e9" },
    },
    typography: {
      ...buildValidBrandKitDraft().typography,
      display: {
        ...buildValidBrandKitDraft().typography.display,
        sizePt: 3,
      },
    },
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "invalid-slug" && diagnostic.path === "slug",
    ),
  );
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "invalid-color" &&
        diagnostic.path === "palette.accents.primary",
    ),
  );
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "invalid-font-size" &&
        diagnostic.path === "typography.display.sizePt",
    ),
  );
});

test("compiled custom package resolves through the render tree like a built-in package", () => {
  const result = compileBrandKitDraft(buildValidBrandKitDraft());
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const deck = buildDeckV7(
    [
      buildSlideV7("content", [
        buildTextNode({
          id: "title-1",
          role: "title",
          style: { ref: "text.title" },
        }),
      ]),
    ],
    {
      theme: buildThemeBinding({
        packageId: result.package.id,
        packageVersion: result.package.version,
      }),
    },
  );

  const tree = resolveDeckRenderTree(deck, result.package);

  assert.equal(tree.theme.packageId, result.package.id);
  assert.equal(tree.theme.packageVersion, result.package.version);
  assert.equal(tree.slides[0]?.nodes[0]?.style.text?.fontSizePt, 42);
});
