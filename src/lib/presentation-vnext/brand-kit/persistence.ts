import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { requireWorkspaceCapability } from "@/lib/auth/workspace-capabilities";
import { prisma } from "@/lib/prisma";
import { isBuiltInThemePackageId } from "@/lib/presentation-shared/theme-package-ids";

import { makeDiagnostic, type PresentationDiagnostic } from "../diagnostics";
import { openDeckFromJson } from "../open-deck";
import type { DeckV7 } from "../schema";
import type { ThemePackageV1 } from "../theme-package-schema";
import { validateThemePackage } from "../theme-package-schema";
import { compileBrandKitDraft } from "./compiler";
import type { BrandKitDiagnostic, BrandKitDraftV1 } from "./schema";

type BrandKitClient = Pick<
  typeof prisma,
  "brandKitDraft" | "themePackageSnapshot"
>;

export type PersistBrandKitResult =
  | {
      ok: true;
      draftId: string;
      packageId: string;
      packageVersion: string;
      package: ThemePackageV1;
      diagnostics: BrandKitDiagnostic[];
    }
  | { ok: false; diagnostics: BrandKitDiagnostic[] };

export type LoadCustomThemePackagesResult = {
  packages: ThemePackageV1[];
  diagnostics: PresentationDiagnostic[];
};

function packageJsonValue(themePackage: ThemePackageV1): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(themePackage)) as Prisma.InputJsonValue;
}

function draftJsonValue(draft: BrandKitDraftV1): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(draft)) as Prisma.InputJsonValue;
}

function scopeKeyForDraft(draft: BrandKitDraftV1): string {
  return draft.scope.kind === "workspace"
    ? `workspace:${draft.scope.workspaceId}`
    : `user:${draft.scope.ownerId}`;
}

async function authorizeDraftPersistence(
  draft: BrandKitDraftV1,
  userId: string,
) {
  if (draft.scope.kind === "user") {
    if (draft.scope.ownerId !== userId) {
      return {
        ok: false as const,
        diagnostic: {
          severity: "error" as const,
          code: "invalid-owner",
          message: "User-scoped brand kits must be owned by the acting user.",
          path: "scope.ownerId",
        },
      };
    }
    return { ok: true as const };
  }

  await requireWorkspaceCapability(userId, draft.scope.workspaceId, "mutate");
  return { ok: true as const };
}

export async function persistCompiledBrandKitDraft({
  draftInput,
  userId,
  client = prisma,
}: {
  draftInput: unknown;
  userId: string;
  client?: BrandKitClient;
}): Promise<PersistBrandKitResult> {
  const compiled = compileBrandKitDraft(draftInput);
  if (!compiled.ok) return compiled;

  const authorization = await authorizeDraftPersistence(compiled.draft, userId);
  if (!authorization.ok) {
    return { ok: false, diagnostics: [authorization.diagnostic] };
  }

  const workspaceId =
    compiled.draft.scope.kind === "workspace"
      ? compiled.draft.scope.workspaceId
      : null;
  const scopeKey = scopeKeyForDraft(compiled.draft);
  const existing = await client.brandKitDraft.findFirst({
    where: { scopeKey, slug: compiled.draft.slug },
    select: { id: true },
  });

  const draftRow = existing
    ? await client.brandKitDraft.update({
        where: { id: existing.id },
        data: {
          name: compiled.draft.name,
          scope: compiled.draft.scope.kind,
          scopeKey,
          sourcePresetId: compiled.draft.sourcePresetId ?? null,
          version: compiled.draft.version,
          revisionId: compiled.draft.revision.id,
          revisionNumber: compiled.draft.revision.number,
          draftJson: draftJsonValue(compiled.draft),
          latestPackageId: compiled.package.id,
          latestPackageVersion: compiled.package.version,
        },
        select: { id: true },
      })
    : await client.brandKitDraft.create({
        data: {
          slug: compiled.draft.slug,
          name: compiled.draft.name,
          ownerId: userId,
          workspaceId,
          scope: compiled.draft.scope.kind,
          scopeKey,
          sourcePresetId: compiled.draft.sourcePresetId ?? null,
          version: compiled.draft.version,
          revisionId: compiled.draft.revision.id,
          revisionNumber: compiled.draft.revision.number,
          draftJson: draftJsonValue(compiled.draft),
          latestPackageId: compiled.package.id,
          latestPackageVersion: compiled.package.version,
        },
        select: { id: true },
      });

  await client.themePackageSnapshot.upsert({
    where: {
      packageId_packageVersion: {
        packageId: compiled.package.id,
        packageVersion: compiled.package.version,
      },
    },
    update: {},
    create: {
      packageId: compiled.package.id,
      packageVersion: compiled.package.version,
      draftId: draftRow.id,
      ownerId: userId,
      workspaceId,
      publishedById: userId,
      packageJson: packageJsonValue(compiled.package),
    },
  });

  return {
    ok: true,
    draftId: draftRow.id,
    packageId: compiled.package.id,
    packageVersion: compiled.package.version,
    package: compiled.package,
    diagnostics: compiled.diagnostics,
  };
}

function validateSnapshotPackage(
  packageJson: unknown,
  path: string,
): { package?: ThemePackageV1; diagnostics: PresentationDiagnostic[] } {
  const validation = validateThemePackage(packageJson);
  if (validation.valid) return { package: validation.package, diagnostics: [] };

  return {
    diagnostics: validation.diagnostics.map((diagnostic) =>
      makeDiagnostic(
        "unknown-theme-package",
        "warning",
        `Custom theme package snapshot is invalid: ${diagnostic.message}`,
        {
          path: diagnostic.path ?? path,
          details: { sourceCode: diagnostic.code },
        },
      ),
    ),
  };
}

export async function loadCustomThemePackagesForDeck(
  deck: Pick<DeckV7, "theme">,
  options: {
    userId?: string;
    workspaceId?: string | null;
    client?: BrandKitClient;
  } = {},
): Promise<LoadCustomThemePackagesResult> {
  const packageId = deck.theme.packageId;
  if (!packageId || isBuiltInThemePackageId(packageId)) {
    return { packages: [], diagnostics: [] };
  }

  const packageVersion = deck.theme.packageVersion;
  const rows = await (options.client ?? prisma).themePackageSnapshot.findMany({
    where: {
      packageId,
      ...(packageVersion ? { packageVersion } : {}),
      ...(options.userId || options.workspaceId
        ? {
            OR: [
              ...(options.userId ? [{ ownerId: options.userId }] : []),
              ...(options.workspaceId
                ? [{ workspaceId: options.workspaceId }]
                : []),
            ],
          }
        : {}),
    },
    orderBy: [{ packageVersion: "desc" }, { createdAt: "desc" }],
    take: 5,
    select: { packageJson: true },
  });

  const packages: ThemePackageV1[] = [];
  const diagnostics: PresentationDiagnostic[] = [];
  for (const [index, row] of rows.entries()) {
    const result = validateSnapshotPackage(
      row.packageJson,
      `themePackageSnapshots.${index}.packageJson`,
    );
    if (result.package) packages.push(result.package);
    diagnostics.push(...result.diagnostics);
  }

  if (rows.length === 0) {
    diagnostics.push(
      makeDiagnostic(
        "unknown-theme-package",
        "warning",
        `Unknown custom theme package "${packageId}". Rendering with Neutral fallback if no built-in package matches.`,
        { path: "theme.packageId", details: { themePackageId: packageId } },
      ),
    );
  }

  return { packages, diagnostics };
}

export async function loadCustomThemePackagesForDeckJson(
  deckJson: unknown,
  options: {
    userId?: string;
    workspaceId?: string | null;
    client?: BrandKitClient;
  } = {},
): Promise<LoadCustomThemePackagesResult> {
  const opened = openDeckFromJson(deckJson);
  if (!opened.ok) return { packages: [], diagnostics: opened.diagnostics };
  const loaded = await loadCustomThemePackagesForDeck(opened.deck, options);
  return {
    packages: loaded.packages,
    diagnostics: [...opened.diagnostics, ...loaded.diagnostics],
  };
}
