import {
  expect,
  test,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";

import { login } from "../helpers/auth";
import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileOwnerCredentials,
} from "../helpers/profile";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function documentLink(page: Page, title: string): Locator {
  return page
    .getByRole("link", { name: new RegExp(escapeRegExp(title), "i") })
    .first();
}

function dashboardActionResponse(response: Response): boolean {
  return (
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/app"
  );
}

function trashActionResponse(response: Response): boolean {
  return (
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/app/trash"
  );
}

async function runServerAction({
  page,
  matches,
  action,
}: {
  page: Page;
  matches: (response: Response) => boolean;
  action: () => Promise<void>;
}): Promise<Response> {
  const responsePromise = page.waitForResponse(matches);
  await action();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  return response;
}

async function runImmediateDeleteUndo(
  page: Page,
  action: () => Promise<void>,
): Promise<void> {
  let resolveResponses!: (responses: Response[]) => void;
  let rejectResponses!: (error: Error) => void;
  const responses: Response[] = [];
  const completion = new Promise<Response[]>((resolve, reject) => {
    resolveResponses = resolve;
    rejectResponses = reject;
  });
  const timeout = setTimeout(() => {
    rejectResponses(
      new Error("Timed out waiting for delete and immediate undo actions."),
    );
  }, 30_000);
  const onResponse = (response: Response) => {
    if (!dashboardActionResponse(response)) return;
    responses.push(response);
    if (responses.length === 2) resolveResponses(responses);
  };
  page.on("response", onResponse);

  try {
    await action();
    for (const response of await completion) {
      expect(response.ok()).toBe(true);
    }
  } finally {
    clearTimeout(timeout);
    page.off("response", onResponse);
  }
}

async function openDocumentActions(
  page: Page,
  title: string,
): Promise<Locator> {
  await page
    .getByRole("button", {
      name: new RegExp(`Actions for ${escapeRegExp(title)}`, "i"),
    })
    .click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

test.describe("UI matrix: dashboard document lifecycle", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run dashboard lifecycle coverage",
  );
  test.setTimeout(120_000);

  test("favorite, duplicate, rename, undo, trash restore, and permanent delete persist", async ({
    page,
  }) => {
    const fixture = E2E_PROFILE_FIXTURE.dashboardDocuments.lifecycle;
    const copyTitle = `${fixture.title} (copy)`;

    await login(page, profileOwnerCredentials());
    await expect(
      page.getByRole("heading", { name: /your documents/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(documentLink(page, fixture.title)).toBeVisible();

    await runServerAction({
      page,
      matches: dashboardActionResponse,
      action: () =>
        page.getByRole("button", { name: `Favorite ${fixture.title}` }).click(),
    });
    await expect(
      page.getByRole("button", { name: `Unfavorite ${fixture.title}` }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(
      page.getByRole("button", { name: `Unfavorite ${fixture.title}` }),
    ).toHaveAttribute("aria-pressed", "true");

    await runServerAction({
      page,
      matches: dashboardActionResponse,
      action: () =>
        page
          .getByRole("button", { name: `Unfavorite ${fixture.title}` })
          .click(),
    });
    await page.reload();
    await expect(
      page.getByRole("button", { name: `Favorite ${fixture.title}` }),
    ).toHaveAttribute("aria-pressed", "false");

    const sourceHref = await documentLink(page, fixture.title).getAttribute(
      "href",
    );
    const sourceMenu = await openDocumentActions(page, fixture.title);
    await runServerAction({
      page,
      matches: dashboardActionResponse,
      action: () =>
        sourceMenu.getByRole("menuitem", { name: "Duplicate" }).click(),
    });
    const copyLink = documentLink(page, copyTitle);
    await expect(copyLink).toBeVisible({ timeout: 20_000 });
    expect(await copyLink.getAttribute("href")).not.toBe(sourceHref);

    const copyMenu = await openDocumentActions(page, copyTitle);
    await copyMenu.getByRole("menuitem", { name: "Rename" }).click();
    const renameDialog = page.getByRole("dialog", { name: "Rename document" });
    await renameDialog.getByLabel("Document title").fill(fixture.renamedTitle);
    await runServerAction({
      page,
      matches: dashboardActionResponse,
      action: () =>
        renameDialog.getByRole("button", { name: "Rename" }).click(),
    });
    await expect(documentLink(page, fixture.renamedTitle)).toBeVisible();
    await expect(documentLink(page, copyTitle)).toHaveCount(0);
    await page.reload();
    await expect(documentLink(page, fixture.renamedTitle)).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/app\/documents\/[^/]+$/),
      documentLink(page, fixture.renamedTitle).click(),
    ]);
    await expect(page.getByText(fixture.content, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.goBack();
    await expect(documentLink(page, fixture.renamedTitle)).toBeVisible({
      timeout: 30_000,
    });

    let lifecycleMenu = await openDocumentActions(page, fixture.renamedTitle);
    await lifecycleMenu.getByRole("menuitem", { name: "Delete" }).click();
    let deleteDialog = page.getByRole("dialog", { name: "Delete document?" });
    await deleteDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(documentLink(page, fixture.renamedTitle)).toBeVisible();

    lifecycleMenu = await openDocumentActions(page, fixture.renamedTitle);
    await lifecycleMenu.getByRole("menuitem", { name: "Delete" }).click();
    deleteDialog = page.getByRole("dialog", { name: "Delete document?" });
    await runImmediateDeleteUndo(page, async () => {
      await deleteDialog.getByRole("button", { name: "Delete" }).click();
      await expect(documentLink(page, fixture.renamedTitle)).toHaveCount(0);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
    });
    await page.reload();
    await expect(documentLink(page, fixture.renamedTitle)).toBeVisible();

    lifecycleMenu = await openDocumentActions(page, fixture.renamedTitle);
    await lifecycleMenu.getByRole("menuitem", { name: "Delete" }).click();
    deleteDialog = page.getByRole("dialog", { name: "Delete document?" });
    await runServerAction({
      page,
      matches: dashboardActionResponse,
      action: () =>
        deleteDialog.getByRole("button", { name: "Delete" }).click(),
    });
    await page.goto("/app/trash");

    const restoreButton = page.getByRole("button", {
      name: `Restore ${fixture.renamedTitle}`,
    });
    await restoreButton.click();
    let restoreDialog = page.getByRole("dialog", { name: "Restore document?" });
    await restoreDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(restoreButton).toBeVisible();
    await restoreButton.click();
    restoreDialog = page.getByRole("dialog", { name: "Restore document?" });
    await runServerAction({
      page,
      matches: trashActionResponse,
      action: () =>
        restoreDialog.getByRole("button", { name: "Restore" }).click(),
    });
    await expect(restoreButton).toHaveCount(0);

    await page.goto("/app");
    await expect(documentLink(page, fixture.renamedTitle)).toBeVisible();
    lifecycleMenu = await openDocumentActions(page, fixture.renamedTitle);
    await lifecycleMenu.getByRole("menuitem", { name: "Delete" }).click();
    deleteDialog = page.getByRole("dialog", { name: "Delete document?" });
    await runServerAction({
      page,
      matches: dashboardActionResponse,
      action: () =>
        deleteDialog.getByRole("button", { name: "Delete" }).click(),
    });
    await page.goto("/app/trash");

    const permanentDeleteButton = page.getByRole("button", {
      name: `Permanently delete ${fixture.renamedTitle}`,
    });
    await permanentDeleteButton.click();
    let permanentDialog = page.getByRole("dialog", {
      name: "Permanently delete?",
    });
    await permanentDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(permanentDeleteButton).toBeVisible();
    await permanentDeleteButton.click();
    permanentDialog = page.getByRole("dialog", {
      name: "Permanently delete?",
    });
    await runServerAction({
      page,
      matches: trashActionResponse,
      action: () =>
        permanentDialog
          .getByRole("button", { name: "Delete permanently" })
          .click(),
    });
    await expect(permanentDeleteButton).toHaveCount(0);

    await page.goto("/app");
    await expect(documentLink(page, fixture.renamedTitle)).toHaveCount(0);
    await expect(documentLink(page, fixture.title)).toBeVisible();
  });
});
