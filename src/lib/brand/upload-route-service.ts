import "server-only";

import { uploadValidationStatus } from "@/lib/api/errors";
import { readFormData } from "@/lib/api/route-adapters";
import { prisma } from "@/lib/prisma";
import {
  formatAssetUploadPolicyError,
  imageDimensionsFromBytes,
  validateAssetDimensionsPolicy,
  validateAssetMagicBytes,
} from "@/lib/assets/upload-policy";
import {
  BRAND_FONT_UPLOAD_POLICY,
  BRAND_LOGO_UPLOAD_POLICY,
} from "@/lib/brand/asset-policy";

import { storeBrandAsset } from "./asset-store";
import {
  formatUploadError,
  validateFontUpload,
  validateLogoUpload,
  type UploadValidation,
} from "./upload";

type BrandUploadStatus = 400 | 404 | 413 | 415;

export type BrandLogoUploadBody = {
  url: string;
  assetId: string;
  mime: string;
};

export type BrandFontUploadBody = {
  url: string;
  assetId: string;
  familyName: string;
  mime: string;
};

export type BrandUploadResult<TBody> =
  | { ok: true; body: TBody }
  | { ok: false; status: BrandUploadStatus; error: string };

type BrandUploadKind = "logo" | "font";

type BrandUploadConfig<TBody> = {
  kind: BrandUploadKind;
  validate(type: string, name: string, size: number): UploadValidation;
  maxBytes: number;
  buildBody(input: {
    url: string;
    assetId: string;
    mime: string;
    fileName: string;
  }): TBody;
};

function brandIdFromFormData(formData: FormData): string | null {
  const brandIdRaw = formData.get("brandId");
  return typeof brandIdRaw === "string" && brandIdRaw ? brandIdRaw : null;
}

async function verifyOwnedBrandId(
  ownerId: string,
  brandId: string | null,
): Promise<{ ok: true } | { ok: false; status: 404; error: string }> {
  if (!brandId) return { ok: true };

  const ownedBrand = await prisma.brand.findFirst({
    where: { id: brandId, ownerId },
    select: { id: true },
  });
  if (!ownedBrand) {
    return {
      ok: false,
      status: 404,
      error: "Brand not found.",
    };
  }

  return { ok: true };
}

function familyNameFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 64);
}

async function uploadBrandAsset<TBody>(
  request: Request,
  ownerId: string,
  config: BrandUploadConfig<TBody>,
): Promise<BrandUploadResult<TBody>> {
  const parsedForm = await readFormData(
    request,
    "Request must be multipart/form-data.",
    undefined,
    {
      maxBytes: config.maxBytes + 64 * 1024,
      tooLargeMessage: "Uploaded file is too large.",
    },
  );
  if (!parsedForm.ok) {
    if (parsedForm.response.status === 413) {
      return {
        ok: false,
        error: "Uploaded file is too large.",
        status: 413,
      };
    }
    return {
      ok: false,
      error: "Request must be multipart/form-data.",
      status: 400,
    };
  }
  const formData = parsedForm.formData;

  const file = formData.get(config.kind);
  if (!(file instanceof File)) {
    return {
      ok: false,
      error: `Missing \`${config.kind}\` field in form data.`,
      status: 400,
    };
  }

  const validation = config.validate(file.type, file.name, file.size);
  if (!validation.ok) {
    return {
      ok: false,
      error: formatUploadError(validation.error),
      status: uploadValidationStatus(validation.error),
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const magic = validateAssetMagicBytes(validation.mime, buffer);
  if (!magic.ok) {
    return {
      ok: false,
      error: formatAssetUploadPolicyError(magic.error),
      status: uploadValidationStatus(magic.error),
    };
  }
  if (config.kind === "logo") {
    const dimensions = imageDimensionsFromBytes(validation.mime, buffer);
    const dimensionValidation = validateAssetDimensionsPolicy(
      BRAND_LOGO_UPLOAD_POLICY,
      dimensions.widthPx,
      dimensions.heightPx,
    );
    if (!dimensionValidation.ok) {
      return {
        ok: false,
        error: formatAssetUploadPolicyError(dimensionValidation.error),
        status: uploadValidationStatus(dimensionValidation.error),
      };
    }
  }
  const brandId = brandIdFromFormData(formData);
  const ownedBrand = await verifyOwnedBrandId(ownerId, brandId);
  if (!ownedBrand.ok) {
    return ownedBrand;
  }

  const stored = await storeBrandAsset({
    ownerId,
    buffer,
    mimeType: validation.mime,
    originalName: file.name || undefined,
    brandId,
  });

  return {
    ok: true,
    body: config.buildBody({
      url: stored.url,
      assetId: stored.assetId,
      mime: validation.mime,
      fileName: file.name,
    }),
  };
}

export function uploadBrandLogo(
  request: Request,
  ownerId: string,
): Promise<BrandUploadResult<BrandLogoUploadBody>> {
  return uploadBrandAsset(request, ownerId, {
    kind: "logo",
    validate: validateLogoUpload,
    maxBytes: BRAND_LOGO_UPLOAD_POLICY.maxBytes,
    buildBody: ({ url, assetId, mime }) => ({
      url,
      assetId,
      mime,
    }),
  });
}

export function uploadBrandFont(
  request: Request,
  ownerId: string,
): Promise<BrandUploadResult<BrandFontUploadBody>> {
  return uploadBrandAsset(request, ownerId, {
    kind: "font",
    validate: validateFontUpload,
    maxBytes: BRAND_FONT_UPLOAD_POLICY.maxBytes,
    buildBody: ({ url, assetId, mime, fileName }) => ({
      url,
      assetId,
      familyName: familyNameFromFileName(fileName),
      mime,
    }),
  });
}
