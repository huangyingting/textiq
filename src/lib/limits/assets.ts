import { formatBytesAsMb, type LimitDefinition } from "@/lib/limits/budgets";
import {
  IMPORT_ACCEPTED_MIME_TYPES,
  IMPORT_MAX_BYTES_BY_MIME,
  IMPORT_MAX_UPLOAD_BYTES,
  IMPORT_TEXT_MAX_UPLOAD_BYTES,
  type ImportAcceptedMimeType,
} from "@/lib/import/format-registry";

export {
  IMPORT_ACCEPTED_MIME_TYPES,
  IMPORT_MAX_BYTES_BY_MIME,
  IMPORT_MAX_UPLOAD_BYTES,
  IMPORT_TEXT_MAX_UPLOAD_BYTES,
};
export type { ImportAcceptedMimeType };

export const BRAND_FONT_ACCEPTED_TYPES = [
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
  "application/font-woff",
  "application/font-woff2",
  "application/x-font-ttf",
  "application/x-font-otf",
  "application/octet-stream",
  /* node:coverage ignore next -- Accepted-type tuple is asserted; tsx maps the closing row as uncovered. */
] as const;

export const BRAND_LOGO_ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
] as const;

export const BRAND_FONT_MAX_BYTES = 2 * 1024 * 1024;
export const BRAND_LOGO_MAX_BYTES = 2 * 1024 * 1024;

export const SLIDE_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export type SlideImageMime = (typeof SLIDE_IMAGE_TYPES)[number];

export const SLIDE_ASSET_MAX_BYTES = 10 * 1024 * 1024;
export const SLIDE_ASSET_MAX_DIMENSION_PX = 16_384;

export const IMPORT_UPLOAD_LIMIT: LimitDefinition = {
  id: "import.upload.bytes",
  description: "Absolute ceiling for accepted document imports.",
  value: IMPORT_MAX_UPLOAD_BYTES,
  unit: "bytes",
  enforcement: "enforced",
  diagnostic: { scope: "api.import", metric: "importUploadBytes" },
  source: "src/lib/import/validate.ts",
};

export const IMPORT_TEXT_UPLOAD_LIMIT: LimitDefinition = {
  id: "import.upload.text-bytes",
  description: "Ceiling for text-like import formats.",
  value: IMPORT_TEXT_MAX_UPLOAD_BYTES,
  unit: "bytes",
  enforcement: "enforced",
  diagnostic: { scope: "api.import", metric: "importTextUploadBytes" },
  source: "src/lib/import/validate.ts",
};

export const BRAND_FONT_UPLOAD_LIMIT: LimitDefinition = {
  id: "brand.font-upload.bytes",
  description: "Brand Studio font upload size.",
  value: BRAND_FONT_MAX_BYTES,
  unit: "bytes",
  enforcement: "enforced",
  diagnostic: { scope: "brand.upload", metric: "fontUploadBytes" },
  source: "src/lib/brand/upload.ts",
};

export const BRAND_LOGO_UPLOAD_LIMIT: LimitDefinition = {
  id: "brand.logo-upload.bytes",
  description: "Brand Studio logo upload size.",
  value: BRAND_LOGO_MAX_BYTES,
  unit: "bytes",
  enforcement: "enforced",
  diagnostic: { scope: "brand.upload", metric: "logoUploadBytes" },
  source: "src/lib/brand/upload.ts",
};

export const SLIDE_ASSET_UPLOAD_LIMIT: LimitDefinition = {
  id: "slide.asset-upload.bytes",
  description: "Slide image asset upload size.",
  value: SLIDE_ASSET_MAX_BYTES,
  unit: "bytes",
  enforcement: "enforced",
  diagnostic: { scope: "slides.asset", metric: "assetUploadBytes" },
  source: "src/lib/slides/asset-upload.ts",
};

export const SLIDE_ASSET_DIMENSION_LIMIT: LimitDefinition = {
  id: "slide.asset.dimension-px",
  description: "Maximum raster image width or height for slide assets.",
  value: SLIDE_ASSET_MAX_DIMENSION_PX,
  unit: "count",
  enforcement: "enforced",
  diagnostic: { scope: "slides.asset", metric: "assetDimensionPx" },
  source: "src/lib/slides/asset-upload.ts",
};

export function formatImportFileTooLargeError(maxBytes: number): string {
  return `File is too large. Maximum allowed size is ${formatBytesAsMb(maxBytes)} MB.`;
}

export function formatAssetFileTooLargeError(maxBytes: number): string {
  return `File exceeds the ${formatBytesAsMb(maxBytes)} MB limit.`;
}
