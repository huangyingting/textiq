import { expect, test, type Locator, type Page } from "@playwright/test";

import { login } from "../helpers/auth";
import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileOwnerCredentials,
} from "../helpers/profile";
import { waitForDocumentEditorReady } from "../helpers/readiness";

function tagsGroup(page: Page): Locator {
  return page.getByRole("group", { name: "Tags" });
}

function versionRow(panel: Locator, label: string): Locator {
  return panel.locator("li").filter({ hasText: label }).first();
}

function removeTagButton(page: Page, name: string): Locator {
  return tagsGroup(page).getByRole("button", { name: `Remove tag ${name}` });
}

async function addTag(page: Page, name: string): Promise<void> {
  const group = tagsGroup(page);
  const input = group.getByLabel("Add a tag");
  await input.fill(`  ${name}  `);
  await input.press("Enter");
  await expect(removeTagButton(page, name)).toBeVisible({
    timeout: 20_000,
  });
  await expect(input).toHaveValue("");
}

async function openVersionHistory(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Version history" }).click();
  const panel = page.getByRole("dialog", { name: "Version history" });
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("UI matrix: document metadata and history", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run document metadata/history coverage",
  );
  test.setTimeout(150_000);

  test("tags persist and version restore remains reversible after reload", async ({
    page,
  }) => {
    const fixture = E2E_PROFILE_FIXTURE.documentMetadataLifecycle;
    const documentPath = `/app/documents/${fixture.id}`;
    await login(page, profileOwnerCredentials(), documentPath);

    let editor = await waitForDocumentEditorReady(page);
    await expect(editor.getByText(fixture.currentContent)).toBeVisible();
    await expect(editor.getByText(fixture.restoredContent)).toHaveCount(0);

    await addTag(page, fixture.tagName);
    await page.reload();
    editor = await waitForDocumentEditorReady(page);
    await expect(removeTagButton(page, fixture.tagName)).toBeVisible();

    await removeTagButton(page, fixture.tagName).click();
    await expect(removeTagButton(page, fixture.tagName)).toHaveCount(0);
    await page.reload();
    editor = await waitForDocumentEditorReady(page);
    await expect(removeTagButton(page, fixture.tagName)).toHaveCount(0);

    await addTag(page, fixture.tagName);
    let history = await openVersionHistory(page);
    const baseline = versionRow(history, fixture.versionLabel);
    await expect(baseline).toContainText("E2E Owner");
    await baseline
      .getByRole("button", { name: "Restore this version" })
      .click();
    await expect(
      baseline.getByRole("button", { name: "Confirm restore" }),
    ).toBeVisible();
    await baseline.getByRole("button", { name: "Cancel restore" }).click();
    await expect(
      baseline.getByRole("button", { name: "Restore this version" }),
    ).toBeVisible();
    await expect(editor.getByText(fixture.currentContent)).toBeVisible();

    await baseline
      .getByRole("button", { name: "Restore this version" })
      .click();
    await baseline.getByRole("button", { name: "Confirm restore" }).click();
    await expect(history).toHaveCount(0);
    await expect(editor.getByText(fixture.restoredContent)).toBeVisible({
      timeout: 20_000,
    });
    await expect(editor.getByText(fixture.currentContent)).toHaveCount(0);

    await page.reload();
    editor = await waitForDocumentEditorReady(page);
    await expect(editor.getByText(fixture.restoredContent)).toBeVisible();
    await expect(editor.getByText(fixture.currentContent)).toHaveCount(0);
    await expect(removeTagButton(page, fixture.tagName)).toBeVisible();

    history = await openVersionHistory(page);
    const checkpoint = versionRow(history, "Before restore");
    await expect(checkpoint).toContainText("E2E Owner");
    await checkpoint
      .getByRole("button", { name: "Restore this version" })
      .click();
    await checkpoint.getByRole("button", { name: "Confirm restore" }).click();
    await expect(history).toHaveCount(0);
    await expect(editor.getByText(fixture.currentContent)).toBeVisible({
      timeout: 20_000,
    });

    await page.reload();
    editor = await waitForDocumentEditorReady(page);
    await expect(editor.getByText(fixture.currentContent)).toBeVisible();
    await expect(editor.getByText(fixture.restoredContent)).toHaveCount(0);
    await removeTagButton(page, fixture.tagName).click();
    await expect(removeTagButton(page, fixture.tagName)).toHaveCount(0);
    await page.reload();
    await waitForDocumentEditorReady(page);
    await expect(removeTagButton(page, fixture.tagName)).toHaveCount(0);
  });
});
