/**
 * Style registry, resolver, and theme package tests.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isStyleRef, STYLE_REFS } from "@/lib/presentation/style-registry";
import { validateThemePackage } from "@/lib/presentation/theme-package-schema";
import { resolveNodeStyle } from "@/lib/presentation/style-resolver";
import type { SemanticTemplateKind } from "@/lib/presentation/schema";
import {
  buildMinimalThemePackage,
  buildThemeBinding,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";

type ThemePackageOverrides = Parameters<typeof buildMinimalThemePackage>[1];

function invalidFixtureValue<T>(value: unknown): T {
  return value as unknown as T;
}

describe("style registry", () => {
  test("STYLE_REFS contains all documented refs", () => {
    assert.ok(
      STYLE_REFS.length >= 18,
      `Expected at least 18 refs, got ${STYLE_REFS.length}`,
    );
    assert.ok(STYLE_REFS.includes("text.title"));
    assert.ok(STYLE_REFS.includes("slide.cover"));
    assert.ok(STYLE_REFS.includes("surface.card"));
    assert.ok(STYLE_REFS.includes("decoration.background"));
  });

  test("isStyleRef accepts known refs", () => {
    assert.ok(isStyleRef("text.title"));
    assert.ok(isStyleRef("slide.cover"));
    assert.ok(isStyleRef("connector.primary"));
  });

  test("isStyleRef rejects unknown refs", () => {
    assert.ok(!isStyleRef("not.a.ref"));
    assert.ok(!isStyleRef(""));
    assert.ok(!isStyleRef(42));
    assert.ok(!isStyleRef(null));
  });
});

describe("validateThemePackage", () => {
  test("accepts a valid minimal package", () => {
    const pkg = buildMinimalThemePackage();
    const result = validateThemePackage(pkg);
    assert.ok(
      result.valid,
      `Expected valid but got: ${!result.valid && result.diagnostics.map((d) => d.message).join(", ")}`,
    );
  });

  test("rejects non-object input", () => {
    const result = validateThemePackage("not-a-package");
    assert.ok(!result.valid);
  });

  test("rejects wrong schemaVersion", () => {
    const pkg = { ...buildMinimalThemePackage(), schemaVersion: 2 };
    const result = validateThemePackage(pkg);
    assert.ok(!result.valid);
    if (!result.valid) {
      assert.ok(
        result.diagnostics.some((d) => d.code === "invalid-schema-version"),
      );
    }
  });

  test("rejects missing style ref", () => {
    const pkg = buildMinimalThemePackage();
    // Remove a required ref
    const { "text.title": _, ...stylesWithout } = pkg.styles;
    const badPkg = { ...pkg, styles: stylesWithout };
    const result = validateThemePackage(badPkg);
    assert.ok(!result.valid);
    if (!result.valid) {
      assert.ok(
        result.diagnostics.some(
          (d) =>
            d.code === "missing-style-default" &&
            d.message.includes("text.title"),
        ),
      );
    }
  });

  test("rejects missing default variant", () => {
    const pkg = buildMinimalThemePackage();
    const badPkg = {
      ...pkg,
      styles: {
        ...pkg.styles,
        "text.body": { elevated: { text: { fontSizePt: 16 } } }, // no "default"
      },
    };
    const result = validateThemePackage(badPkg);
    assert.ok(!result.valid);
    if (!result.valid) {
      assert.ok(
        result.diagnostics.some(
          (d) =>
            d.code === "missing-style-default" && d.message.includes("default"),
        ),
      );
    }
  });

  test("rejects missing token ref in style", () => {
    const pkg = buildMinimalThemePackage();
    const badPkg = {
      ...pkg,
      styles: {
        ...pkg.styles,
        "text.body": {
          default: {
            text: { color: { token: "colors.nonexistent.path" } },
          },
        },
      },
    };
    const result = validateThemePackage(badPkg);
    assert.ok(!result.valid);
    if (!result.valid) {
      assert.ok(result.diagnostics.some((d) => d.code === "missing-token"));
    }
  });

  test("rejects missing token ref inside gradient stop arrays", () => {
    const pkg = buildMinimalThemePackage();
    const badPkg = {
      ...pkg,
      styles: {
        ...pkg.styles,
        "surface.card": {
          default: {
            fill: {
              type: "linearGradient",
              from: "#111111",
              to: "#ffffff",
              stops: [
                { color: { token: "colors.accent.missing" }, offsetPct: 0 },
                { color: "#ffffff", offsetPct: 100 },
              ],
            },
          },
        },
      },
    };
    const result = validateThemePackage(badPkg);
    assert.ok(!result.valid);
    if (!result.valid) {
      assert.ok(
        result.diagnostics.some(
          (d) =>
            d.code === "missing-token" &&
            d.path === "styles.surface.card.default.fill.stops.0.color",
        ),
      );
    }
  });

  test("rejects invalid package deck chrome defaults", () => {
    const pkg = buildMinimalThemePackage(
      "bad-chrome-package",
      invalidFixtureValue<ThemePackageOverrides>({
        chrome: {
          footer: {
            enabled: true,
            text: "Footer",
            layout: { zIndex: 900 },
          },
        },
      }),
    );
    const result = validateThemePackage(pkg);
    assert.ok(!result.valid);
    if (!result.valid) {
      assert.ok(
        result.diagnostics.some((diagnostic) =>
          diagnostic.message.includes("layout.frame"),
        ),
      );
    }
  });

  test("rejects invalid package safe-area chrome insets", () => {
    const pkg = buildMinimalThemePackage(
      "bad-safe-area-package",
      invalidFixtureValue<ThemePackageOverrides>({
        chrome: {
          safeArea: {
            enabled: true,
            insets: { top: "bad", right: 5, bottom: 5, left: 5 },
          },
        },
      }),
    );
    const result = validateThemePackage(pkg);
    assert.ok(!result.valid);
    if (!result.valid) {
      assert.ok(
        result.diagnostics.some((diagnostic) =>
          diagnostic.message.includes("safeArea.insets.top"),
        ),
      );
    }
  });

  test("rejects malformed decoration recipe fields and enums", () => {
    const pkg = buildMinimalThemePackage(
      "bad-decoration-package",
      invalidFixtureValue<ThemePackageOverrides>({
        decorations: {
          invalidDecoration: {
            id: "wrong-id",
            component: "shape",
            role: "themeDecoration",
            layout: {
              frame: { x: 0, y: 0, w: -1, h: 25 },
              zIndex: invalidFixtureValue<number>("top"),
            },
            style: {
              blendMode: "invalid-mode",
            },
            content: { type: "image", assetId: "missing-image" },
            visibility: invalidFixtureValue<"subtle">("loud"),
            chrome: invalidFixtureValue<"default">("full"),
            appliesTo: {
              templateKinds: invalidFixtureValue<SemanticTemplateKind[]>([
                "cover",
                "unknown-template",
              ]),
            },
          },
        },
      }),
    );

    const result = validateThemePackage(pkg);
    assert.ok(!result.valid);
    if (!result.valid) {
      assert.ok(
        result.diagnostics.some((diagnostic) =>
          diagnostic.message.includes(
            'ThemePackage.decorations.invalidDecoration.id must match registry key "invalidDecoration"',
          ),
        ),
      );
      assert.ok(
        result.diagnostics.some((diagnostic) =>
          diagnostic.message.includes(
            "ThemePackage.decorations.invalidDecoration.layout.zIndex must be an integer",
          ),
        ),
      );
      assert.ok(
        result.diagnostics.some((diagnostic) =>
          diagnostic.message.includes(
            "ThemePackage.decorations.invalidDecoration.visibility must be one of: subtle, default, expressive",
          ),
        ),
      );
      assert.ok(
        result.diagnostics.some((diagnostic) =>
          diagnostic.message.includes(
            "ThemePackage.decorations.invalidDecoration.appliesTo.templateKinds.1 must be one of:",
          ),
        ),
      );
    }
  });

  test("rejects decoration image references missing package asset manifests", () => {
    const pkg = buildMinimalThemePackage("missing-decoration-assets", {
      decorations: {
        heroImage: {
          id: "heroImage",
          component: "image",
          role: "themeDecoration",
          layout: { frame: { x: 0, y: 0, w: 20, h: 20 }, zIndex: 0 },
          style: {},
          content: { type: "image", assetId: "theme-hero-image" },
        },
      },
    });

    const result = validateThemePackage(pkg);
    assert.ok(!result.valid);
    if (!result.valid) {
      assert.ok(
        result.diagnostics.some(
          (diagnostic) =>
            diagnostic.code === "missing-asset" &&
            diagnostic.path ===
              "ThemePackage.decorations.heroImage.content.assetId",
        ),
      );
    }
  });

  test("rejects malformed theme asset manifests", () => {
    const pkg = buildMinimalThemePackage(
      "bad-assets-package",
      invalidFixtureValue<ThemePackageOverrides>({
        assets: {
          images: {
            "theme-image": {
              id: "mismatch-image-id",
              src: "",
              widthPx: invalidFixtureValue<number>("wide"),
              mimeType: invalidFixtureValue<"image/png">("image/tiff"),
            },
          },
          fonts: {
            "brand-font": {
              id: "brand-font",
              family: "",
              src: invalidFixtureValue<string>(123),
              weight: invalidFixtureValue<number[]>(["bold"]),
              style: invalidFixtureValue<"normal">("oblique"),
            },
          },
        },
      }),
    );

    const result = validateThemePackage(pkg);
    assert.ok(!result.valid);
    if (!result.valid) {
      assert.ok(
        result.diagnostics.some((diagnostic) =>
          diagnostic.message.includes(
            'ThemePackage.assets.images.theme-image.id must match manifest key "theme-image"',
          ),
        ),
      );
      assert.ok(
        result.diagnostics.some((diagnostic) =>
          diagnostic.message.includes(
            "ThemePackage.assets.images.theme-image.widthPx must be a finite number",
          ),
        ),
      );
      assert.ok(
        result.diagnostics.some((diagnostic) =>
          diagnostic.message.includes(
            "ThemePackage.assets.fonts.brand-font.style must be one of: normal, italic",
          ),
        ),
      );
    }
  });

  test("accepts valid decoration image and asset manifests", () => {
    const pkg = buildMinimalThemePackage("valid-decoration-assets", {
      assets: {
        images: {
          "theme-hero-image": {
            id: "theme-hero-image",
            src: "https://example.com/hero.png",
            mimeType: "image/png",
            widthPx: 1200,
            heightPx: 800,
          },
        },
        fonts: {
          "brand-font": {
            id: "brand-font",
            family: "Inter",
            src: "/api/brand-assets/example/inter.woff2",
            weight: [400, 700],
            style: "normal",
          },
        },
      },
      decorations: {
        heroImage: {
          id: "heroImage",
          component: "image",
          role: "themeDecoration",
          layout: { frame: { x: 2, y: 2, w: 25, h: 25 }, zIndex: 1 },
          style: {
            opacity: 0.9,
            image: { fit: "cover", maskShape: "rounded" },
          },
          content: { type: "image", assetId: "theme-hero-image" },
          appliesTo: { templateKinds: ["cover"], layoutIds: ["layout-cover"] },
          visibility: "default",
          chrome: "default",
        },
      },
    });

    const result = validateThemePackage(pkg);
    assert.ok(
      result.valid,
      `Expected valid but got: ${!result.valid && result.diagnostics.map((diagnostic) => diagnostic.message).join(", ")}`,
    );
  });
});

describe("resolveNodeStyle", () => {
  test("resolves package default variant", () => {
    resetBuilderCounter();
    const pkg = buildMinimalThemePackage();
    const themeBinding = buildThemeBinding();
    const binding = { ref: "text.title" as const };
    const { style, diagnostics } = resolveNodeStyle(binding, themeBinding, pkg);
    assert.ok(style.text, "Expected text style");
    assert.equal(style.text?.fontSizePt, 36);
    assert.ok(!diagnostics.some((d) => d.severity === "error"));
  });

  test("resolves named variant when present", () => {
    resetBuilderCounter();
    const pkg = buildMinimalThemePackage();
    const themeBinding = buildThemeBinding();
    const binding = { ref: "text.title" as const, variant: "large" };
    const { style, diagnostics } = resolveNodeStyle(binding, themeBinding, pkg);
    assert.equal(style.text?.fontSizePt, 48);
    assert.ok(!diagnostics.some((d) => d.severity === "error"));
  });

  test("falls back to default when variant missing and emits warning", () => {
    resetBuilderCounter();
    const pkg = buildMinimalThemePackage();
    const themeBinding = buildThemeBinding();
    const binding = { ref: "text.title" as const, variant: "nonexistent" };
    const { style, diagnostics } = resolveNodeStyle(binding, themeBinding, pkg);
    assert.equal(style.text?.fontSizePt, 36); // default
    assert.ok(
      diagnostics.some((d) => d.code === "missing-style-variant"),
      "Expected missing-style-variant warning",
    );
  });

  test("applies local style override above theme", () => {
    resetBuilderCounter();
    const pkg = buildMinimalThemePackage();
    const themeBinding = buildThemeBinding();
    const binding = { ref: "text.title" as const };
    const localStyle = { text: { fontSizePt: 60, color: "#ff0000" } };
    const { style } = resolveNodeStyle(binding, themeBinding, pkg, localStyle);
    assert.equal(style.text?.fontSizePt, 60);
    assert.equal(style.text?.color, "#ff0000");
  });

  test("deep-merges nested connector stroke overrides without dropping dash", () => {
    resetBuilderCounter();
    const pkg = buildMinimalThemePackage();
    pkg.styles["connector.primary"] = {
      default: {
        connector: {
          stroke: { color: "#334155", widthPt: 1.5, dash: "dotted" },
        },
      },
    };
    const themeBinding = buildThemeBinding();
    const binding = { ref: "connector.primary" as const };
    const localStyle = {
      connector: { stroke: { color: "#ef4444", widthPt: 2 } },
    };
    const { style } = resolveNodeStyle(binding, themeBinding, pkg, localStyle);

    assert.equal(style.connector?.stroke?.color, "#ef4444");
    assert.equal(style.connector?.stroke?.widthPt, 2);
    assert.equal(style.connector?.stroke?.dash, "dotted");
  });

  test("deep-merges visual channel colors without dropping sibling channels", () => {
    resetBuilderCounter();
    const pkg = buildMinimalThemePackage();
    pkg.styles["chart.primary"] = {
      default: {
        visual: {
          channelColors: {
            primary: "#2563eb",
            secondary: "#f59e0b",
            tertiary: "#10b981",
          },
        },
      },
    };
    const themeBinding = buildThemeBinding();
    const binding = { ref: "chart.primary" as const };
    const localStyle = { visual: { channelColors: { primary: "#7c3aed" } } };
    const { style } = resolveNodeStyle(binding, themeBinding, pkg, localStyle);

    assert.deepEqual(style.visual?.channelColors, {
      primary: "#7c3aed",
      secondary: "#f59e0b",
      tertiary: "#10b981",
    });
  });

  test("preserves visual channel color overrides", () => {
    resetBuilderCounter();
    const pkg = buildMinimalThemePackage();
    const themeBinding = buildThemeBinding();
    const binding = { ref: "chart.primary" as const };
    const localStyle = {
      visual: { channelColors: { primary: "#2563eb", accent: "#f59e0b" } },
    };
    const { style } = resolveNodeStyle(binding, themeBinding, pkg, localStyle);
    assert.deepEqual(style.visual?.channelColors, {
      primary: "#2563eb",
      accent: "#f59e0b",
    });
  });

  test("emits local-style-overrides info diagnostic", () => {
    resetBuilderCounter();
    const pkg = buildMinimalThemePackage();
    const themeBinding = buildThemeBinding();
    const binding = { ref: "text.body" as const };
    const localStyle = { text: { italic: true } };
    const { diagnostics } = resolveNodeStyle(
      binding,
      themeBinding,
      pkg,
      localStyle,
    );
    assert.ok(
      diagnostics.some((d) => d.code === "local-style-overrides"),
      "Expected local-style-overrides info diagnostic",
    );
  });

  test("errors on unknown style ref", () => {
    resetBuilderCounter();
    const pkg = buildMinimalThemePackage();
    const themeBinding = buildThemeBinding();
    // Force an invalid ref via type cast
    const binding = { ref: "not.real" as "text.title" };
    const { diagnostics } = resolveNodeStyle(binding, themeBinding, pkg);
    assert.ok(
      diagnostics.some((d) => d.code === "unknown-style-ref"),
      "Expected unknown-style-ref error",
    );
    assert.ok(
      diagnostics.some(
        (d) =>
          d.code === "unknown-style-ref" &&
          d.action?.type === "replace-style-ref",
      ),
      "Expected unknown-style-ref repair action",
    );
  });

  test("errors when a style ref exists without a default variant", () => {
    resetBuilderCounter();
    const pkg = buildMinimalThemePackage();
    const themeBinding = buildThemeBinding();
    const { style, diagnostics } = resolveNodeStyle(
      { ref: "text.body" },
      themeBinding,
      {
        ...pkg,
        styles: {
          ...pkg.styles,
          "text.body": { compact: { text: { fontSizePt: 13 } } },
        },
      },
    );

    assert.deepEqual(style, {});
    assert.ok(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "missing-style-default" &&
          diagnostic.action?.type === "replace-style-ref",
      ),
    );
  });

  test("applies deck-level token overrides to resolved theme", async () => {
    resetBuilderCounter();
    const pkg = buildMinimalThemePackage();
    const themeBinding = buildThemeBinding({
      overrides: {
        tokens: {
          colors: {
            canvas: { fill: "#000000", text: "#ffffff", mutedText: "#aaaaaa" },
          },
        },
      },
    });
    // resolveTheme should merge token overrides
    const { resolveTheme } = await import("@/lib/presentation/style-resolver");
    const resolved = resolveTheme(pkg, themeBinding);
    assert.equal(resolved.tokens.colors.canvas.fill, "#000000");
    assert.equal(resolved.tokens.colors.canvas.text, "#ffffff");
    // surface tokens unchanged
    assert.equal(resolved.tokens.colors.surface.fill, "#f5f5f5");
  });

  test("applies deck-level style overrides to resolved style", () => {
    resetBuilderCounter();
    const pkg = buildMinimalThemePackage();
    const themeBinding = buildThemeBinding({
      overrides: {
        styles: {
          "text.title": {
            default: {
              text: { fontSizePt: 99, color: "#ff0000" },
            },
          },
        },
      },
    });
    const binding = { ref: "text.title" as const };
    const { style } = resolveNodeStyle(binding, themeBinding, pkg);
    assert.equal(style.text?.fontSizePt, 99);
    assert.equal(style.text?.color, "#ff0000");
  });

  test("resolves package style token refs using deck token overrides", () => {
    resetBuilderCounter();
    const pkg = buildMinimalThemePackage();
    pkg.styles["text.title"] = {
      default: {
        text: { fontSizePt: 36, color: { token: "colors.accent.fill" } },
      },
    };
    const themeBinding = buildThemeBinding({
      overrides: {
        tokens: {
          colors: {
            accent: { fill: "#ff00ff" },
          },
        },
      },
    });

    const { style, diagnostics } = resolveNodeStyle(
      { ref: "text.title" },
      themeBinding,
      pkg,
    );

    assert.equal(style.text?.color, "#ff00ff");
    assert.ok(!diagnostics.some((d) => d.code === "missing-token"));
  });

  test("resolves deck style override token refs using deck token overrides", () => {
    resetBuilderCounter();
    const pkg = buildMinimalThemePackage();
    const themeBinding = buildThemeBinding({
      overrides: {
        tokens: {
          colors: {
            accent: { fill: "#ff00ff" },
          },
        },
        styles: {
          "text.title": {
            default: {
              text: { color: { token: "colors.accent.fill" } },
            },
          },
        },
      },
    });

    const { style, diagnostics } = resolveNodeStyle(
      { ref: "text.title" },
      themeBinding,
      pkg,
    );

    assert.equal(style.text?.color, "#ff00ff");
    assert.ok(!diagnostics.some((d) => d.code === "missing-token"));
  });

  test("applies deck-level variant override on top of default", () => {
    resetBuilderCounter();
    const pkg = buildMinimalThemePackage();
    const themeBinding = buildThemeBinding({
      overrides: {
        styles: {
          "text.title": {
            default: { text: { fontSizePt: 50 } },
            large: { text: { fontSizePt: 72 } },
          },
        },
      },
    });
    const binding = { ref: "text.title" as const, variant: "large" };
    const { style } = resolveNodeStyle(binding, themeBinding, pkg);
    assert.equal(style.text?.fontSizePt, 72);
  });

  test("errors on missing-token when token path resolves to non-string", () => {
    resetBuilderCounter();
    const pkg = buildMinimalThemePackage("missing-token-pkg", {
      styles: {
        ...buildMinimalThemePackage().styles,
        "text.body": {
          default: {
            text: {
              // token that resolves to an object, not a string
              color: { token: "colors" }, // "colors" resolves to the whole colors object
            },
          },
        },
      },
    });
    const themeBinding = buildThemeBinding();
    const binding = { ref: "text.body" as const };
    const { diagnostics } = resolveNodeStyle(binding, themeBinding, pkg);
    assert.ok(
      diagnostics.some((d) => d.code === "missing-token"),
      "Expected missing-token diagnostic for non-scalar token",
    );
  });

  test("resolves token refs inside gradient stop arrays", () => {
    resetBuilderCounter();
    const pkg = buildMinimalThemePackage("gradient-stop-token-pkg", {
      styles: {
        ...buildMinimalThemePackage().styles,
        "surface.card": {
          default: {
            fill: {
              type: "linearGradient",
              from: "#111111",
              to: "#ffffff",
              stops: [
                { color: { token: "colors.accent.fill" }, offsetPct: 0 },
                { color: { token: "colors.accent.text" }, offsetPct: 100 },
              ],
            },
          },
        },
      },
    });
    const themeBinding = buildThemeBinding();
    const { style, diagnostics } = resolveNodeStyle(
      { ref: "surface.card" },
      themeBinding,
      pkg,
    );

    assert.deepEqual((style.fill as { stops?: unknown[] })?.stops, [
      { color: "#0066cc", offsetPct: 0 },
      { color: "#ffffff", offsetPct: 100 },
    ]);
    assert.ok(!diagnostics.some((d) => d.code === "missing-token"));
  });
});
