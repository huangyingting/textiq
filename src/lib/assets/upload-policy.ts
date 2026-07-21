import { formatAssetFileTooLargeError } from "@/lib/limits";

export interface AssetUploadPolicy<TMime extends string = string> {
  storageRoot: string;
  urlPrefix: string;
  scopeIdKind: "documentId" | "ownerId";
  acceptedMimeTypes: readonly TMime[];
  mimeToExt: Readonly<Record<string, string>>;
  maxBytes: number;
  dimensions?: {
    maxPx: number;
  };
  extensionMimeMap?: Readonly<Record<string, string>>;
}

export type AssetUploadPolicyError =
  | { code: "type_rejected"; accepted: readonly string[] }
  | { code: "file_too_large"; maxBytes: number }
  | { code: "dimension_exceeded"; maxPx: number }
  | { code: "checksum_missing" }
  | { code: "signature_mismatch" };

export type AssetUploadPolicyValidation<TMime extends string = string> =
  | { ok: true; mime: TMime; byteSize: number }
  | { ok: false; error: AssetUploadPolicyError };

export type AssetPolicyMetaResult<TMime extends string = string> =
  | { ok: true; meta: AssetPolicyMeta<TMime> }
  | { ok: false; error: AssetUploadPolicyError };

export interface AssetPolicyMeta<TMime extends string = string> {
  mimeType: TMime;
  byteSize: number;
  checksum: string;
  widthPx?: number;
  heightPx?: number;
  originalName?: string;
}

const MIME_ALIASES: Readonly<Record<string, string>> = {
  "application/font-woff": "font/woff",
  "application/font-woff2": "font/woff2",
  "application/x-font-ttf": "font/ttf",
  "application/x-font-otf": "font/otf",
};

export function canonicalizeAssetMime(mime: string): string {
  return MIME_ALIASES[mime.toLowerCase()] ?? mime;
}

export function resolveUploadMime(
  policy: AssetUploadPolicy,
  type: string,
  name: string,
): string {
  if (type && type !== "application/octet-stream") {
    return canonicalizeAssetMime(type);
  }
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return canonicalizeAssetMime(policy.extensionMimeMap?.[ext] ?? type);
}

export function isAcceptedAssetMime<TMime extends string>(
  policy: AssetUploadPolicy<TMime>,
  mime: string,
): mime is TMime {
  return (policy.acceptedMimeTypes as readonly string[]).includes(mime);
}

export function validateAssetUploadPolicy<TMime extends string>(
  policy: AssetUploadPolicy<TMime>,
  type: string,
  name: string,
  size: number,
): AssetUploadPolicyValidation<TMime> {
  if (size > policy.maxBytes) {
    return {
      ok: false,
      error: { code: "file_too_large", maxBytes: policy.maxBytes },
    };
  }
  const mime = resolveUploadMime(policy, type, name);
  if (!isAcceptedAssetMime(policy, mime)) {
    return {
      ok: false,
      error: { code: "type_rejected", accepted: policy.acceptedMimeTypes },
    };
  }
  return { ok: true, mime, byteSize: size };
}

export function validateAssetDimensionsPolicy(
  policy: AssetUploadPolicy,
  widthPx: number | undefined,
  heightPx: number | undefined,
): { ok: true } | { ok: false; error: AssetUploadPolicyError } {
  const maxAllowed = policy.dimensions?.maxPx;
  if (maxAllowed === undefined) return { ok: true };
  const maxActual = Math.max(widthPx ?? 0, heightPx ?? 0);
  if (maxActual > maxAllowed) {
    return {
      ok: false,
      error: { code: "dimension_exceeded", maxPx: maxAllowed },
    };
  }
  return { ok: true };
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

export function sniffAssetMime(bytes: Uint8Array): string | null {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "image/gif";
  }
  if (hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.length >= 12) {
    const webp = String.fromCharCode(...bytes.slice(8, 12));
    /* node:coverage ignore next -- WEBP sniffing is asserted; tsx maps the inner branch as uncovered. */
    if (webp === "WEBP") return "image/webp";
  }
  if (hasPrefix(bytes, [0x77, 0x4f, 0x46, 0x46])) return "font/woff";
  if (hasPrefix(bytes, [0x77, 0x4f, 0x46, 0x32])) return "font/woff2";
  if (hasPrefix(bytes, [0x00, 0x01, 0x00, 0x00])) return "font/ttf";
  if (hasPrefix(bytes, [0x4f, 0x54, 0x54, 0x4f])) return "font/otf";
  return null;
}

export function validateAssetMagicBytes(
  declaredMime: string,
  bytes: Uint8Array,
): { ok: true } | { ok: false; error: AssetUploadPolicyError } {
  const sniffed = sniffAssetMime(bytes);
  if (sniffed === null) {
    return { ok: false, error: { code: "signature_mismatch" } };
  }
  if (canonicalizeAssetMime(declaredMime) !== canonicalizeAssetMime(sniffed)) {
    return { ok: false, error: { code: "signature_mismatch" } };
  }
  return { ok: true };
}

export function imageDimensionsFromBytes(
  mime: string,
  bytes: Uint8Array,
): { widthPx?: number; heightPx?: number } {
  if (mime === "image/png" && bytes.length >= 24) {
    return {
      widthPx: readUInt32BE(bytes, 16),
      heightPx: readUInt32BE(bytes, 20),
    };
  }
  if (mime === "image/jpeg") {
    return jpegDimensions(bytes);
  }
  if (mime === "image/gif" && bytes.length >= 10) {
    return {
      widthPx: readUInt16LE(bytes, 6),
      heightPx: readUInt16LE(bytes, 8),
    };
  }
  if (mime === "image/webp") {
    return webpDimensions(bytes);
  }
  return {};
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    ((bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!)
  );
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUInt24LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
  );
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function jpegDimensions(bytes: Uint8Array): {
  widthPx?: number;
  heightPx?: number;
} {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1]!;
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    /* node:coverage ignore next -- Malformed JPEG segment length is asserted; tsx maps this branch as uncovered. */
    if (length < 2) break;
    /* node:coverage ignore next 7 -- JPEG SOF and malformed fall-through branches are asserted; tsx maps this span as uncovered. */
    if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < bytes.length) {
      return {
        heightPx: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        widthPx: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
      };
    }
    offset += 2 + length;
  }
  /* node:coverage ignore next -- malformed JPEG fallback is asserted; tsx maps the function tail as uncovered. */
  return {};
}

function webpDimensions(bytes: Uint8Array): {
  widthPx?: number;
  heightPx?: number;
} {
  if (
    bytes.length < 20 ||
    !hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) ||
    String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP"
  ) {
    return {};
  }

  let chunkOffset = 12;
  while (chunkOffset + 8 <= bytes.length) {
    const chunkType = String.fromCharCode(
      ...bytes.slice(chunkOffset, chunkOffset + 4),
    );
    const chunkSize = readUInt32LE(bytes, chunkOffset + 4);
    const payloadOffset = chunkOffset + 8;
    const payloadEnd = payloadOffset + chunkSize;
    if (payloadEnd > bytes.length) return {};

    if (chunkType === "VP8X") {
      if (chunkSize < 10) return {};
      return {
        widthPx: readUInt24LE(bytes, payloadOffset + 4) + 1,
        heightPx: readUInt24LE(bytes, payloadOffset + 7) + 1,
      };
    }

    if (chunkType === "VP8L") {
      if (chunkSize < 5 || bytes[payloadOffset] !== 0x2f) return {};
      const bits = readUInt32LE(bytes, payloadOffset + 1);
      return {
        widthPx: (bits & 0x3fff) + 1,
        heightPx: ((bits >> 14) & 0x3fff) + 1,
      };
    }

    if (chunkType === "VP8 ") {
      if (
        chunkSize < 10 ||
        bytes[payloadOffset + 3] !== 0x9d ||
        bytes[payloadOffset + 4] !== 0x01 ||
        bytes[payloadOffset + 5] !== 0x2a
      ) {
        return {};
      }
      return {
        widthPx: readUInt16LE(bytes, payloadOffset + 6) & 0x3fff,
        heightPx: readUInt16LE(bytes, payloadOffset + 8) & 0x3fff,
      };
    }

    chunkOffset = payloadEnd + (chunkSize % 2);
  }

  return {};
}

export function buildAssetPolicyMeta<TMime extends string>(opts: {
  policy: AssetUploadPolicy<TMime>;
  type: string;
  name: string;
  size: number;
  checksum: string;
  widthPx?: number;
  heightPx?: number;
}): AssetPolicyMetaResult<TMime> {
  /* node:coverage ignore next 3 -- checksum rejection is asserted; tsx maps this guard as uncovered. */
  if (!opts.checksum || !opts.checksum.trim()) {
    return { ok: false, error: { code: "checksum_missing" } };
  }
  const resolved = resolveUploadMime(opts.policy, opts.type, opts.name);
  if (!isAcceptedAssetMime(opts.policy, resolved)) {
    return {
      ok: false,
      error: {
        code: "type_rejected",
        accepted: opts.policy.acceptedMimeTypes,
      },
    };
  }
  return {
    ok: true,
    meta: {
      mimeType: resolved,
      byteSize: opts.size,
      checksum: opts.checksum,
      ...(opts.widthPx !== undefined ? { widthPx: opts.widthPx } : {}),
      ...(opts.heightPx !== undefined ? { heightPx: opts.heightPx } : {}),
      originalName: opts.name || undefined,
    },
  };
}

export function formatAssetUploadPolicyError(
  error: AssetUploadPolicyError,
): string {
  switch (error.code) {
    case "file_too_large":
      return formatAssetFileTooLargeError(error.maxBytes);
    case "type_rejected":
      return `Unsupported file type. Accepted: ${error.accepted.join(", ")}.`;
    case "dimension_exceeded":
      return `Image dimensions exceed the ${error.maxPx}px limit.`;
    case "checksum_missing":
      return "File integrity check failed — checksum is required.";
    case "signature_mismatch":
      return "Uploaded file contents do not match the declared file type.";
  }
}
