import { expect, test } from "@playwright/test";

import {
  e2eProfileEnabled,
  profileDocPath,
  profileViewerCredentials,
} from "../helpers/profile";
import { login } from "../helpers/auth";
import { openProfileDocument } from "./helpers";

test.describe("UI matrix: document editor contextual surfaces", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run document-editor UI matrix checks",
  );
  test.setTimeout(90_000);

  test("owner document editor renders the body surface and slide entry point", async ({
    page,
  }) => {
    await openProfileDocument(page);
    await expect(
      page.getByRole("textbox", { name: "Document body" }),
    ).toHaveAttribute("contenteditable", "true", { timeout: 20_000 });
    await expect(
      page.getByRole("link", { name: "Open slide editor" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Release Gate").first()).toBeVisible();
  });

  test("open slide editor link reaches the canonical presentation route", async ({
    page,
  }) => {
    await openProfileDocument(page);
    await page.getByRole("link", { name: "Open slide editor" }).click();
    await expect(page).toHaveURL(new RegExp(`${profileDocPath()}/slides`), {
      timeout: 30_000,
    });
    const editor = page.locator('[data-slide-editor="true"]').first();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(
      editor.locator('[data-slide-canvas="true"]').first(),
    ).toBeVisible();
  });

  test("viewer sees a read-only document with edit-only controls removed", async ({
    page,
  }) => {
    await login(page, profileViewerCredentials(), profileDocPath());
    const documentBody = page.getByRole("textbox", { name: "Document body" });
    await expect(documentBody).toBeVisible({ timeout: 60_000 });
    await expect(documentBody).toHaveAttribute("contenteditable", "false");
    await expect(page.getByText("Read-only", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open slide editor" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Style" })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(profileDocPath()));
  });
});
