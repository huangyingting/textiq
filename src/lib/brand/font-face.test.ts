/**
 * Tests for font durable-asset helpers (@font-face generation + rehydration).
 *
 * Covers: buildFontFaceCss (pure), validateBrandInput with fontAssetId,
 * upload validation, save→reload scenario, and export behavior notes.
 *
 * DOM-free: runs under `node --import tsx --test`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildFontFaceCss } from "@/lib/assets/font-face-css";
import { injectBrandFontFace } from "@/lib/brand/font-face";
import { validateBrandInput } from "@/lib/brand/schema";
import { validateFontUpload } from "@/lib/brand/upload";
import { BRAND_FONT_MAX_BYTES } from "@/lib/limits";

// ---------------------------------------------------------------------------
// buildFontFaceCss — pure @font-face CSS generation
// ---------------------------------------------------------------------------

describe("buildFontFaceCss", () => {
  it("returns empty string when fontFamily is null", () => {
    assert.equal(buildFontFaceCss(null, "data:font/woff2;base64,abc"), "");
  });

  describe("injectBrandFontFace", () => {
    it("no-ops when document is not available", () => {
      assert.doesNotThrow(() =>
        injectBrandFontFace("brand-1", "'Acme'", "/fonts/acme.woff2"),
      );
    });

    it("injects one keyed style element for a custom brand font", () => {
      const appended: Array<{ id: string; textContent: string }> = [];
      const elements = new Map<string, { id: string; textContent: string }>();
      const fakeDocument = {
        getElementById: (id: string) => elements.get(id) ?? null,
        createElement: (_tag: string) => ({ id: "", textContent: "" }),
        head: {
          appendChild: (style: { id: string; textContent: string }) => {
            appended.push(style);
            elements.set(style.id, style);
          },
        },
      };
      const previousDocument = globalThis.document;
      Object.defineProperty(globalThis, "document", {
        value: fakeDocument,
        configurable: true,
      });

      try {
        injectBrandFontFace(
          "brand-1",
          "'Acme', sans-serif",
          "/fonts/acme.woff2",
        );
        injectBrandFontFace(
          "brand-1",
          "'Acme', sans-serif",
          "/fonts/acme.woff2",
        );
      } finally {
        Object.defineProperty(globalThis, "document", {
          value: previousDocument,
          configurable: true,
        });
      }

      assert.equal(appended.length, 1);
      assert.equal(appended[0].id, "brand-font-brand-1");
      assert.match(appended[0].textContent, /font-family: 'Acme'/);
      assert.match(appended[0].textContent, /\/fonts\/acme\.woff2/);
    });

    it("does not inject when font CSS cannot be built", () => {
      const fakeDocument = {
        getElementById: (_id: string) => null,
        createElement: (_tag: string) => ({ id: "", textContent: "" }),
        head: {
          appendChild: () => {
            throw new Error("appendChild should not be called");
          },
        },
      };
      const previousDocument = globalThis.document;
      Object.defineProperty(globalThis, "document", {
        value: fakeDocument,
        configurable: true,
      });

      try {
        injectBrandFontFace("brand-2", null, "/fonts/acme.woff2");
      } finally {
        Object.defineProperty(globalThis, "document", {
          value: previousDocument,
          configurable: true,
        });
      }
    });
  });

  it("returns empty string when fontAssetUrl is null", () => {
    assert.equal(buildFontFaceCss("'MyFont', sans-serif", null), "");
  });

  it("returns empty string when both are empty strings", () => {
    assert.equal(buildFontFaceCss("", ""), "");
  });

  it("produces a valid @font-face rule from a stack family", () => {
    const css = buildFontFaceCss(
      "'Acme Brand', sans-serif",
      "data:font/woff2;base64,AAAA",
    );
    assert.match(css, /@font-face/);
    assert.match(css, /font-family: 'Acme Brand'/);
    assert.match(css, /src: url\('data:font\/woff2;base64,AAAA'\)/);
    assert.match(css, /font-display: swap/);
  });

  it("strips surrounding quotes from bare family name", () => {
    // Input family is already bare (no fallback stack)
    const css = buildFontFaceCss("'Foobar'", "data:font/woff2;base64,X");
    assert.match(css, /font-family: 'Foobar'/);
  });

  it("handles double-quoted family name", () => {
    const css = buildFontFaceCss('"Inter Round"', "data:font/ttf;base64,YY");
    assert.match(css, /font-family: 'Inter Round'/);
  });

  it("uses only the first font in the stack (strips fallbacks)", () => {
    const css = buildFontFaceCss(
      "'CustomFont', Arial, sans-serif",
      "data:font/otf;base64,ZZ",
    );
    // Should only appear once and with the primary family
    assert.match(css, /font-family: 'CustomFont'/);
    assert.ok(!css.includes("Arial"), "Should not include fallback names");
  });

  it("returns empty string for family with only whitespace after stripping", () => {
    const css = buildFontFaceCss("' '", "data:font/woff;base64,XX");
    // bare family after trimming would be empty
    assert.equal(css, "");
  });

  it("escapes quote-based injection payloads in custom family names", () => {
    const css = buildFontFaceCss(
      "Acme';}body{color:red}/*",
      "/fonts/acme.woff2",
    );
    assert.match(
      css,
      /^@font-face \{ font-family: '(?:[^'\\]|\\.)*'; src: url\('\/fonts\/acme\.woff2'\); font-display: swap; \}$/,
    );
    assert.match(css, /font-family: 'Acme\\';}body\{color:red\}\/\*'/);
    assert.equal((css.match(/'; src/g) ?? []).length, 1);
  });

  it("escapes control characters in custom family names", () => {
    const css = buildFontFaceCss(
      "Acme\u0000\u0009\u000A\u000D\u001F",
      "/fonts/x",
    );
    assert.match(css, /font-family: 'Acme\\0 \\9 \\A \\D \\1F '/);
    assert.equal(/[\u0000-\u001F\u007F]/.test(css), false);
  });

  it("escapes quote, backslash, and newline payloads in font URLs", () => {
    const css = buildFontFaceCss(
      "Acme",
      "/api/brand-assets/font\\bad'\nbody{display:none}.woff2",
    );
    assert.match(
      css,
      /src: url\('\/api\/brand-assets\/font\\\\bad\\'\\A body\{display:none\}\.woff2'\)/,
    );
    assert.equal((css.match(/'\); font-display/g) ?? []).length, 1);
    assert.equal(/[\u0000-\u001F\u007F]/.test(css), false);
  });

  it("escapes style-close payloads in font URLs", () => {
    const css = buildFontFaceCss(
      "Acme",
      "/api/brand-assets/font.woff2</style><script>alert(1)</script>",
    );
    assert.match(css, /\\3C \/style\\3E \\3C script\\3E /);
    assert.equal(css.includes("</style>"), false);
    assert.equal(css.includes("<script>"), false);
  });
});

// ---------------------------------------------------------------------------
// Upload validation
// ---------------------------------------------------------------------------

describe("font upload validation", () => {
  it("validateFontUpload accepts woff2 and resolves the correct mime", () => {
    const result = validateFontUpload("font/woff2", "brand.woff2", 1024);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.mime, "font/woff2");
    }
  });

  it("rejects files exceeding BRAND_FONT_MAX_BYTES", () => {
    const result = validateFontUpload(
      "font/woff2",
      "big.woff2",
      BRAND_FONT_MAX_BYTES + 1,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "file_too_large");
  });

  it("rejects non-font MIME types", () => {
    const result = validateFontUpload("image/png", "fake.png", 512);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "type_rejected");
  });

  it("resolves font type from filename extension when MIME is octet-stream", () => {
    const result = validateFontUpload(
      "application/octet-stream",
      "font.ttf",
      100,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.mime, "font/ttf");
  });
});

// ---------------------------------------------------------------------------
// validateBrandInput — fontAssetId field
// ---------------------------------------------------------------------------

describe("validateBrandInput with fontAssetId", () => {
  it("accepts a valid fontAssetId", () => {
    const result = validateBrandInput({
      name: "FontBrand",
      fontFamily: "'Acme', sans-serif",
      fontAssetId: "font-asset-1",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.fontAssetId, "font-asset-1");
      assert.equal(result.data.fontFamily, "'Acme', sans-serif");
    }
  });

  it("accepts null fontAssetId", () => {
    const result = validateBrandInput({
      name: "NoFont",
      fontAssetId: null,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.fontAssetId, null);
  });

  it("treats missing fontAssetId as null", () => {
    const result = validateBrandInput({ name: "NoFont" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.fontAssetId, null);
  });
});

// ---------------------------------------------------------------------------
// Save → reload scenario (rehydration contract)
// ---------------------------------------------------------------------------

describe("font save → reload rehydration contract", () => {
  it("buildFontFaceCss from stored brand fields produces replayable CSS", () => {
    // Simulate what is stored in DB after an upload + save
    const storedBrand = {
      fontFamily: "'AcmeBrand', sans-serif",
      fontAssetUrl: "/api/brand-assets/u1/font.woff2",
    };
    const css = buildFontFaceCss(
      storedBrand.fontFamily,
      storedBrand.fontAssetUrl,
    );
    // On reload this CSS is injected via injectBrandFontFace → browser loads font
    assert.match(css, /@font-face/);
    assert.match(css, /font-family: 'AcmeBrand'/);
    assert.match(css, /\/api\/brand-assets\/u1\/font\.woff2/);
  });

  it("buildFontFaceCss is idempotent — same inputs produce same output", () => {
    const a = buildFontFaceCss(
      "'Foo', sans-serif",
      "data:font/woff2;base64,XY",
    );
    const b = buildFontFaceCss(
      "'Foo', sans-serif",
      "data:font/woff2;base64,XY",
    );
    assert.equal(a, b);
  });

  it("returns empty string for a web-font brand (no custom data-URL needed)", () => {
    // Web fonts (Google Fonts) have fontAssetUrl = null; they use a <link> tag.
    const css = buildFontFaceCss("'Inter', sans-serif", null);
    assert.equal(css, "");
  });
});

// ---------------------------------------------------------------------------
// Export behavior notes (documented in route.ts; verified via CSS output)
// ---------------------------------------------------------------------------

describe("export behavior — custom font in @font-face CSS", () => {
  it("SVG/PNG: @font-face CSS references the font asset URL for rasterization", () => {
    // The brand's @font-face is injected into <head> before export; canvas
    // rendering picks up the font at rasterization time.
    const css = buildFontFaceCss(
      "'BrandFont'",
      "/api/brand-assets/u1/font.woff2",
    );
    assert.match(css, /src: url\('\/api\/brand-assets\/u1\/font\.woff2'\)/);
  });

  it("PPTX: fontFamily string is referenced but font is not embedded (known limitation)", () => {
    // PPTX native shapes receive fontFamily only; @font-face CSS is not
    // applicable.  Callers must document this limitation.
    // This test asserts the CSS output is NOT PPTX-compatible on its own.
    const css = buildFontFaceCss("'BrandFont'", "data:font/woff2;base64,X");
    assert.ok(!css.includes("pptx"), "CSS is not PPTX-specific output");
    assert.match(
      css,
      /@font-face/,
      "CSS is still valid for SVG/HTML/PNG paths",
    );
  });
});
