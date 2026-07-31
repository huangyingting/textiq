import { expect, test } from "@playwright/test";

import { ACCOUNT_EXPORT_VERSION } from "@/lib/account/export";

import { login } from "../helpers/auth";
import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileOwnerCredentials,
} from "../helpers/profile";

const GENERIC_RESET_MESSAGE =
  "If an account exists for that email, we've sent a link to reset your password.";

test.describe("UI matrix: account lifecycle", () => {
  test.setTimeout(90_000);

  test("recovery and verification pages expose safe public failure states", async ({
    page,
  }) => {
    await page.goto("/forgot-password");
    await expect(
      page.getByRole("heading", { name: "Forgot your password?" }),
    ).toBeVisible();
    await page.getByLabel("Email").fill("unknown-account@textiq.test");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toHaveText(GENERIC_RESET_MESSAGE, {
      timeout: 20_000,
    });
    await expect(
      page.getByRole("link", { name: "Back to log in" }),
    ).toHaveAttribute("href", "/login");

    await page.goto("/reset-password");
    await expect(
      page.getByRole("heading", { name: "Set a new password" }),
    ).toBeVisible();
    await expect(page.locator('p[role="alert"]')).toContainText(
      "This reset link is invalid or incomplete.",
    );
    await expect(
      page.getByRole("link", { name: "Request a new link" }),
    ).toHaveAttribute("href", "/forgot-password");

    await page.goto("/reset-password?token=deterministic-invalid-reset-token");
    await page
      .getByLabel("New password", { exact: true })
      .fill("unused-password-2026");
    await page.getByLabel("Confirm new password").fill("unused-password-2026");
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page.locator('p[role="alert"]')).toHaveText(
      "This reset link is invalid. Please request a new one.",
      { timeout: 20_000 },
    );

    await page.goto("/verify-email/deterministic-invalid-verification-token");
    await expect(
      page.getByRole("heading", { name: "Verification failed" }),
    ).toBeVisible();
    await expect(page.locator('p[role="alert"]')).toHaveText(
      "This verification link is invalid. Request a new one from settings.",
    );
    await expect(
      page.getByRole("link", { name: "Back to settings" }),
    ).toHaveAttribute("href", "/app/settings");
  });

  test("seeded owner can inspect settings and download a scoped data export", async ({
    page,
  }) => {
    test.skip(
      !e2eProfileEnabled(),
      "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run account settings coverage",
    );

    const credentials = profileOwnerCredentials();
    await login(page, credentials, "/app/settings");

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    for (const heading of [
      "Profile",
      "Email verification",
      "Change password",
      "Connected accounts",
      "Your data",
      "Danger zone",
    ]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    await expect(page.getByText("Verified", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeDisabled();
    await expect(page.getByLabel("Email")).toHaveValue(credentials.email);
    await expect(page.getByLabel("Display name")).toHaveValue(
      E2E_PROFILE_FIXTURE.owner.name,
    );

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download my data" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^textiq-data-export-\d{4}-\d{2}-\d{2}\.json$/,
    );
    expect(await download.failure()).toBeNull();

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const payload: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(payload).toEqual(
      expect.objectContaining({
        exportVersion: ACCOUNT_EXPORT_VERSION,
        manifest: expect.objectContaining({ assetBytesIncluded: false }),
        user: expect.objectContaining({
          email: credentials.email,
          name: E2E_PROFILE_FIXTURE.owner.name,
        }),
        documents: expect.arrayContaining([
          expect.objectContaining({ id: E2E_PROFILE_FIXTURE.documentId }),
        ]),
      }),
    );
  });

  test("password failures preserve the session and deletion stays confirmation-gated", async ({
    page,
  }) => {
    test.skip(
      !e2eProfileEnabled(),
      "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run account safeguard coverage",
    );

    const credentials = profileOwnerCredentials();
    await login(page, credentials, "/app/settings");

    await page
      .getByLabel("Current password")
      .fill(`${credentials.password}-deliberately-wrong`);
    await page
      .getByLabel("New password", { exact: true })
      .fill("unused-password-2026");
    await page.getByLabel("Confirm new password").fill("unused-password-2026");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.locator('p[role="alert"]')).toHaveText(
      "Your current password is incorrect.",
      { timeout: 20_000 },
    );
    await expect(page).toHaveURL(/\/app\/settings$/);
    await expect(
      page.getByRole("link", { name: "Download my data" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Delete account" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete account?" });
    const confirmation = dialog.getByLabel("Confirm account deletion");
    const deleteButton = dialog.getByRole("button", {
      name: "Delete account",
    });

    await expect(dialog).toBeVisible();
    await expect(deleteButton).toBeDisabled();
    await confirmation.fill("not a valid confirmation");
    await expect(deleteButton).toBeDisabled();
    await confirmation.fill(credentials.email);
    await expect(deleteButton).toBeEnabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "Delete account" }).click();
    await expect(dialog).toBeVisible();
    await expect(confirmation).toHaveValue("");
    await confirmation.fill("DELETE");
    await expect(deleteButton).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});
