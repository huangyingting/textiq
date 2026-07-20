"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { actionError, actionOk, type ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { validateBrandInput, type BrandStyle } from "@/lib/brand/schema";
import {
  BRAND_SELECT,
  serializeBrands,
  type BrandRow,
} from "@/lib/brand/serialize";
import {
  BrandAssetValidationError,
  createBrandForOwner,
  deleteBrandForOwner,
  updateBrandForOwner,
} from "@/lib/brand/persistence-service";
import {
  resolveBrandEntitlements,
  isCustomFontFamily,
  BRAND_STYLES_UPGRADE_MESSAGE,
  FONT_UPLOAD_UPGRADE_MESSAGE,
} from "@/lib/billing/brand-entitlements";

/** Serializes one brand row to a `BrandStyle`, resolving asset URLs. */
async function serializeOne(row: BrandRow): Promise<BrandStyle> {
  const [style] = await serializeBrands([row]);
  return style;
}

function requiresFontUploadEntitlement(data: {
  fontFamily?: string | null;
  fontAssetId?: string | null;
}): boolean {
  return Boolean(data.fontAssetId) || isCustomFontFamily(data.fontFamily);
}

/** Lists all brands owned by the current user. */
export async function listBrands(): Promise<BrandStyle[]> {
  const user = await requireUser(redirect);
  const rows = await prisma.brand.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "asc" },
    select: BRAND_SELECT,
  });
  return serializeBrands(rows);
}

/** Creates a new brand for the current user. Returns the created brand. */
export async function createBrand(
  raw: unknown,
): Promise<ActionResult<BrandStyle>> {
  const user = await requireUser(redirect);
  const entitlements = await resolveBrandEntitlements(user.id);
  if (!entitlements.canBrand) {
    return actionError(BRAND_STYLES_UPGRADE_MESSAGE);
  }
  const validation = validateBrandInput(raw);
  if (!validation.ok) {
    return actionError(validation.error);
  }
  const { data } = validation;

  if (requiresFontUploadEntitlement(data) && !entitlements.canFontUpload) {
    return actionError(FONT_UPLOAD_UPGRADE_MESSAGE);
  }

  let row: BrandRow;
  try {
    row = await createBrandForOwner(user.id, data);
  } catch (error) {
    if (error instanceof BrandAssetValidationError) {
      return actionError(error.message);
    }
    throw error;
  }

  revalidatePath("/app/brands");
  return actionOk(await serializeOne(row));
}

/** Updates a brand owned by the current user. */
export async function updateBrand(
  id: string,
  raw: unknown,
): Promise<ActionResult<BrandStyle>> {
  const user = await requireUser(redirect);
  const entitlements = await resolveBrandEntitlements(user.id);
  if (!entitlements.canBrand) {
    return actionError(BRAND_STYLES_UPGRADE_MESSAGE);
  }

  const validation = validateBrandInput(raw);
  if (!validation.ok) return actionError(validation.error);
  const { data } = validation;

  if (requiresFontUploadEntitlement(data) && !entitlements.canFontUpload) {
    return actionError(FONT_UPLOAD_UPGRADE_MESSAGE);
  }

  let row: BrandRow | null;
  try {
    row = await updateBrandForOwner(id, user.id, data);
  } catch (error) {
    if (error instanceof BrandAssetValidationError) {
      return actionError(error.message);
    }
    if (error instanceof Error && error.message === "Not authorized.") {
      return actionError("Not authorized.");
    }
    throw error;
  }
  if (!row) return actionError("Brand not found.");

  revalidatePath("/app/brands");
  return actionOk(await serializeOne(row));
}

/** Deletes a brand owned by the current user. */
export async function deleteBrand(id: string): Promise<ActionResult> {
  const user = await requireUser(redirect);
  const entitlements = await resolveBrandEntitlements(user.id);
  if (!entitlements.canBrand) {
    return actionError(BRAND_STYLES_UPGRADE_MESSAGE);
  }

  const result = await deleteBrandForOwner(id, user.id);
  if (result === "missing") return actionError("Brand not found.");
  if (result === "unauthorized") return actionError("Not authorized.");

  revalidatePath("/app/brands");
  return actionOk();
}
