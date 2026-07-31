import { parseBrandListResponse, type BrandStyle } from "@/lib/brand/schema";

export const BRAND_LIST_LOAD_ERROR = "Saved brands could not be loaded.";

/** Loads and validates the authenticated user's saved brand list. */
export async function loadBrandStyles(
  signal?: AbortSignal,
): Promise<BrandStyle[]> {
  const response = await fetch("/api/brand", { signal });
  if (!response.ok) {
    throw new Error(BRAND_LIST_LOAD_ERROR);
  }

  const brands = parseBrandListResponse(await response.json());
  if (!brands) {
    throw new Error(BRAND_LIST_LOAD_ERROR);
  }
  return brands;
}
