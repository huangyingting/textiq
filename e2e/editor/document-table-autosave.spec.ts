import { expect, test } from "@playwright/test";

import { login, ownerCredentials } from "../helpers/auth";
import { e2eProfileEnabled, profileOwnerCredentials } from "../helpers/profile";
import {
  waitForDocumentAutosaveAfter,
  waitForDocumentEditorReady,
} from "../helpers/readiness";

test("sustained document and table edits persist after saved state and reload", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const credentials = e2eProfileEnabled()
    ? profileOwnerCredentials()
    : ownerCredentials();
  test.skip(!credentials, "Set E2E_USER_EMAIL/E2E_USER_PASSWORD");

  await login(page, credentials!);
  await page.goto("/app");
  await page
    .getByRole("button", { name: /new document|create your first document/i })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Blank template" })
    .click();
  await page.waitForURL(/\/app\/documents\//);

  const body = await waitForDocumentEditorReady(page);

  const marker =
    `Autosave regression ${testInfo.project.name} ` +
    `${testInfo.repeatEachIndex}-${testInfo.workerIndex}`;
  const typeLikeFastUser = (value: string) =>
    page.keyboard.type(value, { delay: 100 });
  await body.click();
  await expect(body).toBeFocused();
  await typeLikeFastUser("/h1");
  await page.keyboard.press("Enter");
  await typeLikeFastUser(marker);
  await page.keyboard.press("Enter");
  await typeLikeFastUser(
    "A sustained paragraph written without pausing for the autosave debounce.",
  );
  await page.keyboard.press("Enter");
  await typeLikeFastUser("/h2");
  await page.keyboard.press("Enter");
  await typeLikeFastUser("Table details");
  await page.keyboard.press("Enter");
  await typeLikeFastUser(
    "The table below must retain both its structure and every cell value.",
  );
  await page.keyboard.press("Enter");
  await typeLikeFastUser("/table");
  await page.keyboard.press("Enter");

  const table = body.locator("table").first();
  await expect(table).toBeVisible();
  await table.locator("th, td").first().click();

  const tableToolbar = page.getByRole("toolbar", { name: "Table editing" });
  await expect(tableToolbar).toHaveCount(1);
  await tableToolbar.getByRole("button", { name: "Add row below" }).click();
  await tableToolbar.getByRole("button", { name: "Add column right" }).click();

  await expect(table.locator("tr")).toHaveCount(3);
  await expect(table.locator("th, td")).toHaveCount(9);

  const cellValues = [
    "Region",
    "Quarter",
    "Revenue",
    "North",
    "Q1",
    "$12M",
    "South",
    "Q2",
    "$9M",
  ];
  const cells = table.locator("th, td");
  await waitForDocumentAutosaveAfter(page, async () => {
    for (const [index, value] of cellValues.entries()) {
      await cells.nth(index).click();
      await typeLikeFastUser(value);
    }
  });

  await page.reload();
  await waitForDocumentEditorReady(page);
  await expect(page.getByText(marker)).toBeVisible({ timeout: 20_000 });
  const reloadedTable = page
    .getByRole("textbox", { name: "Document body" })
    .locator("table")
    .first();
  await expect(reloadedTable.locator("tr")).toHaveCount(3);
  await expect(reloadedTable.locator("th, td")).toHaveCount(9);
  await expect(reloadedTable.locator("th, td")).toHaveText(cellValues);
});
