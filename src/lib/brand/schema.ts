/**
 * Brand data types and validation helpers (US-007 — Brand Studio).
 *
 * A `BrandStyle` is the serialized shape of the `Brand` Prisma model that is
 * passed around on the client side.  The `palette` field is stored as a
 * `Json?` column in Prisma and arrives as `unknown` from DB reads, so every
 * field is treated as potentially absent and validated before use.
 */

import type { AssetReference, ResolvedAssetUrl } from "@/lib/asset-vocabulary";

/** The curated Google Fonts list available for brand font selection. */
export const BRAND_WEB_FONTS = [
  {
    id: "inter",
    name: "Inter",
    url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
    cssFamily: "'Inter', sans-serif",
  },
  {
    id: "roboto",
    name: "Roboto",
    url: "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap",
    cssFamily: "'Roboto', sans-serif",
  },
  {
    id: "open-sans",
    name: "Open Sans",
    url: "https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap",
    cssFamily: "'Open Sans', sans-serif",
  },
  {
    id: "lato",
    name: "Lato",
    url: "https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap",
    cssFamily: "'Lato', sans-serif",
  },
  {
    id: "montserrat",
    name: "Montserrat",
    url: "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap",
    cssFamily: "'Montserrat', sans-serif",
  },
  {
    id: "playfair",
    name: "Playfair Display",
    url: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&display=swap",
    cssFamily: "'Playfair Display', serif",
  },
  {
    id: "source-sans",
    name: "Source Sans 3",
    url: "https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap",
    cssFamily: "'Source Sans 3', sans-serif",
  },
  {
    id: "nunito",
    name: "Nunito",
    url: "https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&display=swap",
    cssFamily: "'Nunito', sans-serif",
  },
  {
    id: "raleway",
    name: "Raleway",
    url: "https://fonts.googleapis.com/css2?family=Raleway:wght@400;600;700&display=swap",
    cssFamily: "'Raleway', sans-serif",
  },
  {
    id: "merriweather",
    name: "Merriweather",
    url: "https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&display=swap",
    cssFamily: "'Merriweather', serif",
  },
  {
    id: "dm-sans",
    name: "DM Sans",
    url: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap",
    cssFamily: "'DM Sans', sans-serif",
  },
  {
    id: "space-grotesk",
    name: "Space Grotesk",
    url: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap",
    cssFamily: "'Space Grotesk', sans-serif",
  },
] as const;

export interface BrandStyle {
  id: string;
  name: string;
  ownerId: string;
  palette: string[] | null;
  background: string | null;
  nodeFill: string | null;
  nodeStroke: string | null;
  nodeText: string | null;
  edgeColor: string | null;
  fontFamily: string | null;
  /**
   * Asset id of the uploaded custom font, when present (Epic #496). The display
   * URL in {@link fontAssetUrl} is derived from this asset's storage key.
   */
  fontAssetId?: AssetReference | null;
  /** Asset id of the uploaded logo, when present (Epic #496). */
  logoAssetId?: AssetReference | null;
  /**
   * Protected `/api/brand-assets/…` URL for the uploaded custom font, derived
   * from {@link fontAssetId} at read time (Epic #496). `null` for web fonts.
   */
  fontAssetUrl: ResolvedAssetUrl | null;
  /**
   * Protected `/api/brand-assets/…` URL for the uploaded logo, derived from
   * {@link logoAssetId} at read time (Epic #496).
   */
  logoAssetUrl: ResolvedAssetUrl | null;
  createdAt: string;
  updatedAt: string;
}

/** Validated input for creating / updating a brand. */
export interface BrandInput {
  name: string;
  palette?: string[] | null;
  background?: string | null;
  nodeFill?: string | null;
  nodeStroke?: string | null;
  nodeText?: string | null;
  edgeColor?: string | null;
  fontFamily?: string | null;
  /** Asset id of the uploaded custom font (Epic #496). */
  fontAssetId?: AssetReference | null;
  /** Asset id of the uploaded logo (Epic #496). */
  logoAssetId?: AssetReference | null;
}

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_COLOR.test(v);
}

/** Validates a palette array from untrusted input. Returns null on failure. */
export function parsePalette(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length < 1 || raw.length > 12) return null;
  if (!raw.every(isHexColor)) return null;
  return raw as string[];
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseBrandStyle(raw: unknown): BrandStyle | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  for (const key of ["id", "name", "ownerId", "createdAt", "updatedAt"]) {
    if (typeof record[key] !== "string" || record[key].trim().length === 0) {
      return null;
    }
  }

  const palette = record.palette === null ? null : parsePalette(record.palette);
  if (record.palette !== null && palette === null) return null;

  for (const key of [
    "background",
    "nodeFill",
    "nodeStroke",
    "nodeText",
    "edgeColor",
  ]) {
    const value = record[key];
    if (value !== null && !isHexColor(value)) return null;
  }

  for (const key of ["fontFamily", "fontAssetUrl", "logoAssetUrl"]) {
    if (!isNullableString(record[key])) return null;
  }

  for (const key of ["fontAssetId", "logoAssetId"]) {
    const value = record[key];
    if (value !== undefined && !isNullableString(value)) return null;
  }

  return {
    id: record.id as string,
    name: record.name as string,
    ownerId: record.ownerId as string,
    palette: palette ? [...palette] : null,
    background: record.background as string | null,
    nodeFill: record.nodeFill as string | null,
    nodeStroke: record.nodeStroke as string | null,
    nodeText: record.nodeText as string | null,
    edgeColor: record.edgeColor as string | null,
    fontFamily: record.fontFamily as string | null,
    ...(record.fontAssetId !== undefined
      ? { fontAssetId: record.fontAssetId as AssetReference | null }
      : {}),
    ...(record.logoAssetId !== undefined
      ? { logoAssetId: record.logoAssetId as AssetReference | null }
      : {}),
    fontAssetUrl: record.fontAssetUrl as ResolvedAssetUrl | null,
    logoAssetUrl: record.logoAssetUrl as ResolvedAssetUrl | null,
    createdAt: record.createdAt as string,
    updatedAt: record.updatedAt as string,
  };
}

/** Parses the complete `GET /api/brand` response before client UI consumes it. */
export function parseBrandListResponse(raw: unknown): BrandStyle[] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const brands = (raw as Record<string, unknown>).brands;
  if (!Array.isArray(brands)) return null;

  const parsed: BrandStyle[] = [];
  for (const brand of brands) {
    const item = parseBrandStyle(brand);
    if (!item) return null;
    parsed.push(item);
  }
  return parsed;
}

/** Clamps a brand name to reasonable bounds. */
function validateBrandName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim().slice(0, 80);
  if (trimmed.length < 1) return null;
  return trimmed;
}

/**
 * Validates a complete `BrandInput` object from untrusted form data.
 * Returns a cleaned `BrandInput` on success, or an error string on failure.
 */
export function validateBrandInput(
  raw: unknown,
): { ok: true; data: BrandInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid brand data." };
  }
  const r = raw as Record<string, unknown>;

  const name = validateBrandName(r.name);
  if (!name) {
    return { ok: false, error: "Brand name must be 1–80 characters." };
  }

  const optionalColor = (key: string): string | null | undefined => {
    const v = r[key];
    if (v === null || v === undefined) return null;
    if (!isHexColor(v)) return undefined; // signals invalid
    return v as string;
  };

  for (const key of [
    "background",
    "nodeFill",
    "nodeStroke",
    "nodeText",
    "edgeColor",
  ] as const) {
    if (optionalColor(key) === undefined) {
      return { ok: false, error: `Invalid color value for ${key}.` };
    }
  }

  let palette: string[] | null = null;
  if (r.palette !== null && r.palette !== undefined) {
    palette = parsePalette(r.palette);
    if (palette === null) {
      return {
        ok: false,
        error: "palette must be an array of 1–12 hex colors.",
      };
    }
  }

  const fontFamily =
    typeof r.fontFamily === "string" ? r.fontFamily.slice(0, 200) : null;

  // Asset-backed refs. Brand media writes persist asset ids only; protected
  // display URLs are derived at read time.
  const assetId = (key: string): string | null =>
    typeof r[key] === "string" && (r[key] as string).length > 0
      ? (r[key] as string).slice(0, 191)
      : null;
  const logoAssetId = assetId("logoAssetId");
  const fontAssetId = assetId("fontAssetId");

  return {
    ok: true,
    data: {
      name,
      palette,
      background: optionalColor("background") ?? null,
      nodeFill: optionalColor("nodeFill") ?? null,
      nodeStroke: optionalColor("nodeStroke") ?? null,
      nodeText: optionalColor("nodeText") ?? null,
      edgeColor: optionalColor("edgeColor") ?? null,
      fontFamily,
      fontAssetId,
      logoAssetId,
    },
  };
}
