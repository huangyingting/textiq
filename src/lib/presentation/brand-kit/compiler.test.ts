import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDeck,
  buildTextNode,
  buildThemeBinding,
  buildSlide,
} from "@/test/builders/presentation-deck";
import { slideFontCssStack } from "@/lib/presentation/slide-fonts";

import { buildExportSpec } from "../export-spec";
import { buildPptxSpec } from "../pptx-export-adapter";
import { resolveDeckRenderTree } from "../render-resolver";
import { buildThemePackageFontFaceCss } from "../theme-package-fonts";
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

  const deck = buildDeck(
    [
      buildSlide("content", [
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

test("compileBrandKitDraft blocks critical WCAG text contrast failures", () => {
  const draft = buildValidBrandKitDraft({
    palette: {
      ...buildValidBrandKitDraft().palette,
      text: {
        ...buildValidBrandKitDraft().palette.text,
        primary: "#777777",
      },
    },
  });

  const result = compileBrandKitDraft(draft);

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "insufficient-contrast" &&
        diagnostic.severity === "error" &&
        diagnostic.path === "palette.text.primary",
    ),
  );
});

test("compileBrandKitDraft keeps non-text contrast issues as warnings", () => {
  const result = compileBrandKitDraft(buildValidBrandKitDraft());

  assert.equal(result.ok, true);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "insufficient-contrast" &&
        diagnostic.severity === "warning",
    ),
  );
  assert.equal(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "insufficient-contrast" &&
        diagnostic.severity === "error",
    ),
    false,
  );
});

test("custom and registry brand-kit fonts resolve for render, font CSS, and PPTX export", () => {
  const sourceSerifStack = slideFontCssStack("source-serif-4");
  assert.ok(sourceSerifStack);
  const result = compileBrandKitDraft(
    buildValidBrandKitDraft({
      typography: {
        ...buildValidBrandKitDraft().typography,
        display: {
          ...buildValidBrandKitDraft().typography.display,
          family: "source-serif-4",
        },
        body: {
          ...buildValidBrandKitDraft().typography.body,
          family: "Acme Sans",
          fontAssetId: "acme-sans",
        },
      },
      assets: {
        ...buildValidBrandKitDraft().assets,
        fonts: {
          "acme-sans": {
            id: "acme-sans",
            family: "Acme Sans",
            src: "/brand-assets/user-1/acme-sans.woff2",
            weight: [400, 700],
            style: "normal",
          },
        },
      },
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.package.assets?.fonts?.["acme-sans"]?.family,
    "Acme Sans",
  );
  assert.match(
    buildThemePackageFontFaceCss(result.package),
    /font-family: 'Acme Sans'; src: url\('\/brand-assets\/user-1\/acme-sans\.woff2'\)/,
  );

  const deck = buildDeck(
    [
      buildSlide("content", [
        buildTextNode({
          id: "custom-title",
          role: "title",
          style: { ref: "text.title" },
        }),
        buildTextNode({
          id: "custom-body",
          role: "body",
          style: { ref: "text.body" },
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
  const title = tree.slides[0]?.nodes.find(
    (node) => node.id === "custom-title",
  );
  const body = tree.slides[0]?.nodes.find((node) => node.id === "custom-body");
  assert.equal(title?.style.text?.fontFamily, sourceSerifStack);
  assert.equal(body?.style.text?.fontFamily, "Acme Sans");

  const pptx = buildPptxSpec(buildExportSpec(tree));
  const titleOp = pptx.slides[0]?.ops.find((op) => op.id === "custom-title");
  const bodyOp = pptx.slides[0]?.ops.find((op) => op.id === "custom-body");
  assert.equal(titleOp?.type, "text");
  assert.equal(bodyOp?.type, "text");
  if (titleOp?.type === "text")
    assert.equal(titleOp.textStyle.fontFace, "Georgia");
  if (bodyOp?.type === "text")
    assert.equal(bodyOp.textStyle.fontFace, "Acme Sans");
});

test("compileBrandKitDraft rejects typography roles referencing missing custom fonts", () => {
  const result = compileBrandKitDraft(
    buildValidBrandKitDraft({
      typography: {
        ...buildValidBrandKitDraft().typography,
        body: {
          ...buildValidBrandKitDraft().typography.body,
          family: "Missing Sans",
          fontAssetId: "missing-font",
        },
      },
    }),
  );

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "missing-font-asset" &&
        diagnostic.path === "typography.body.fontAssetId",
    ),
  );
});

test("compileBrandKitDraft reports malformed optional assets, scope, decorations, and typography", () => {
  const draft = buildValidBrandKitDraft({
    schemaVersion: 2 as 1,
    slug: "x",
    version: "1",
    scope: { kind: "workspace", ownerId: "owner" } as BrandKitDraftV1["scope"],
    revision: {
      id: "r",
      number: 0,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: 5 as unknown as string,
    },
    palette: {
      ...buildValidBrandKitDraft().palette,
      charts: ["#2563eb", 7 as unknown as string],
    },
    typography: {
      ...buildValidBrandKitDraft().typography,
      display: {
        family: "Inter",
        fontAssetId: "missing-font",
        sizePt: 120,
        weight: 1200,
        lineHeight: 3,
        letterSpacingEm: Number.NaN,
      },
    },
    assets: {
      logo: {
        id: "logo",
        src: "https://example.com/logo.bmp",
        mimeType: "image/bmp" as NonNullable<
          NonNullable<BrandKitDraftV1["assets"]>["logo"]
        >["mimeType"],
        widthPx: Number.NaN,
        heightPx: 10,
        alt: 7 as unknown as string,
      },
      fonts: {
        fontKey: {
          id: "other",
          family: "Inter",
          src: "https://example.com/font.woff2",
          weight: [400, Number.NaN],
          style: "oblique" as "italic",
          contentHash: 7 as unknown as string,
        },
      },
    },
    decorations: {
      background: "loud",
      chrome: "full",
    } as unknown as BrandKitDraftV1["decorations"],
  });

  const result = compileBrandKitDraft(draft);
  assert.equal(result.ok, false);
  const codes = new Set(
    result.diagnostics.map((diagnostic) => diagnostic.code),
  );
  for (const code of [
    "invalid-schema-version",
    "invalid-slug",
    "invalid-version",
    "missing-workspace",
    "invalid-revision",
    "invalid-color",
    "invalid-font-size",
    "invalid-font-weight",
    "invalid-line-height",
    "required-number",
    "invalid-string",
    "invalid-image-mime",
    "invalid-font-style",
    "font-id-mismatch",
    "invalid-decoration",
    "missing-font-asset",
  ]) {
    assert.equal(codes.has(code), true, `expected ${code}`);
  }
});

test("compileBrandKitDraft supports workspace drafts, font assets, and defaults", () => {
  const draft = buildValidBrandKitDraft({
    sourcePresetId: undefined,
    scope: {
      kind: "workspace",
      ownerId: "owner-1",
      workspaceId: "workspace-1",
    },
    typography: {
      ...buildValidBrandKitDraft().typography,
      heading: {
        ...buildValidBrandKitDraft().typography.heading,
        family: "font-1",
      },
      body: {
        ...buildValidBrandKitDraft().typography.body,
        fontAssetId: "font-1",
      },
    },
    assets: {
      fonts: {
        "font-1": {
          id: "font-1",
          family: "Acme Sans",
          src: "https://example.com/acme.woff2",
          weight: 400,
          style: "normal",
        },
      },
    },
    decorations: undefined,
  });

  const result = compileBrandKitDraft(draft);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.package.id, "brand-kit:workspace-workspace-1:acme-brand");
  assert.equal(result.package.tagline, "Custom brand kit");
  assert.equal(result.package.tokens.fonts.heading, "Acme Sans");
  assert.equal(result.package.tokens.fonts.body, "Acme Sans");
  assert.equal(result.package.chrome?.logo, undefined);
  assert.equal(result.package.assets?.fonts?.["font-1"]?.family, "Acme Sans");
});

test("compileBrandKitDraft rejects non-object input and missing nested objects", () => {
  const nonObject = compileBrandKitDraft("not a draft");
  assert.equal(nonObject.ok, false);
  assert.equal(nonObject.diagnostics[0]?.code, "required-object");

  const malformed = compileBrandKitDraft({
    ...buildValidBrandKitDraft(),
    scope: "bad",
    palette: { ...buildValidBrandKitDraft().palette, charts: "bad" },
    typography: { ...buildValidBrandKitDraft().typography, mono: null },
    assets: { logo: null, fonts: { bad: null } },
  });
  assert.equal(malformed.ok, false);
  assert.ok(
    malformed.diagnostics.some((diagnostic) => diagnostic.path === "scope"),
  );
  assert.ok(
    malformed.diagnostics.some(
      (diagnostic) => diagnostic.code === "missing-charts",
    ),
  );
});
