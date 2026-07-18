import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { requireWorkspaceCapability } from "@/lib/auth/workspace-capabilities";
import { isPrismaUniqueConstraintConflict } from "@/lib/db/prisma-unique-constraint";
import { prisma } from "@/lib/prisma";

import { makeDiagnostic, type PresentationDiagnostic } from "../diagnostics";
import { openDeckFromJson } from "../open-deck";
import type { Deck } from "../schema";
import type { ThemePackageV1 } from "../theme-package-schema";
import { validateThemePackage } from "../theme-package-schema";
import {
  getThemePackage,
  mergeThemePackageCatalogEntries,
  type ThemePackageCatalogEntry,
} from "../theme-package-registry";
import { compileBrandKitDraft } from "./compiler";
import type { BrandKitDiagnostic, BrandKitDraftV1 } from "./schema";

type BrandKitTransactionClient = Pick<
  Prisma.TransactionClient,
  "brandKitDraft" | "themePackageSnapshot"
>;

type BrandKitClient = BrandKitTransactionClient & {
  $transaction<T>(
    operation: (tx: BrandKitTransactionClient) => Promise<T>,
  ): Promise<T>;
};

const THEME_PACKAGE_SNAPSHOT_VERSION_UNIQUE_FIELDS = [
  "packageId",
  "packageVersion",
] as const;
// Prisma's default name for ThemePackageSnapshot @@unique([packageId, packageVersion]).
export const THEME_PACKAGE_SNAPSHOT_VERSION_UNIQUE_CONSTRAINT =
  "ThemePackageSnapshot_packageId_packageVersion_key";

export type PersistBrandKitResult =
  | {
      ok: true;
      draftId: string;
      packageId: string;
      packageVersion: string;
      package: ThemePackageV1;
      catalogEntry: ThemePackageCatalogEntry;
      diagnostics: BrandKitDiagnostic[];
    }
  | { ok: false; diagnostics: BrandKitDiagnostic[] };

export type LoadCustomThemePackagesResult = {
  activePackage?: ThemePackageV1;
  catalogEntries: ThemePackageCatalogEntry[];
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

function canonicalizeStructuredJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeStructuredJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([key, child]) => [key, canonicalizeStructuredJson(child)]),
    );
  }
  return value;
}

function packageContentMatches(
  persisted: unknown,
  compiled: ThemePackageV1,
): boolean {
  return (
    JSON.stringify(canonicalizeStructuredJson(persisted)) ===
    JSON.stringify(canonicalizeStructuredJson(compiled))
  );
}

function packageVersionConflict(): PersistBrandKitResult {
  return {
    ok: false,
    diagnostics: [
      {
        severity: "error",
        code: "package-version-exists",
        message:
          "This theme package version already exists with different content. Increment Version before saving.",
        path: "version",
      },
    ],
  };
}

export function isThemePackageSnapshotVersionUniqueConflict(
  error: unknown,
): boolean {
  return isPrismaUniqueConstraintConflict(error, {
    fields: THEME_PACKAGE_SNAPSHOT_VERSION_UNIQUE_FIELDS,
    constraintName: THEME_PACKAGE_SNAPSHOT_VERSION_UNIQUE_CONSTRAINT,
  });
}

function draftUpsertData({
  draft,
  userId,
  workspaceId,
  scopeKey,
  themePackage,
}: {
  draft: BrandKitDraftV1;
  userId: string;
  workspaceId: string | null;
  scopeKey: string;
  themePackage: ThemePackageV1;
}) {
  const synchronized = {
    name: draft.name,
    scope: draft.scope.kind,
    scopeKey,
    sourcePresetId: draft.sourcePresetId ?? null,
    version: draft.version,
    revisionId: draft.revision.id,
    revisionNumber: draft.revision.number,
    draftJson: draftJsonValue(draft),
    latestPackageId: themePackage.id,
    latestPackageVersion: themePackage.version,
  };
  return {
    where: { scopeKey_slug: { scopeKey, slug: draft.slug } },
    create: {
      slug: draft.slug,
      ownerId: userId,
      workspaceId,
      ...synchronized,
    },
    update: synchronized,
    select: { id: true },
  } satisfies Prisma.BrandKitDraftUpsertArgs;
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
  const snapshotWhere = {
    packageId_packageVersion: {
      packageId: compiled.package.id,
      packageVersion: compiled.package.version,
    },
  } as const;
  const synchronizeDraft = (tx: BrandKitTransactionClient) =>
    tx.brandKitDraft.upsert(
      draftUpsertData({
        draft: compiled.draft,
        userId,
        workspaceId,
        scopeKey,
        themePackage: compiled.package,
      }),
    );

  let persisted: { ok: true; draftId: string; createdAt: Date } | { ok: false };
  try {
    persisted = await client.$transaction(async (tx) => {
      const existingSnapshot = await tx.themePackageSnapshot.findUnique({
        where: snapshotWhere,
        select: { packageJson: true, createdAt: true },
      });
      if (existingSnapshot) {
        if (
          !packageContentMatches(existingSnapshot.packageJson, compiled.package)
        ) {
          return { ok: false as const };
        }
        const draftRow = await synchronizeDraft(tx);
        return {
          ok: true as const,
          draftId: draftRow.id,
          createdAt: existingSnapshot.createdAt,
        };
      }

      const snapshot = await tx.themePackageSnapshot.create({
        data: {
          packageId: compiled.package.id,
          packageVersion: compiled.package.version,
          ownerId: userId,
          workspaceId,
          publishedById: userId,
          packageJson: packageJsonValue(compiled.package),
        },
        select: { id: true, createdAt: true },
      });
      const draftRow = await synchronizeDraft(tx);
      await tx.themePackageSnapshot.update({
        where: { id: snapshot.id },
        data: { draftId: draftRow.id },
      });
      return {
        ok: true as const,
        draftId: draftRow.id,
        createdAt: snapshot.createdAt,
      };
    });
  } catch (error: unknown) {
    if (!isThemePackageSnapshotVersionUniqueConflict(error)) throw error;
    const winningSnapshot = await client.themePackageSnapshot.findUnique({
      where: snapshotWhere,
      select: { packageJson: true, createdAt: true },
    });
    if (!winningSnapshot) throw error;
    if (!packageContentMatches(winningSnapshot.packageJson, compiled.package)) {
      return packageVersionConflict();
    }
    persisted = await client.$transaction(async (tx) => {
      const draftRow = await synchronizeDraft(tx);
      return {
        ok: true as const,
        draftId: draftRow.id,
        createdAt: winningSnapshot.createdAt,
      };
    });
  }

  if (!persisted.ok) return packageVersionConflict();
  const catalogEntry: ThemePackageCatalogEntry = {
    package: compiled.package,
    source: "custom",
    createdAt: persisted.createdAt.toISOString(),
  };

  return {
    ok: true,
    draftId: persisted.draftId,
    packageId: compiled.package.id,
    packageVersion: compiled.package.version,
    package: compiled.package,
    catalogEntry,
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

/**
 * The deck must come from an already-authorized document/share path. Its exact
 * active reference is trusted; user/workspace filters apply only to browsing.
 */
export async function loadCustomThemePackagesForDeck(
  deck: Pick<Deck, "theme">,
  options: {
    userId?: string;
    workspaceId?: string | null;
    client?: BrandKitClient;
  } = {},
): Promise<LoadCustomThemePackagesResult> {
  const packageId = deck.theme.packageId;
  const packageVersion = deck.theme.packageVersion;
  const client = options.client ?? prisma;
  const accessWhere =
    options.userId || options.workspaceId
      ? {
          OR: [
            ...(options.userId ? [{ ownerId: options.userId }] : []),
            ...(options.workspaceId
              ? [{ workspaceId: options.workspaceId }]
              : []),
          ],
        }
      : undefined;
  const shouldLoadActive =
    typeof packageId === "string" && !getThemePackage(packageId);
  const activeRow =
    shouldLoadActive && typeof packageVersion === "string"
      ? await client.themePackageSnapshot.findUnique({
          where: {
            packageId_packageVersion: {
              packageId,
              packageVersion,
            },
          },
          select: { packageJson: true },
        })
      : null;
  const latestRows = accessWhere
    ? await client.themePackageSnapshot.findMany({
        where: accessWhere,
        orderBy: [
          { createdAt: "desc" },
          { packageId: "asc" },
          { packageVersion: "desc" },
        ],
        select: {
          packageId: true,
          packageVersion: true,
          packageJson: true,
          createdAt: true,
        },
      })
    : [];

  let activePackage: ThemePackageV1 | undefined;
  const catalogEntries: ThemePackageCatalogEntry[] = [];
  const diagnostics: PresentationDiagnostic[] = [];
  if (activeRow) {
    const result = validateSnapshotPackage(
      activeRow.packageJson,
      "activeThemePackageSnapshot.packageJson",
    );
    activePackage = result.package;
    diagnostics.push(...result.diagnostics);
  }
  for (const [index, row] of latestRows.entries()) {
    const result = validateSnapshotPackage(
      row.packageJson,
      `latestThemePackageSnapshots.${index}.packageJson`,
    );
    if (result.package) {
      catalogEntries.push({
        package: result.package,
        source: "custom",
        createdAt: row.createdAt.toISOString(),
      });
    }
    diagnostics.push(...result.diagnostics);
  }

  if (shouldLoadActive && !activeRow) {
    diagnostics.push(
      makeDiagnostic(
        "unknown-theme-package",
        "warning",
        `Unknown custom theme package "${packageId}". Rendering with Neutral fallback if no built-in package matches.`,
        { path: "theme.packageId", details: { themePackageId: packageId } },
      ),
    );
  }

  return {
    activePackage,
    catalogEntries: mergeThemePackageCatalogEntries(catalogEntries),
    diagnostics,
  };
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
  const loaded = await loadCustomThemePackagesForDeck(
    opened.ok
      ? opened.deck
      : {
          theme: { packageId: "neutral" },
        },
    options,
  );
  return {
    activePackage: loaded.activePackage,
    catalogEntries: loaded.catalogEntries,
    diagnostics: [...opened.diagnostics, ...loaded.diagnostics],
  };
}
