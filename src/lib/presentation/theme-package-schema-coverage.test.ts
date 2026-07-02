import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { validateThemePackage } from "@/lib/presentation/theme-package-schema";
import { buildMinimalThemePackage } from "@/test/builders/presentation-deck";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";

function diagnosticMessages(result: ReturnType<typeof validateThemePackage>) {
  return result.valid
    ? []
    : result.diagnostics.map((diagnostic) => diagnostic.message);
}

function assertDiagnostic(
  result: ReturnType<typeof validateThemePackage>,
  pattern: RegExp,
): void {
  const messages = diagnosticMessages(result);
  assert.ok(
    messages.some((message) => pattern.test(message)),
    `Expected diagnostic matching ${pattern}, got:\n${messages.join("\n")}`,
  );
}

describe("validateThemePackage coverage branches", () => {
  test("accepts decorations, chrome, and asset manifests that exercise optional schema branches", () => {
    const pkg = buildMinimalThemePackage("coverage-theme", {
      tagline: "Coverage package",
      assets: {
        images: {
          "decor-image": {
            id: "decor-image",
            src: "https://example.com/decor.png",
            alt: "Decor",
            widthPx: 320,
            heightPx: 200,
            mimeType: "image/png",
            contentHash: "decor-hash",
          },
        },
        fonts: {
          "decor-font": {
            id: "decor-font",
            family: "Inter",
            src: "https://example.com/inter.woff2",
            weight: [400, 700],
            style: "italic",
            contentHash: "font-hash",
          },
        },
      },
      decorations: {
        "shape-decor": {
          id: "shape-decor",
          component: "shape",
          role: "themeDecoration",
          layout: {
            frame: { x: 0, y: 0, w: 100, h: 10 },
            zIndex: 0,
            rotation: 2,
            autoHeight: false,
            flipX: false,
            flipY: true,
            anchor: "center",
            constraints: { minW: 10, maxW: 100, preserveAspectRatio: false },
          },
          style: {
            opacity: 0.5,
            blendMode: "screen",
            fill: {
              type: "image",
              assetId: "decor-image",
              opacity: 0.8,
            },
            image: { fit: "cover", maskShape: "rounded" },
            connector: {
              startArrow: "none",
              endArrow: "filled",
              routing: "curved",
            },
            slide: { chrome: "minimal", decoration: "subtle" },
            effect: { kind: "glass", intensity: "strong" },
          },
          content: { type: "shape", shape: "rect" },
          appliesTo: {
            templateKinds: ["cover", "content"],
            layoutIds: ["hero"],
          },
          visibility: "expressive",
          chrome: "minimal",
        },
        "image-decor": {
          id: "image-decor",
          component: "image",
          role: "themeDecoration",
          layout: {
            frame: { x: 80, y: 5, w: 10, h: 10 },
            zIndex: 1,
            anchor: "topLeft",
          },
          style: { fill: { type: "pattern", kind: "dots", color: "#eeeeee" } },
          content: { type: "image", assetId: "decor-image" },
          visibility: "subtle",
          chrome: "default",
        },
        "text-decor": {
          id: "text-decor",
          component: "text",
          role: "themeDecoration",
          layout: {
            frame: { x: 5, y: 90, w: 90, h: 5 },
            zIndex: 2,
          },
          style: {
            fill: { type: "solid", color: { token: "colors.accent.fill" } },
          },
          content: { type: "text", text: "Confidential" },
        },
      },
      chrome: {
        logo: {
          enabled: true,
          assetId: "decor-image",
          alt: "Logo",
          placement: "top-right",
          size: "large",
          layer: "foreground",
          layout: { frame: { x: 1, y: 1, w: 10, h: 8 }, zIndex: 10 },
        },
        footer: { enabled: true, text: "Footer", align: "center" },
        pageNumber: {
          enabled: true,
          format: "number-total",
          placement: "bottom-right",
        },
        watermark: {
          enabled: true,
          text: "Draft",
          opacity: 0.2,
          layoutMode: "diagonal",
          size: "small",
        },
        border: { enabled: true, color: "#111111", widthPt: 1 },
        safeArea: {
          enabled: true,
          insets: { top: 4, right: 4, bottom: 4, left: 4 },
          color: "#cccccc",
          widthPt: 0.5,
        },
      },
    });

    const result = validateThemePackage(pkg);

    assert.equal(result.valid, true);
    if (result.valid) {
      assert.equal(result.package.id, "coverage-theme");
    }
  });

  test("reports invalid package, asset, decoration, style-token, and chrome branches", () => {
    const base = buildMinimalThemePackage("bad-theme");
    const pkg = {
      ...base,
      unexpectedTopLevel: true,
      id: "",
      version: "",
      tokens: {
        colors: null,
        fonts: null,
      },
      styles: {
        ...base.styles,
        "text.body": {
          default: {
            text: { color: { token: "colors.missing" } },
          },
        },
        "text.title": { default: "not checked by schema but traversed" },
      },
      assets: {
        unexpected: true,
        images: {
          "decor-image": {
            id: "different",
            src: "",
            alt: 7,
            widthPx: "wide",
            heightPx: Number.NaN,
            mimeType: "image/bmp",
            contentHash: false,
            extra: true,
          },
          "bad-image": 3,
        },
        fonts: {
          "font-bad": {
            id: "",
            family: "",
            src: "",
            weight: ["bold"],
            style: "oblique",
            contentHash: 12,
            extra: true,
          },
          "font-object": false,
        },
      },
      decorations: {
        broken: {
          id: "mismatch",
          component: "video",
          role: "background",
          layout: {
            frame: { x: "left", y: 0, w: 0, h: -1 },
            zIndex: 1.5,
            rotation: "90",
            autoHeight: "no",
            flipX: "no",
            flipY: "yes",
            anchor: "middle",
            constraints: {
              minW: "small",
              preserveAspectRatio: "yes",
              extra: true,
            },
            extra: true,
          },
          style: {
            unknown: true,
            opacity: "full",
            blendMode: "difference",
            fill: { type: "pattern", kind: "bricks" },
            image: { fit: "stretch", maskShape: "blob" },
            connector: {
              startArrow: "triangle",
              endArrow: "diamond",
              routing: "around",
            },
            slide: { chrome: "full", decoration: "loud" },
            effect: { kind: "glass", intensity: "ultra" },
          },
          content: { type: "image", assetId: "missing-image", extra: true },
          appliesTo: {
            templateKinds: ["not-a-template"],
            layoutIds: [42],
            extra: true,
          },
          visibility: "loud",
          chrome: "full",
          extra: true,
        },
        "content-required": {
          id: "content-required",
          component: "text",
          role: "themeDecoration",
          layout: { frame: { x: 1, y: 1, w: 1, h: 1 }, zIndex: 1 },
          style: {},
        },
        "content-mismatch": {
          id: "content-mismatch",
          component: "shape",
          role: "themeDecoration",
          layout: { frame: { x: 1, y: 1, w: 1, h: 1 }, zIndex: 1 },
          style: {},
          content: { type: "text", text: "" },
        },
        primitive: 7,
      },
      chrome: {
        unknown: {},
        logo: {
          enabled: "yes",
          layer: "middle",
          layout: { frame: { x: 1, y: "top", w: 1 }, zIndex: 1.2 },
          assetId: 1,
          alt: 2,
          placement: "center",
          size: "huge",
          extra: true,
        },
        footer: { text: 1, align: "justify" },
        pageNumber: { format: "roman", placement: "top" },
        watermark: {
          text: 1,
          opacity: "faint",
          layoutMode: "tilted",
          size: "huge",
        },
        border: { color: 1, widthPt: "thick" },
        safeArea: {
          insets: { top: 1, right: "bad" },
          color: 1,
          widthPt: "wide",
        },
      },
    } satisfies Record<string, unknown>;

    const result = validateThemePackage(pkg);

    assert.equal(result.valid, false);
    assertDiagnostic(result, /ThemePackage\.unexpectedTopLevel/);
    assertDiagnostic(result, /Theme package id must be a non-empty string/);
    assertDiagnostic(result, /tokens\.colors must be an object/);
    assertDiagnostic(
      result,
      /Style "text.body\/default" references unknown token/,
    );
    assertDiagnostic(result, /ThemePackage\.assets\.images\.decor-image\.id/);
    assertDiagnostic(
      result,
      /ThemePackage\.decorations\.broken\.id must match/,
    );
    assertDiagnostic(result, /style\.fill\.kind must be one of/);
    assertDiagnostic(result, /content is required when component is "text"/);
    assertDiagnostic(result, /content\.type must match component "shape"/);
    assertDiagnostic(result, /references missing image asset "missing-image"/);
    assertDiagnostic(result, /ThemePackage\.chrome\.logo\.placement/);
    assertDiagnostic(result, /ThemePackage\.chrome\.safeArea\.insets\.right/);
  });

  test("returns fatal diagnostics for non-object packages and schema-version mismatches", () => {
    const nonObject = validateThemePackage("not a package");
    const wrongSchema = validateThemePackage({
      schemaVersion: 2,
    });

    assert.equal(nonObject.valid, false);
    assertDiagnostic(nonObject, /Theme package must be an object/);
    assert.equal(wrongSchema.valid, false);
    assertDiagnostic(wrongSchema, /schemaVersion must be 1/);
  });

  test("diagnoses whole-manifest shape failures", () => {
    const pkg = buildMinimalThemePackage("manifest-shapes", {
      assets: "not an object" as unknown as ThemePackageV1["assets"],
      decorations: [] as unknown as ThemePackageV1["decorations"],
      chrome: "not an object" as unknown as ThemePackageV1["chrome"],
    });

    const result = validateThemePackage(pkg);

    assert.equal(result.valid, false);
    assertDiagnostic(result, /ThemePackage\.assets must be an object/);
    assertDiagnostic(result, /ThemePackage\.decorations must be an object/);
    assertDiagnostic(result, /ThemePackage\.chrome must be an object/);
  });
});
