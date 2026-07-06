import { expect, test } from "@playwright/test";

import { login } from "../helpers/auth";
import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileDocPath,
  profileOwnerCredentials,
} from "../helpers/profile";

test.describe("authenticated nested app routes", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run nested route smoke",
  );
  test.setTimeout(180_000);

  test("dashboard-linked document, billing, and slide routes render after login @required-profile", async ({
    page,
  }) => {
    const documentPath = profileDocPath();

    await login(page, profileOwnerCredentials());

    const documentCard = page.locator(`a[href="${documentPath}"]`).first();
    await expect(documentCard).toBeVisible({ timeout: 60_000 });
    await expect(documentCard).toHaveAttribute("href", documentPath);

    await page.goto(documentPath);
    await expect(page).toHaveURL(new RegExp(`${documentPath}$`), {
      timeout: 60_000,
    });
    await expect(
      page.getByText(E2E_PROFILE_FIXTURE.documentBodyText),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "404" })).toHaveCount(0);

    await page.goto("/app/settings/billing");
    await expect(
      page.getByRole("heading", { name: /billing & plan/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "404" })).toHaveCount(0);

    await page.goto(`${documentPath}/slides`);
    await expect(
      page.getByRole("dialog", { name: "Slide editor" }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "404" })).toHaveCount(0);
  });
});
