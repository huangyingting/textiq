/**
 * Deterministic E2E coverage for durable document block ids (#435).
 *
 * The authenticated account export is the persistence diagnostic: it exposes
 * the same owner-scoped contentJson/deckJson snapshots users can download from
 * Settings, so these assertions do not depend on a test-only API or database
 * access. The workflow verifies editor DOM hydration, autosave/reload, slide
 * source insertion, and duplicate-document remapping through real UI actions.
 */

import { expect, test, type Page } from "@playwright/test";

import { login } from "../helpers/auth";
import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileDocPath,
  profileOwnerCredentials,
} from "../helpers/profile";
import { presentationTestFixture } from "../helpers/presentation-fixtures";
import {
  waitForDocumentAutosaveAfter,
  waitForDocumentEditorReady,
  waitForSlideAutosave,
  waitForSlideAutosaveAfter,
  waitForStableSlideStage,
} from "../helpers/readiness";

const FIXTURE_NAME = "blockIdPreservation" as const;

type JsonRecord = Record<string, unknown>;

type ExportDocumentSnapshot = {
  id: string;
  title: string;
  contentJson: unknown;
  deckJson: unknown;
};

type DeckSourceRef = {
  nodeId: string;
  documentId?: string;
  blockId: string;
  blockKind?: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExportDocument(value: unknown): value is ExportDocumentSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    "contentJson" in value &&
    "deckJson" in value
  );
}

async function loadOwnerDocuments(
  page: Page,
): Promise<ExportDocumentSnapshot[]> {
  const response = await page.request.get("/api/account/export");
  expect(response.ok()).toBe(true);
  const payload: unknown = await response.json();
  expect(isRecord(payload) && Array.isArray(payload.documents)).toBe(true);
  if (!isRecord(payload) || !Array.isArray(payload.documents)) return [];
  const documents = payload.documents.filter(isExportDocument);
  expect(documents).toHaveLength(payload.documents.length);
  return documents;
}

async function loadOwnerDocument(
  page: Page,
  documentId: string,
): Promise<ExportDocumentSnapshot> {
  const document = (await loadOwnerDocuments(page)).find(
    (candidate) => candidate.id === documentId,
  );
  expect(
    document,
    `Expected account export document ${documentId}`,
  ).toBeDefined();
  return document!;
}

function serializedNodeText(value: unknown): string {
  if (Array.isArray(value)) return value.map(serializedNodeText).join("");
  if (!isRecord(value)) return "";
  if (value.type === "text" && typeof value.text === "string") {
    return value.text;
  }
  return serializedNodeText(value.children);
}

function findContentBlockByText(
  value: unknown,
  expectedText: string,
): JsonRecord | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findContentBlockByText(item, expectedText);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (
    typeof value.bid === "string" &&
    serializedNodeText(value).includes(expectedText)
  ) {
    return value;
  }
  for (const child of Object.values(value)) {
    const found = findContentBlockByText(child, expectedText);
    if (found) return found;
  }
  return undefined;
}

function collectBlockIds(value: unknown, ids: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectBlockIds(item, ids);
    return ids;
  }
  if (!isRecord(value)) return ids;
  if (typeof value.bid === "string" && value.bid.length > 0) {
    ids.push(value.bid);
  }
  for (const child of Object.values(value)) collectBlockIds(child, ids);
  return ids;
}

function collectDeckSourceRefs(
  value: unknown,
  refs: DeckSourceRef[] = [],
): DeckSourceRef[] {
  if (Array.isArray(value)) {
    for (const item of value) collectDeckSourceRefs(item, refs);
    return refs;
  }
  if (!isRecord(value)) return refs;
  const source = value.source;
  if (
    typeof value.id === "string" &&
    isRecord(source) &&
    typeof source.blockId === "string" &&
    source.blockId.length > 0
  ) {
    refs.push({
      nodeId: value.id,
      blockId: source.blockId,
      ...(typeof source.documentId === "string"
        ? { documentId: source.documentId }
        : {}),
      ...(typeof source.blockKind === "string"
        ? { blockKind: source.blockKind }
        : {}),
    });
  }
  for (const child of Object.values(value)) collectDeckSourceRefs(child, refs);
  return refs;
}

function fixtureDocumentId(): string {
  return presentationTestFixture(FIXTURE_NAME, test.info()).documentId;
}

test.describe("Block-id preservation", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e)",
  );
  test.setTimeout(180_000);

  test("block bids survive edit, autosave, and reload", async ({ page }) => {
    const documentId = fixtureDocumentId();
    await login(
      page,
      profileOwnerCredentials(),
      profileDocPath(FIXTURE_NAME, test.info()),
    );
    const body = await waitForDocumentEditorReady(page);

    const initialParagraph = body
      .locator("[data-lexical-block-id]")
      .filter({ hasText: E2E_PROFILE_FIXTURE.documentBodyText })
      .first();
    await expect(initialParagraph).toBeVisible();
    const initialBid = await initialParagraph.getAttribute(
      "data-lexical-block-id",
    );
    expect(initialBid).toBe(E2E_PROFILE_FIXTURE.documentBodyBlockId);

    const persistedBefore = await loadOwnerDocument(page, documentId);
    const persistedBlockBefore = findContentBlockByText(
      persistedBefore.contentJson,
      E2E_PROFILE_FIXTURE.documentBodyText,
    );
    expect(persistedBlockBefore?.bid).toBe(initialBid);

    const editMarker = " [block-id preserved]";
    await waitForDocumentAutosaveAfter(page, async () => {
      await initialParagraph.click();
      await page.keyboard.press("End");
      await page.keyboard.type(editMarker);
    });

    await page.reload();
    const reloadedBody = await waitForDocumentEditorReady(page);
    const reloadedParagraph = reloadedBody.locator(
      `[data-lexical-block-id="${initialBid}"]`,
    );
    await expect(reloadedParagraph).toContainText(
      `${E2E_PROFILE_FIXTURE.documentBodyText}${editMarker}`,
    );

    const persistedAfter = await loadOwnerDocument(page, documentId);
    const persistedBlockAfter = findContentBlockByText(
      persistedAfter.contentJson,
      editMarker,
    );
    expect(persistedBlockAfter?.bid).toBe(initialBid);
  });

  test("inserted document source persists the originating block bid", async ({
    page,
  }) => {
    const documentId = fixtureDocumentId();
    await login(
      page,
      profileOwnerCredentials(),
      `${profileDocPath(FIXTURE_NAME, test.info())}/slides`,
    );
    const editor = page.locator('[data-slide-editor="true"]').first();
    await expect(editor).toBeVisible({ timeout: 60_000 });
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );
    await waitForSlideAutosave(page);

    const persistedBefore = await loadOwnerDocument(page, documentId);
    const sourceBlock = findContentBlockByText(
      persistedBefore.contentJson,
      E2E_PROFILE_FIXTURE.documentBodyText,
    );
    expect(sourceBlock?.bid).toBe(E2E_PROFILE_FIXTURE.documentBodyBlockId);
    const sourceNodeIdsBefore = new Set(
      collectDeckSourceRefs(persistedBefore.deckJson).map((ref) => ref.nodeId),
    );

    await editor
      .locator('[data-slide-stage-viewport="true"]')
      .click({ position: { x: 5, y: 5 } });
    const contextToolbar = page.getByRole("toolbar", {
      name: "Context toolbar",
    });
    await expect(contextToolbar).toBeVisible();
    await contextToolbar.getByRole("button", { name: "From document" }).click();
    const fromDocumentMenu = page.getByRole("menu", {
      name: "Insert from document",
    });
    const sourceItem = fromDocumentMenu
      .getByRole("menuitem")
      .filter({ hasText: E2E_PROFILE_FIXTURE.documentBodyText })
      .first();
    await expect(sourceItem).toBeVisible();

    await waitForSlideAutosaveAfter(page, () => sourceItem.click());

    const persistedAfter = await loadOwnerDocument(page, documentId);
    const insertedRefs = collectDeckSourceRefs(persistedAfter.deckJson).filter(
      (ref) => !sourceNodeIdsBefore.has(ref.nodeId),
    );
    expect(insertedRefs).toEqual([
      expect.objectContaining({
        documentId,
        blockId: sourceBlock?.bid,
        blockKind: "text",
      }),
    ]);
  });

  test("duplicate document gets independent block ids and remapped source refs", async ({
    page,
  }) => {
    const documentId = fixtureDocumentId();
    await login(page, profileOwnerCredentials());

    const documentsBefore = await loadOwnerDocuments(page);
    const original = documentsBefore.find(
      (document) => document.id === documentId,
    );
    expect(original).toBeDefined();
    const idsBefore = new Set(documentsBefore.map((document) => document.id));

    const actionsButton = page.getByRole("button", {
      name: `Actions for ${original!.title}`,
    });
    await expect(actionsButton).toBeVisible({ timeout: 60_000 });
    await actionsButton.click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();

    let duplicate: ExportDocumentSnapshot | undefined;
    await expect
      .poll(
        async () => {
          duplicate = (await loadOwnerDocuments(page)).find(
            (document) =>
              !idsBefore.has(document.id) &&
              document.title === `${original!.title} (copy)`,
          );
          return duplicate?.id ?? "";
        },
        { timeout: 30_000 },
      )
      .not.toBe("");

    const originalBids = collectBlockIds(original!.contentJson);
    const duplicateBids = collectBlockIds(duplicate!.contentJson);
    expect(originalBids.length).toBeGreaterThan(0);
    expect(duplicateBids).toHaveLength(originalBids.length);
    expect(duplicateBids.every((bid) => !new Set(originalBids).has(bid))).toBe(
      true,
    );

    const originalSourceRefs = collectDeckSourceRefs(original!.deckJson);
    const duplicateSourceRefs = collectDeckSourceRefs(duplicate!.deckJson);
    expect(originalSourceRefs.length).toBeGreaterThan(0);
    expect(duplicateSourceRefs).toHaveLength(originalSourceRefs.length);
    expect(
      duplicateSourceRefs.every(
        (source) =>
          source.documentId === duplicate!.id &&
          duplicateBids.includes(source.blockId) &&
          !originalBids.includes(source.blockId),
      ),
    ).toBe(true);

    await page.goto("/app");
    const duplicateCard = page
      .locator(`a[href="/app/documents/${duplicate!.id}"]`)
      .first()
      .locator("xpath=ancestor::li[1]");
    await expect(duplicateCard).toBeVisible();
    await duplicateCard
      .getByRole("button", { name: `Actions for ${duplicate!.title}` })
      .click();
    await duplicateCard.getByRole("menuitem", { name: "Delete" }).click();
    const deleteDialog = page.getByRole("dialog", { name: /delete document/i });
    await deleteDialog.getByRole("button", { name: /^delete$/i }).click();
    await expect
      .poll(
        async () =>
          (await loadOwnerDocuments(page)).some(
            (document) => document.id === duplicate!.id,
          ),
        { timeout: 30_000 },
      )
      .toBe(false);
  });
});
