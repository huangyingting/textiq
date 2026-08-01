import { expect, test } from "@playwright/test";

import { ACCOUNT_EXPORT_VERSION } from "@/lib/account/export";

import { login } from "../helpers/auth";
import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileAccountLifecycleCredentials,
  profileOwnerCredentials,
} from "../helpers/profile";
import { expectNoPageErrors } from "./helpers";

const GENERIC_RESET_MESSAGE =
  "If an account exists for that email, we've sent a link to reset your password.";

test.describe("UI matrix: account lifecycle", () => {
  test.setTimeout(120_000);

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
    await expect(page.getByLabel("Display name")).toHaveAttribute(
      "maxlength",
      "100",
    );
    await expect(page.getByLabel("Current password")).toHaveAttribute(
      "required",
      "",
    );
    await expect(page.getByLabel("Current password")).toHaveAttribute(
      "maxlength",
      "72",
    );
    await expect(
      page.getByLabel("New password", { exact: true }),
    ).toHaveAttribute("required", "");
    await expect(page.getByLabel("Confirm new password")).toHaveAttribute(
      "required",
      "",
    );
    await expect(
      page.getByLabel("New password", { exact: true }),
    ).toHaveAttribute("minlength", "8");
    await expect(
      page.getByLabel("New password", { exact: true }),
    ).toHaveAttribute("maxlength", "72");
    await expect(page.getByLabel("Confirm new password")).toHaveAttribute(
      "minlength",
      "8",
    );
    await expect(page.getByLabel("Confirm new password")).toHaveAttribute(
      "maxlength",
      "72",
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

  test("new account signs up, recovers onboarding dismissal, persists it, and deletes cleanly", async ({
    page,
  }) => {
    test.skip(
      !e2eProfileEnabled(),
      "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run signup lifecycle coverage",
    );

    let isForcingDismissTransportFailure = false;
    const assertNoPageErrors = await expectNoPageErrors(
      page,
      (message) =>
        isForcingDismissTransportFailure &&
        message === "Failed to load resource: net::ERR_FAILED",
    );
    const fixture = E2E_PROFILE_FIXTURE.signupLifecycle;
    await page.goto("/signup");
    await page.getByLabel(/^Name/).fill(fixture.name);
    await page.getByLabel("Email").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.password);
    await Promise.all([
      page.waitForURL(/\/app(\/|$|\?)/, { waitUntil: "commit" }),
      page.getByRole("button", { name: "Create account" }).click(),
    ]);

    await expect(
      page.getByRole("heading", { name: "Your documents" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "User menu" })).toContainText(
      fixture.name,
    );
    await expect(
      page.getByRole("link", { name: "Welcome to TextIQ" }),
    ).toBeVisible();

    const onboarding = page.getByRole("region", {
      name: "Getting started checklist",
    });
    await expect(onboarding).toBeVisible();
    await expect(
      onboarding.getByRole("progressbar", {
        name: "2 of 2 onboarding steps complete",
      }),
    ).toHaveAttribute("aria-valuenow", "2");
    await expect(
      onboarding.getByText("Create or import a document"),
    ).toBeVisible();
    await expect(
      onboarding.getByText("Select text → generate a visual"),
    ).toBeVisible();

    let dismissActionCount = 0;
    const dashboardRoute = "**/app*";
    await page.route(dashboardRoute, async (route) => {
      const request = route.request();
      const isDashboardAction =
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/app" &&
        typeof request.headers()["next-action"] === "string";
      if (!isDashboardAction) {
        await route.continue();
        return;
      }
      dismissActionCount += 1;
      if (dismissActionCount === 1) {
        isForcingDismissTransportFailure = true;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await onboarding
      .getByRole("button", { name: "Mark as complete and dismiss" })
      .click();
    const dismissAlert = onboarding.getByRole("alert").filter({
      hasText: "Could not dismiss the checklist. Please try again.",
    });
    await expect(dismissAlert).toBeVisible();
    const dismissResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/app",
    );
    await dismissAlert
      .getByRole("button", { name: "Try dismiss again" })
      .dblclick();
    expect((await dismissResponse).ok()).toBe(true);
    await expect.poll(() => dismissActionCount).toBe(2);
    await page.unroute(dashboardRoute);
    isForcingDismissTransportFailure = false;
    await expect(onboarding).toHaveCount(0, { timeout: 20_000 });
    await page.reload();
    await expect(onboarding).toHaveCount(0);

    await page.goto("/app/settings");
    await expect(page.getByLabel("Email")).toHaveValue(fixture.email);
    await expect(page.getByLabel("Display name")).toHaveValue(fixture.name);
    await page.getByRole("button", { name: "Delete account" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete account?" });
    await dialog.getByLabel("Confirm account deletion").fill(fixture.email);
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/", {
        waitUntil: "commit",
      }),
      dialog.getByRole("button", { name: "Delete account" }).click(),
    ]);
    await expect(
      page.getByRole("heading", { name: /turn text into visuals/i }),
    ).toBeVisible();

    await page.goto("/login");
    await page.getByLabel("Email").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(
      page.getByText("Invalid email or password.", { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await assertNoPageErrors();
  });

  test("isolated account persists profile edits and rotates credentials with explicit re-login", async ({
    page,
  }) => {
    test.skip(
      !e2eProfileEnabled(),
      "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run account mutation coverage",
    );

    const fixture = E2E_PROFILE_FIXTURE.accountLifecycle;
    const credentials = profileAccountLifecycleCredentials();
    await login(page, credentials, "/app/settings");

    const displayName = page.getByLabel("Display name");
    await displayName.fill(fixture.updatedName);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Profile updated.");
    await expect(page.getByRole("button", { name: "User menu" })).toContainText(
      fixture.updatedName,
    );

    await page.reload();
    await expect(page.getByLabel("Display name")).toHaveValue(
      fixture.updatedName,
    );
    await page.getByLabel("Display name").fill(fixture.name);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Profile updated.");
    await expect(page.getByRole("button", { name: "User menu" })).toContainText(
      fixture.name,
    );

    await page.getByLabel("Current password").fill(fixture.password);
    await page
      .getByLabel("New password", { exact: true })
      .fill(fixture.replacementPassword);
    await page
      .getByLabel("Confirm new password")
      .fill(fixture.replacementPassword);
    await Promise.all([
      page.waitForURL(/\/login\?passwordChanged=1$/),
      page.getByRole("button", { name: "Update password" }).click(),
    ]);
    await expect(page.getByRole("status")).toHaveText(
      "Password updated. Log in with your new password.",
    );

    await page.getByLabel("Email").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(
      page.getByText("Invalid email or password.", { exact: true }),
    ).toBeVisible();

    await page.getByLabel("Password").fill(fixture.replacementPassword);
    await Promise.all([
      page.waitForURL(/\/app(\/|$|\?)/, { waitUntil: "commit" }),
      page.getByRole("button", { name: "Log in" }).click(),
    ]);
    await page.goto("/app/settings");

    await page.getByLabel("Current password").fill(fixture.replacementPassword);
    await page
      .getByLabel("New password", { exact: true })
      .fill(fixture.password);
    await page.getByLabel("Confirm new password").fill(fixture.password);
    await Promise.all([
      page.waitForURL(/\/login\?passwordChanged=1$/),
      page.getByRole("button", { name: "Update password" }).click(),
    ]);

    await page.getByLabel("Email").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.replacementPassword);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(
      page.getByText("Invalid email or password.", { exact: true }),
    ).toBeVisible();

    await page.getByLabel("Password").fill(fixture.password);
    await Promise.all([
      page.waitForURL(/\/app(\/|$|\?)/, { waitUntil: "commit" }),
      page.getByRole("button", { name: "Log in" }).click(),
    ]);
    await expect(page).toHaveURL(/\/app/);
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
