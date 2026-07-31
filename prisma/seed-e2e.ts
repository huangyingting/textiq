import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";

import bcrypt from "bcryptjs";
import clarityPackageJson from "../prototypes/slide-themes/packages/clarity.package.json";

import { Prisma } from "../src/generated/prisma/client";
import { markdownToLexicalStateObject } from "../src/lib/content/from-markdown";
import {
  deleteDocuments,
  updateDocumentMetadata,
  upsertDocumentWithCanonicalContent,
} from "../src/lib/document/document-write-port";
import { openDeckFromJson } from "../src/lib/presentation/open-deck";
import { safeParseDeck } from "../src/lib/presentation/validation";
import { validateThemePackage } from "../src/lib/presentation/theme-package-schema";
import { deriveStorageKey } from "../src/lib/slides/asset-storage";
import {
  VISUAL_KIND_TO_PRISMA,
  safeParseVisual,
} from "../src/lib/visual/schema";
import {
  E2E_PROFILE_FIXTURE,
  buildE2EProfileContentJson,
  buildE2EProfileDeck,
  buildE2EProfileDeckFixture,
  buildE2EProfileFixtureDescriptor,
  buildE2ESourceLinkedDeck,
  buildE2EMultiSelectArrangeDeck,
  buildE2EGroupLayerOrderDeck,
  buildE2EOverlapSelectionDeck,
  buildE2EGeneratedPresentationContentJson,
  buildE2EPrecisionGuidesDeck,
  buildE2ETouchControlsDeck,
  buildE2EProfileVisual,
  fixtureAssetChecksum,
  fixturePngBuffer,
} from "../src/test/builders/e2e-profile";
import {
  configuredPresentationTestFixtures,
  E2E_CONFLICT_OWNER_THEME_FIXTURE,
  E2E_CUSTOM_THEME_FIXTURE,
  E2E_VERSIONED_THEME_FIXTURE,
} from "../e2e/helpers/presentation-fixtures";
import { createScriptPrismaClient } from "./script-prisma-client";
import {
  cleanupStaleE2EPresentationFixtures,
  documentIdFromE2EPresentationAssetStorageKey,
  E2E_PRESENTATION_ASSET_ORIGINAL_NAME,
  removeE2EPresentationAssetDirectory,
} from "./seed-e2e-cleanup";

/**
 * Deterministic E2E seed (Epic #517, issue #518).
 *
 * Creates fixed owner/editor/viewer users (passwords hashed via the same bcrypt
 * path the app uses), a workspace granting editor mutating access and viewer
 * read-only access, and a canonical document with:
 *   - an intro paragraph + embedded VisualNode in `contentJson`,
 *   - a persisted `deckJson` (current schema version) whose first slide carries
 *     known title/body text and an ImageElement backed by a slide Asset,
 *   - an enabled public share policy (fixed shareId + slug, present + embed),
 *   - one slide image `Asset` whose bytes are written to local storage so the
 *     protected `/api/slide-assets/…` route resolves real bytes.
 *
 * Mutating presentation checks receive dedicated document/room fixtures from
 * `e2e/helpers/presentation-fixtures.ts`. After a successful run it emits
 * `e2e/.e2e-fixture.json` describing the canonical fixture.
 *
 * Idempotent: safe to re-run (and after `prisma db push --force-reset`).
 */

const prisma = createScriptPrismaClient();

const F = E2E_PROFILE_FIXTURE;

async function writeAssetBytes(
  storageKey: string,
  bytes: Buffer,
): Promise<void> {
  const dest = path.join(process.cwd(), "storage", "slide-assets", storageKey);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, bytes);
}

async function main() {
  // A successful-signup browser fixture must not exist before its lifecycle
  // starts. Exact-email cleanup also makes the profile self-healing when a
  // prior browser run stopped before deleting the account through settings.
  await prisma.user.deleteMany({
    where: { email: F.signupLifecycle.email },
  });

  // -------------------------------------------------------------------------
  // 1. Users — owner + editor + viewer + an isolated account-mutation user,
  //    with passwords hashed via the production bcrypt cost.
  // -------------------------------------------------------------------------
  const ownerHash = await bcrypt.hash(F.owner.password, 12);
  const editorHash = await bcrypt.hash(F.editor.password, 12);
  const viewerHash = await bcrypt.hash(F.viewer.password, 12);
  const accountLifecycleHash = await bcrypt.hash(
    F.accountLifecycle.password,
    12,
  );
  const now = new Date();

  const owner = await prisma.user.upsert({
    where: { email: F.owner.email },
    update: {
      passwordHash: ownerHash,
      name: F.owner.name,
      emailVerified: now,
      plan: F.owner.plan,
    },
    create: {
      email: F.owner.email,
      name: F.owner.name,
      passwordHash: ownerHash,
      emailVerified: now,
      plan: F.owner.plan,
    },
  });

  const viewer = await prisma.user.upsert({
    where: { email: F.viewer.email },
    update: {
      passwordHash: viewerHash,
      name: F.viewer.name,
      emailVerified: now,
      plan: F.viewer.plan,
    },
    create: {
      email: F.viewer.email,
      name: F.viewer.name,
      passwordHash: viewerHash,
      emailVerified: now,
      plan: F.viewer.plan,
    },
  });

  const editor = await prisma.user.upsert({
    where: { email: F.editor.email },
    update: {
      passwordHash: editorHash,
      name: F.editor.name,
      emailVerified: now,
      plan: F.editor.plan,
    },
    create: {
      email: F.editor.email,
      name: F.editor.name,
      passwordHash: editorHash,
      emailVerified: now,
      plan: F.editor.plan,
    },
  });

  await prisma.user.upsert({
    where: { id: F.accountLifecycle.id },
    update: {
      email: F.accountLifecycle.email,
      passwordHash: accountLifecycleHash,
      sessionInvalidatedAt: null,
      name: F.accountLifecycle.name,
      emailVerified: now,
      plan: F.accountLifecycle.plan,
    },
    create: {
      id: F.accountLifecycle.id,
      email: F.accountLifecycle.email,
      passwordHash: accountLifecycleHash,
      name: F.accountLifecycle.name,
      emailVerified: now,
      plan: F.accountLifecycle.plan,
    },
  });

  await prisma.brand.deleteMany({ where: { ownerId: editor.id } });
  await prisma.asset.deleteMany({
    where: {
      storageKey: { startsWith: `${editor.id}/` },
      documentId: null,
      workspaceId: null,
    },
  });
  await fs.rm(path.join(process.cwd(), "storage", "brand-assets", editor.id), {
    force: true,
    recursive: true,
  });

  await prisma.themePackageSnapshot.deleteMany({
    where: {
      ownerId: owner.id,
      packageId: { contains: E2E_CUSTOM_THEME_FIXTURE.slug },
    },
  });
  await prisma.brandKitDraft.deleteMany({
    where: { ownerId: owner.id, slug: E2E_CUSTOM_THEME_FIXTURE.slug },
  });

  // -------------------------------------------------------------------------
  // 2. Workspace — owned by the owner, with editor + viewer memberships so
  //    editor can mutate documents while viewer remains read-only.
  // -------------------------------------------------------------------------
  await prisma.workspace.deleteMany({
    where: {
      ownerId: { in: [owner.id, editor.id] },
      name: {
        in: [
          F.workspaceLifecycle.initialName,
          F.workspaceLifecycle.renamedName,
        ],
      },
    },
  });

  await prisma.workspace.upsert({
    where: { id: F.workspaceId },
    update: { ownerId: owner.id, name: "E2E Fixture Workspace" },
    create: {
      id: F.workspaceId,
      ownerId: owner.id,
      name: "E2E Fixture Workspace",
    },
  });

  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: { workspaceId: F.workspaceId, userId: editor.id },
    },
    update: { role: "EDITOR" },
    create: { workspaceId: F.workspaceId, userId: editor.id, role: "EDITOR" },
  });

  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: { workspaceId: F.workspaceId, userId: viewer.id },
    },
    update: { role: "VIEWER" },
    create: { workspaceId: F.workspaceId, userId: viewer.id, role: "VIEWER" },
  });

  const dashboardTag = await prisma.tag.upsert({
    where: {
      ownerId_slug: {
        ownerId: owner.id,
        slug: F.dashboardTag.slug,
      },
    },
    update: { name: F.dashboardTag.name },
    create: {
      ownerId: owner.id,
      name: F.dashboardTag.name,
      slug: F.dashboardTag.slug,
    },
  });

  const dashboardLifecycle = F.dashboardDocuments.lifecycle;
  await deleteDocuments(prisma, {
    where: {
      ownerId: owner.id,
      id: { not: dashboardLifecycle.id },
      title: {
        in: [
          `${dashboardLifecycle.title} (copy)`,
          dashboardLifecycle.renamedTitle,
        ],
      },
    },
  });

  await upsertDocumentWithCanonicalContent(prisma, {
    where: { id: F.dashboardDocuments.alphaFavorite.id },
    contentSnapshot: markdownToLexicalStateObject(
      F.dashboardDocuments.alphaFavorite.content,
    ),
    update: {
      title: F.dashboardDocuments.alphaFavorite.title,
      ownerId: owner.id,
      workspaceId: F.workspaceId,
      favorite: true,
      deletedAt: null,
      tags: { set: [] },
    },
    create: {
      id: F.dashboardDocuments.alphaFavorite.id,
      title: F.dashboardDocuments.alphaFavorite.title,
      ownerId: owner.id,
      workspaceId: F.workspaceId,
      favorite: true,
    },
  });

  await upsertDocumentWithCanonicalContent(prisma, {
    where: { id: dashboardLifecycle.id },
    contentSnapshot: markdownToLexicalStateObject(dashboardLifecycle.content),
    update: {
      title: dashboardLifecycle.title,
      ownerId: owner.id,
      workspaceId: null,
      favorite: false,
      deletedAt: null,
      tags: { set: [] },
    },
    create: {
      id: dashboardLifecycle.id,
      title: dashboardLifecycle.title,
      ownerId: owner.id,
      workspaceId: null,
      favorite: false,
    },
  });

  await upsertDocumentWithCanonicalContent(prisma, {
    where: { id: F.dashboardDocuments.betaTagged.id },
    contentSnapshot: markdownToLexicalStateObject(
      F.dashboardDocuments.betaTagged.content,
    ),
    update: {
      title: F.dashboardDocuments.betaTagged.title,
      ownerId: owner.id,
      workspaceId: F.workspaceId,
      favorite: false,
      deletedAt: null,
      tags: { set: [{ id: dashboardTag.id }] },
    },
    create: {
      id: F.dashboardDocuments.betaTagged.id,
      title: F.dashboardDocuments.betaTagged.title,
      ownerId: owner.id,
      workspaceId: F.workspaceId,
      favorite: false,
      tags: { connect: { id: dashboardTag.id } },
    },
  });

  const metadataLifecycle = F.documentMetadataLifecycle;
  await prisma.documentVersion.deleteMany({
    where: { documentId: metadataLifecycle.id },
  });
  await upsertDocumentWithCanonicalContent(prisma, {
    where: { id: metadataLifecycle.id },
    contentSnapshot: markdownToLexicalStateObject(
      metadataLifecycle.currentContent,
    ),
    update: {
      title: metadataLifecycle.title,
      ownerId: owner.id,
      workspaceId: null,
      deckJson: Prisma.DbNull,
      deckRevisionToken: null,
      isShared: false,
      shareId: null,
      slug: null,
      deletedAt: null,
      tags: { set: [] },
    },
    create: {
      id: metadataLifecycle.id,
      title: metadataLifecycle.title,
      ownerId: owner.id,
    },
  });
  await prisma.tag.deleteMany({
    where: {
      ownerId: owner.id,
      name: metadataLifecycle.tagName,
    },
  });
  await prisma.documentVersion.create({
    data: {
      id: metadataLifecycle.versionId,
      documentId: metadataLifecycle.id,
      contentJson: markdownToLexicalStateObject(
        metadataLifecycle.restoredContent,
      ) as unknown as Prisma.InputJsonValue,
      deckJson: Prisma.DbNull,
      label: metadataLifecycle.versionLabel,
      createdById: owner.id,
      createdAt: new Date("2026-04-01T12:00:00.000Z"),
    },
  });

  const commentLifecycle = F.documentCommentLifecycle;
  await prisma.commentRead.deleteMany({
    where: { documentId: commentLifecycle.id },
  });
  await prisma.comment.deleteMany({
    where: { documentId: commentLifecycle.id },
  });
  await upsertDocumentWithCanonicalContent(prisma, {
    where: { id: commentLifecycle.id },
    contentSnapshot: markdownToLexicalStateObject(commentLifecycle.content),
    update: {
      title: commentLifecycle.title,
      ownerId: owner.id,
      workspaceId: F.workspaceId,
      deckJson: Prisma.DbNull,
      deckRevisionToken: null,
      isShared: false,
      shareId: null,
      slug: null,
      deletedAt: null,
      tags: { set: [] },
    },
    create: {
      id: commentLifecycle.id,
      title: commentLifecycle.title,
      ownerId: owner.id,
      workspaceId: F.workspaceId,
    },
  });

  const shareLifecycle = F.documentShareLifecycle;
  await upsertDocumentWithCanonicalContent(prisma, {
    where: { id: shareLifecycle.id },
    contentSnapshot: markdownToLexicalStateObject(shareLifecycle.content),
    update: {
      title: shareLifecycle.title,
      ownerId: owner.id,
      workspaceId: null,
      deckJson: Prisma.DbNull,
      deckRevisionToken: null,
      isShared: false,
      shareId: null,
      slug: null,
      shareExpiresAt: null,
      shareEmbedEnabled: true,
      sharePresentEnabled: true,
      sharePasscodeHash: null,
      shareMetadataMode: "generic",
      shareDiscoverable: false,
      deletedAt: null,
      tags: { set: [] },
    },
    create: {
      id: shareLifecycle.id,
      title: shareLifecycle.title,
      ownerId: owner.id,
      shareEmbedEnabled: true,
      sharePresentEnabled: true,
      shareMetadataMode: "generic",
      shareDiscoverable: false,
    },
  });

  // -------------------------------------------------------------------------
  // 3. Visual — embedded into the document's contentJson as a VisualNode.
  // -------------------------------------------------------------------------
  const visual = buildE2EProfileVisual();
  const parsedVisual = safeParseVisual(visual);
  if (!parsedVisual.success) {
    throw new Error(`Fixture visual failed validation: ${parsedVisual.error}`);
  }
  const visualData = parsedVisual.data as unknown as Prisma.InputJsonValue;

  // -------------------------------------------------------------------------
  // 4. Slide asset — write bytes + create/refresh the Asset row.
  // -------------------------------------------------------------------------
  const pngBytes = fixturePngBuffer();
  const checksum = fixtureAssetChecksum(pngBytes);
  const storageKey = deriveStorageKey(F.documentId, checksum, "image/png");
  await writeAssetBytes(storageKey, pngBytes);
  const assetUrl = `/api/slide-assets/${storageKey}`;

  // -------------------------------------------------------------------------
  // 5. Document — create/refresh with share policy, contentJson, and deckJson.
  //    Done in two steps so the embedded visual id is stable and the Asset can
  //    be linked to the document.
  // -------------------------------------------------------------------------
  const contentJson = buildE2EProfileContentJson(
    parsedVisual.data,
  ) as unknown as Prisma.InputJsonValue;

  await upsertDocumentWithCanonicalContent(prisma, {
    where: { id: F.documentId },
    contentSnapshot: contentJson,
    update: {
      title: F.documentTitle,
      ownerId: owner.id,
      workspaceId: F.workspaceId,
      shareId: F.shareId,
      slug: F.slug,
      isShared: true,
      shareEmbedEnabled: true,
      sharePresentEnabled: true,
      shareExpiresAt: null,
      sharePasscodeHash: null,
      shareMetadataMode: "generic",
      shareDiscoverable: false,
      deletedAt: null,
      tags: { set: [{ id: dashboardTag.id }] },
    },
    create: {
      id: F.documentId,
      title: F.documentTitle,
      ownerId: owner.id,
      workspaceId: F.workspaceId,
      shareId: F.shareId,
      slug: F.slug,
      isShared: true,
      shareEmbedEnabled: true,
      sharePresentEnabled: true,
      tags: { connect: { id: dashboardTag.id } },
    },
  });

  // Visual row (derived projection of the embedded VisualNode).
  await prisma.visual.upsert({
    where: { id: F.visualId },
    update: {
      documentId: F.documentId,
      type: VISUAL_KIND_TO_PRISMA[parsedVisual.data.type],
      title: parsedVisual.data.title ?? null,
      data: visualData,
    },
    create: {
      id: F.visualId,
      documentId: F.documentId,
      type: VISUAL_KIND_TO_PRISMA[parsedVisual.data.type],
      title: parsedVisual.data.title ?? null,
      data: visualData,
    },
  });

  const asset = await prisma.asset.upsert({
    where: { storageKey },
    update: {
      documentId: F.documentId,
      workspaceId: F.workspaceId,
      mimeType: "image/png",
      byteSize: pngBytes.byteLength,
      checksum,
      originalName: "fixture.png",
      deletedAt: null,
    },
    create: {
      documentId: F.documentId,
      workspaceId: F.workspaceId,
      mimeType: "image/png",
      byteSize: pngBytes.byteLength,
      checksum,
      storageKey,
      originalName: "fixture.png",
    },
    select: { id: true },
  });

  // Persist the deck once the asset id is known so the ImageNode carries a real
  // `assetId`. Validate through the presentation parser and open boundary so a broken
  // fixture fails loudly before it is written to Document.deckJson.
  const rawDeck = buildE2EProfileDeck(assetUrl, asset.id);
  const parsedDeck = safeParseDeck(rawDeck);
  if (!parsedDeck.success) {
    throw new Error(
      `Fixture deck failed presentation validation: ${parsedDeck.errors.join("; ")}`,
    );
  }
  const openedDeck = openDeckFromJson(parsedDeck.data);
  if (!openedDeck.ok) {
    throw new Error(`Fixture deck failed open boundary: ${openedDeck.error}`);
  }
  const deck = openedDeck.deck;
  await updateDocumentMetadata(prisma, {
    where: { id: F.documentId },
    data: {
      deckJson: deck as unknown as Prisma.InputJsonValue,
      deckRevisionToken: F.deckRevisionToken,
    },
  });

  const versionedThemePackages = [
    {
      ...clarityPackageJson,
      id: E2E_VERSIONED_THEME_FIXTURE.packageId,
      version: E2E_VERSIONED_THEME_FIXTURE.activeVersion,
      name: E2E_VERSIONED_THEME_FIXTURE.activeName,
    },
    {
      ...clarityPackageJson,
      id: E2E_VERSIONED_THEME_FIXTURE.packageId,
      version: E2E_VERSIONED_THEME_FIXTURE.latestVersion,
      name: E2E_VERSIONED_THEME_FIXTURE.latestName,
    },
  ].map((candidate) => {
    const validated = validateThemePackage(candidate);
    if (!validated.valid) {
      throw new Error(
        `Versioned theme fixture failed validation: ${validated.diagnostics
          .map((diagnostic) => diagnostic.message)
          .join("; ")}`,
      );
    }
    return validated.package;
  });
  for (const [index, themePackage] of versionedThemePackages.entries()) {
    await prisma.themePackageSnapshot.upsert({
      where: {
        packageId_packageVersion: {
          packageId: themePackage.id,
          packageVersion: themePackage.version,
        },
      },
      update: {
        ownerId: owner.id,
        workspaceId: F.workspaceId,
        publishedById: owner.id,
        packageJson: themePackage as unknown as Prisma.InputJsonValue,
        createdAt: new Date(
          index === 0 ? "2026-01-01T00:00:00.000Z" : "2026-02-01T00:00:00.000Z",
        ),
      },
      create: {
        packageId: themePackage.id,
        packageVersion: themePackage.version,
        ownerId: owner.id,
        workspaceId: F.workspaceId,
        publishedById: owner.id,
        packageJson: themePackage as unknown as Prisma.InputJsonValue,
        createdAt: new Date(
          index === 0 ? "2026-01-01T00:00:00.000Z" : "2026-02-01T00:00:00.000Z",
        ),
      },
    });
  }

  const conflictThemeValidation = validateThemePackage({
    ...clarityPackageJson,
    id: E2E_CONFLICT_OWNER_THEME_FIXTURE.packageId,
    version: E2E_CONFLICT_OWNER_THEME_FIXTURE.version,
    name: E2E_CONFLICT_OWNER_THEME_FIXTURE.name,
    tokens: {
      ...clarityPackageJson.tokens,
      colors: {
        ...clarityPackageJson.tokens.colors,
        canvas: {
          ...clarityPackageJson.tokens.colors.canvas,
          fill: E2E_CONFLICT_OWNER_THEME_FIXTURE.canvasFill,
        },
      },
    },
  });
  if (!conflictThemeValidation.valid) {
    throw new Error(
      `Conflict theme fixture failed validation: ${conflictThemeValidation.diagnostics
        .map((diagnostic) => diagnostic.message)
        .join("; ")}`,
    );
  }
  await prisma.themePackageSnapshot.upsert({
    where: {
      packageId_packageVersion: {
        packageId: conflictThemeValidation.package.id,
        packageVersion: conflictThemeValidation.package.version,
      },
    },
    update: {
      ownerId: owner.id,
      workspaceId: null,
      publishedById: owner.id,
      packageJson:
        conflictThemeValidation.package as unknown as Prisma.InputJsonValue,
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
    },
    create: {
      packageId: conflictThemeValidation.package.id,
      packageVersion: conflictThemeValidation.package.version,
      ownerId: owner.id,
      workspaceId: null,
      publishedById: owner.id,
      packageJson:
        conflictThemeValidation.package as unknown as Prisma.InputJsonValue,
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
    },
  });

  const presentationFixtures = configuredPresentationTestFixtures();
  const activePresentationDocumentIds = presentationFixtures.map(
    (fixture) => fixture.documentId,
  );
  const staleFixtureCleanup = await cleanupStaleE2EPresentationFixtures(
    prisma,
    {
      workspaceId: F.workspaceId,
      ownerId: owner.id,
      activeDocumentIds: activePresentationDocumentIds,
    },
  );
  const assetRoot = path.resolve(process.cwd(), "storage", "slide-assets");
  const staleAssetDirectoryIds = new Set(staleFixtureCleanup.staleDocumentIds);
  for (const storageKey of staleFixtureCleanup.deletedAssetStorageKeys) {
    const documentId = documentIdFromE2EPresentationAssetStorageKey(storageKey);
    if (!documentId) {
      console.warn(
        `Skipped unsafe E2E asset storage key cleanup: ${storageKey}`,
      );
      continue;
    }
    staleAssetDirectoryIds.add(documentId);
  }
  await Promise.all(
    [...staleAssetDirectoryIds].map((documentId) =>
      removeE2EPresentationAssetDirectory(assetRoot, documentId),
    ),
  );

  for (const fixture of presentationFixtures) {
    const isolatedStorageKey = deriveStorageKey(
      fixture.documentId,
      checksum,
      "image/png",
    );
    await writeAssetBytes(isolatedStorageKey, pngBytes);

    await upsertDocumentWithCanonicalContent(prisma, {
      where: { id: fixture.documentId },
      contentSnapshot:
        fixture.deckKind === "generated"
          ? buildE2EGeneratedPresentationContentJson()
          : contentJson,
      update: {
        title: `Isolated presentation fixture: ${fixture.slug}`,
        ownerId: owner.id,
        workspaceId: F.workspaceId,
        shareId: fixture.shareId,
        slug: fixture.slug,
        isShared: true,
        shareEmbedEnabled: true,
        sharePresentEnabled: true,
        shareExpiresAt: null,
        deletedAt: null,
        tags: { set: [{ id: dashboardTag.id }] },
      },
      create: {
        id: fixture.documentId,
        title: `Isolated presentation fixture: ${fixture.slug}`,
        ownerId: owner.id,
        workspaceId: F.workspaceId,
        shareId: fixture.shareId,
        slug: fixture.slug,
        isShared: true,
        shareEmbedEnabled: true,
        sharePresentEnabled: true,
        tags: { connect: { id: dashboardTag.id } },
      },
    });

    const isolatedAsset = await prisma.asset.upsert({
      where: { storageKey: isolatedStorageKey },
      update: {
        documentId: fixture.documentId,
        workspaceId: F.workspaceId,
        mimeType: "image/png",
        byteSize: pngBytes.byteLength,
        checksum,
        originalName: E2E_PRESENTATION_ASSET_ORIGINAL_NAME,
        deletedAt: null,
      },
      create: {
        documentId: fixture.documentId,
        workspaceId: F.workspaceId,
        mimeType: "image/png",
        byteSize: pngBytes.byteLength,
        checksum,
        storageKey: isolatedStorageKey,
        originalName: E2E_PRESENTATION_ASSET_ORIGINAL_NAME,
      },
      select: { id: true },
    });
    const isolatedAssetUrl = `/api/slide-assets/${isolatedStorageKey}`;
    const isolatedDeck =
      fixture.deckKind === "arrange"
        ? buildE2EMultiSelectArrangeDeck()
        : fixture.deckKind === "guides"
          ? buildE2EPrecisionGuidesDeck()
          : fixture.deckKind === "touch"
            ? buildE2ETouchControlsDeck()
            : fixture.deckKind === "overlap"
              ? buildE2EOverlapSelectionDeck()
              : fixture.deckKind === "group"
                ? buildE2EGroupLayerOrderDeck()
                : fixture.deckKind === "sourceLinked"
                  ? buildE2ESourceLinkedDeck(
                      isolatedAssetUrl,
                      isolatedAsset.id,
                      fixture.documentId,
                    )
                  : buildE2EProfileDeck(isolatedAssetUrl, isolatedAsset.id);
    if (fixture.deckKind === "themeVersions") {
      isolatedDeck.theme = {
        ...isolatedDeck.theme,
        packageId: E2E_VERSIONED_THEME_FIXTURE.packageId,
        packageVersion: E2E_VERSIONED_THEME_FIXTURE.activeVersion,
      };
    }
    const parsedIsolatedDeck = safeParseDeck(isolatedDeck);
    if (!parsedIsolatedDeck.success) {
      throw new Error(
        `Isolated fixture deck failed validation: ${parsedIsolatedDeck.errors.join("; ")}`,
      );
    }
    await updateDocumentMetadata(prisma, {
      where: { id: fixture.documentId },
      data: {
        deckJson:
          fixture.deckKind === "generated"
            ? Prisma.DbNull
            : (parsedIsolatedDeck.data as unknown as Prisma.InputJsonValue),
        deckRevisionToken:
          fixture.deckKind === "generated" ? null : fixture.deckRevisionToken,
      },
    });
  }

  // -------------------------------------------------------------------------
  // 5b. Dedicated presentation layout screenshot document.
  // -------------------------------------------------------------------------
  const rawLayoutDeck = buildE2EProfileDeckFixture();
  const parsedLayoutDeck = safeParseDeck(rawLayoutDeck);
  if (!parsedLayoutDeck.success) {
    throw new Error(
      `Fixture presentation layout deck failed validation: ${parsedLayoutDeck.errors.join("; ")}`,
    );
  }
  const layoutContentJson = buildE2EProfileContentJson(
    parsedVisual.data,
  ) as unknown as Prisma.InputJsonValue;

  await upsertDocumentWithCanonicalContent(prisma, {
    where: { id: F.layoutDocumentId },
    contentSnapshot: layoutContentJson,
    update: {
      title: F.layoutDocumentTitle,
      deckJson: parsedLayoutDeck.data as unknown as Prisma.InputJsonValue,
      deckRevisionToken: F.layoutDeckRevisionToken,
      ownerId: owner.id,
      workspaceId: F.workspaceId,
      shareId: null,
      slug: null,
      isShared: false,
      shareEmbedEnabled: false,
      sharePresentEnabled: false,
      shareExpiresAt: null,
      deletedAt: null,
      tags: { set: [{ id: dashboardTag.id }] },
    },
    create: {
      id: F.layoutDocumentId,
      title: F.layoutDocumentTitle,
      deckJson: parsedLayoutDeck.data as unknown as Prisma.InputJsonValue,
      deckRevisionToken: F.layoutDeckRevisionToken,
      ownerId: owner.id,
      workspaceId: F.workspaceId,
      shareId: null,
      slug: null,
      isShared: false,
      shareEmbedEnabled: false,
      sharePresentEnabled: false,
      tags: { connect: { id: dashboardTag.id } },
    },
  });

  // 5c. PRIVATE document + asset — never shared. Used to assert that anonymous
  //     and unrelated requests to a private slide asset are denied (403/404),
  //     in contrast to the shared document above.
  // -------------------------------------------------------------------------
  const privateStorageKey = deriveStorageKey(
    F.privateDocumentId,
    checksum,
    "image/png",
  );
  await writeAssetBytes(privateStorageKey, pngBytes);

  await upsertDocumentWithCanonicalContent(prisma, {
    where: { id: F.privateDocumentId },
    contentSnapshot: markdownToLexicalStateObject(
      "Private fixture document (never shared).",
    ),
    update: {
      title: "E2E Private Fixture",
      ownerId: owner.id,
      workspaceId: null,
      isShared: false,
      shareId: null,
      slug: null,
      deletedAt: null,
    },
    create: {
      id: F.privateDocumentId,
      title: "E2E Private Fixture",
      ownerId: owner.id,
      isShared: false,
    },
  });

  await prisma.asset.upsert({
    where: { storageKey: privateStorageKey },
    update: {
      documentId: F.privateDocumentId,
      workspaceId: null,
      mimeType: "image/png",
      byteSize: pngBytes.byteLength,
      checksum,
      originalName: "fixture.png",
      deletedAt: null,
    },
    create: {
      documentId: F.privateDocumentId,
      mimeType: "image/png",
      byteSize: pngBytes.byteLength,
      checksum,
      storageKey: privateStorageKey,
      originalName: "fixture.png",
    },
  });

  // -------------------------------------------------------------------------
  // 6. Emit the fixture descriptor for transparency / debugging.
  // -------------------------------------------------------------------------
  const fixtureOut = buildE2EProfileFixtureDescriptor({
    assetId: asset.id,
    assetPath: assetUrl,
    privateAssetPath: `/api/slide-assets/${privateStorageKey}`,
    seededAt: now.toISOString(),
  });
  await fs.writeFile(
    path.join(process.cwd(), "e2e", ".e2e-fixture.json"),
    `${JSON.stringify(fixtureOut, null, 2)}\n`,
  );

  console.log(
    `Seeded E2E profile: owner "${owner.email}", editor "${editor.email}", viewer "${viewer.email}", ` +
      `document "${F.documentId}" (share ${F.shareId}, slug ${F.slug}), ` +
      `asset ${asset.id} (${pngBytes.byteLength} bytes at ${storageKey}). ` +
      `Fixture written to e2e/.e2e-fixture.json.`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
