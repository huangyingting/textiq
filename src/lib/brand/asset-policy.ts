import type { AssetUploadPolicy } from "@/lib/assets/upload-policy";
import {
  BRAND_FONT_ACCEPTED_TYPES,
  BRAND_FONT_MAX_BYTES,
  BRAND_LOGO_ACCEPTED_TYPES,
  BRAND_LOGO_MAX_BYTES,
  SLIDE_ASSET_MAX_DIMENSION_PX,
} from "@/lib/limits";

/**
 * Canonical mapping from accepted brand-asset MIME types to their storage file
 * extension. The extension is derived from the validated MIME type, never the
 * user-supplied filename.
 */
export const BRAND_MIME_TO_EXT: Record<string, string> = {
  // Logo images
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  // Fonts
  "font/ttf": "ttf",
  "font/otf": "otf",
  "font/woff": "woff",
  "font/woff2": "woff2",
  "application/font-woff": "woff",
  "application/font-woff2": "woff2",
  "application/x-font-ttf": "ttf",
  "application/x-font-otf": "otf",
  "application/octet-stream": "bin",
};

const BRAND_EXTENSION_MIME_MAP = {
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

const BRAND_LOGO_UPLOAD_ACCEPTED_TYPES = BRAND_LOGO_ACCEPTED_TYPES.filter(
  (mime) => mime !== "image/svg+xml",
);

export const BRAND_FONT_UPLOAD_POLICY: AssetUploadPolicy<string> = {
  storageRoot: "storage/brand-assets",
  urlPrefix: "/api/brand-assets",
  scopeIdKind: "ownerId",
  acceptedMimeTypes: BRAND_FONT_ACCEPTED_TYPES,
  mimeToExt: BRAND_MIME_TO_EXT,
  maxBytes: BRAND_FONT_MAX_BYTES,
  extensionMimeMap: BRAND_EXTENSION_MIME_MAP,
};

export const BRAND_LOGO_UPLOAD_POLICY: AssetUploadPolicy<string> = {
  storageRoot: "storage/brand-assets",
  urlPrefix: "/api/brand-assets",
  scopeIdKind: "ownerId",
  acceptedMimeTypes: BRAND_LOGO_UPLOAD_ACCEPTED_TYPES,
  mimeToExt: BRAND_MIME_TO_EXT,
  maxBytes: BRAND_LOGO_MAX_BYTES,
  dimensions: { maxPx: SLIDE_ASSET_MAX_DIMENSION_PX },
  extensionMimeMap: BRAND_EXTENSION_MIME_MAP,
};
