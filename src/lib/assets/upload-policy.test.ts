import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalizeAssetMime,
  buildAssetPolicyMeta,
  formatAssetUploadPolicyError,
  imageDimensionsFromBytes,
  sniffAssetMime,
  validateAssetDimensionsPolicy,
  validateAssetMagicBytes,
  validateAssetUploadPolicy,
} from "@/lib/assets/upload-policy";
import {
  BRAND_FONT_UPLOAD_POLICY,
  BRAND_LOGO_UPLOAD_POLICY,
} from "@/lib/brand/asset-policy";
import { SLIDE_ASSET_UPLOAD_POLICY } from "@/lib/slides/asset-policy";

function createGifBytes(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0x47,
    0x49,
    0x46,
    0x38,
    0x39,
    0x61,
    width & 0xff,
    (width >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
    0x00,
    0x00,
    0x00,
  ]);
}

function createWebpVp8XBytes(width: number, height: number): Uint8Array {
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  return new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46,
    22,
    0x00,
    0x00,
    0x00,
    0x57,
    0x45,
    0x42,
    0x50,
    0x56,
    0x50,
    0x38,
    0x58,
    10,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    widthMinusOne & 0xff,
    (widthMinusOne >> 8) & 0xff,
    (widthMinusOne >> 16) & 0xff,
    heightMinusOne & 0xff,
    (heightMinusOne >> 8) & 0xff,
    (heightMinusOne >> 16) & 0xff,
  ]);
}

function createWebpVp8LBytes(width: number, height: number): Uint8Array {
  const bits = (width - 1) | ((height - 1) << 14);
  return new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46,
    17,
    0x00,
    0x00,
    0x00,
    0x57,
    0x45,
    0x42,
    0x50,
    0x56,
    0x50,
    0x38,
    0x4c,
    5,
    0x00,
    0x00,
    0x00,
    0x2f,
    bits & 0xff,
    (bits >> 8) & 0xff,
    (bits >> 16) & 0xff,
    (bits >> 24) & 0xff,
  ]);
}

describe("asset upload policy validation", () => {
  it("keeps slide SVG rejected while accepting declared raster types", () => {
    const png = validateAssetUploadPolicy(
      SLIDE_ASSET_UPLOAD_POLICY,
      "image/png",
      "slide.png",
      1024,
    );
    assert.equal(png.ok, true);

    const svg = validateAssetUploadPolicy(
      SLIDE_ASSET_UPLOAD_POLICY,
      "image/svg+xml",
      "slide.svg",
      1024,
    );
    assert.equal(svg.ok, false);
    if (!svg.ok) assert.equal(svg.error.code, "type_rejected");
  });

  it("rejects brand logo SVG by policy", () => {
    const svg = validateAssetUploadPolicy(
      BRAND_LOGO_UPLOAD_POLICY,
      "image/svg+xml",
      "logo.svg",
      1024,
    );
    assert.equal(svg.ok, false);
    if (!svg.ok) assert.equal(svg.error.code, "type_rejected");
  });

  it("uses the shared file-too-large and dimension error formatting", () => {
    const tooLarge = validateAssetUploadPolicy(
      SLIDE_ASSET_UPLOAD_POLICY,
      "image/png",
      "big.png",
      SLIDE_ASSET_UPLOAD_POLICY.maxBytes + 1,
    );
    assert.equal(tooLarge.ok, false);
    if (!tooLarge.ok) {
      assert.equal(tooLarge.error.code, "file_too_large");
      assert.match(formatAssetUploadPolicyError(tooLarge.error), /10 MB/);
    }

    const dimensions = validateAssetDimensionsPolicy(
      SLIDE_ASSET_UPLOAD_POLICY,
      SLIDE_ASSET_UPLOAD_POLICY.dimensions!.maxPx + 1,
      undefined,
    );
    assert.equal(dimensions.ok, false);
    if (!dimensions.ok) {
      assert.equal(dimensions.error.code, "dimension_exceeded");
    }
  });

  it("builds metadata from a policy after checksum validation", () => {
    const result = buildAssetPolicyMeta({
      policy: SLIDE_ASSET_UPLOAD_POLICY,
      type: "application/octet-stream",
      name: "photo.webp",
      size: 512,
      checksum: "abc123",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.meta.mimeType, "image/webp");
      assert.equal(result.meta.originalName, "photo.webp");
    }
  });

  it("validates raster/font magic bytes and extracts PNG dimensions", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x48,
      0x44, 0x52, 0, 0, 0x01, 0x00, 0, 0, 0x02, 0x00,
    ]);
    assert.deepEqual(validateAssetMagicBytes("image/png", png), { ok: true });
    assert.deepEqual(imageDimensionsFromBytes("image/png", png), {
      widthPx: 256,
      heightPx: 512,
    });

    assert.deepEqual(
      validateAssetMagicBytes("font/woff2", Buffer.from("wOF2")),
      {
        ok: true,
      },
    );
    const bad = validateAssetMagicBytes("image/png", Buffer.from("not-png"));
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.equal(bad.error.code, "signature_mismatch");
      assert.match(formatAssetUploadPolicyError(bad.error), /contents/);
    }

    const svg = validateAssetMagicBytes(
      "image/svg+xml",
      Buffer.from("<svg></svg>"),
    );
    assert.equal(svg.ok, false);
    if (!svg.ok) assert.equal(svg.error.code, "signature_mismatch");
  });

  it("sniffs GIF content and extracts GIF dimensions", () => {
    const gif = createGifBytes(320, 240);
    assert.equal(sniffAssetMime(gif), "image/gif");
    assert.deepEqual(validateAssetMagicBytes("image/gif", gif), { ok: true });
    assert.deepEqual(imageDimensionsFromBytes("image/gif", gif), {
      widthPx: 320,
      heightPx: 240,
    });
  });

  it("sniffs WEBP content and accepts canonical font MIME aliases", () => {
    const webp = Buffer.from("RIFF0000WEBP");
    assert.equal(sniffAssetMime(webp), "image/webp");
    assert.deepEqual(validateAssetMagicBytes("image/webp", webp), { ok: true });

    for (const [declaredMime, canonicalMime, bytes] of [
      ["application/font-woff", "font/woff", Buffer.from("wOFF")],
      ["application/font-woff2", "font/woff2", Buffer.from("wOF2")],
      [
        "application/x-font-ttf",
        "font/ttf",
        new Uint8Array([0x00, 0x01, 0x00, 0x00]),
      ],
      ["application/x-font-otf", "font/otf", Buffer.from("OTTO")],
    ] as const) {
      assert.equal(canonicalizeAssetMime(declaredMime), canonicalMime);
      assert.deepEqual(validateAssetMagicBytes(declaredMime, bytes), {
        ok: true,
      });
      const validation = validateAssetUploadPolicy(
        BRAND_FONT_UPLOAD_POLICY,
        declaredMime,
        "font.bin",
        bytes.byteLength,
      );
      assert.equal(validation.ok, true);
      if (validation.ok) assert.equal(validation.mime, canonicalMime);
    }
  });

  it("uses image filename extensions for brand logo octet-stream or missing MIME uploads", () => {
    for (const [name, expectedMime] of [
      ["logo.png", "image/png"],
      ["logo.jpg", "image/jpeg"],
      ["logo.jpeg", "image/jpeg"],
      ["logo.webp", "image/webp"],
    ] as const) {
      for (const declaredType of ["application/octet-stream", ""]) {
        const validation = validateAssetUploadPolicy(
          BRAND_LOGO_UPLOAD_POLICY,
          declaredType,
          name,
          1024,
        );
        assert.equal(validation.ok, true);
        if (validation.ok) assert.equal(validation.mime, expectedMime);
      }
    }
  });

  it("extracts WEBP dimensions across VP8X and VP8L chunks", () => {
    assert.deepEqual(
      imageDimensionsFromBytes("image/webp", createWebpVp8XBytes(640, 360)),
      {
        widthPx: 640,
        heightPx: 360,
      },
    );
    assert.deepEqual(
      imageDimensionsFromBytes("image/webp", createWebpVp8LBytes(800, 600)),
      {
        widthPx: 800,
        heightPx: 600,
      },
    );
  });

  it("rejects mismatched signatures and returns empty dimensions for unsupported images", () => {
    assert.equal(sniffAssetMime(Buffer.from("RIFFshort")), null);

    const mismatch = validateAssetMagicBytes("image/png", Buffer.from("wOFF"));
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) {
      assert.equal(mismatch.error.code, "signature_mismatch");
    }

    assert.deepEqual(
      imageDimensionsFromBytes("image/webp", Buffer.from("")),
      {},
    );
  });

  it("extracts JPEG dimensions from SOF markers and ignores malformed JPEGs", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b,
      0x08, 0x01, 0x2c, 0x02, 0x58, 0x03, 0x01, 0x11, 0x00,
    ]);
    assert.deepEqual(imageDimensionsFromBytes("image/jpeg", jpeg), {
      widthPx: 600,
      heightPx: 300,
    });
    assert.deepEqual(
      imageDimensionsFromBytes("image/jpeg", Buffer.from("bad")),
      {},
    );
    assert.deepEqual(
      imageDimensionsFromBytes(
        "image/jpeg",
        new Uint8Array([0xff, 0xd8, 0x00, 0xe0, 0x00, 0x04]),
      ),
      {},
    );
    assert.deepEqual(
      imageDimensionsFromBytes(
        "image/jpeg",
        new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]),
      ),
      {},
    );
  });

  it("returns policy metadata errors before accepting upload metadata", () => {
    const missingChecksum = buildAssetPolicyMeta({
      policy: SLIDE_ASSET_UPLOAD_POLICY,
      type: "image/png",
      name: "photo.png",
      size: 512,
      checksum: "   ",
    });
    assert.equal(missingChecksum.ok, false);
    if (!missingChecksum.ok) {
      assert.equal(missingChecksum.error.code, "checksum_missing");
      assert.match(
        formatAssetUploadPolicyError(missingChecksum.error),
        /checksum/,
      );
    }

    const rejectedType = buildAssetPolicyMeta({
      policy: SLIDE_ASSET_UPLOAD_POLICY,
      type: "image/svg+xml",
      name: "slide.svg",
      size: 512,
      checksum: "abc123",
    });
    assert.equal(rejectedType.ok, false);
    if (!rejectedType.ok) {
      assert.equal(rejectedType.error.code, "type_rejected");
    }

    const withDimensions = buildAssetPolicyMeta({
      policy: SLIDE_ASSET_UPLOAD_POLICY,
      type: "image/png",
      name: "",
      size: 512,
      checksum: "abc123",
      widthPx: 10,
      heightPx: 20,
    });
    assert.equal(withDimensions.ok, true);
    if (withDimensions.ok) {
      assert.deepEqual(withDimensions.meta, {
        mimeType: "image/png",
        byteSize: 512,
        checksum: "abc123",
        widthPx: 10,
        heightPx: 20,
        originalName: undefined,
      });
    }
  });
});
