import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileBillingLifecycleCredentials,
  profileEditorCredentials,
  profileOwnerCredentials,
} from "../helpers/profile";
import { login } from "../helpers/auth";
import { credentialGatedRequest } from "../helpers/credential-gate";
import { expectNoPageErrors } from "./helpers";

function unlimitedCreditsEnabled(): boolean {
  const value = process.env.BILLING_UNLIMITED_CREDITS;
  return value === "1" || value === "true";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test.describe("UI matrix: workspace, billing, and brand surfaces", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run workspace/billing/brand UI matrix checks",
  );
  test.setTimeout(90_000);

  test("dashboard search and favorite controls are available for the seeded owner", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials());
    await expect(
      page.getByRole("heading", { name: /your documents/i }),
    ).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByRole("searchbox", { name: /search documents/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /show favorites only/i }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("link", {
          name: new RegExp(
            escapeRegExp(E2E_PROFILE_FIXTURE.documentTitle),
            "i",
          ),
        })
        .first(),
    ).toBeVisible();
  });

  test("billing credits panel reflects the sqlite E2E environment gate", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials(), "/app/settings/billing");
    await expect(
      page.getByRole("heading", { name: /ai credits/i }),
    ).toBeVisible();
    if (unlimitedCreditsEnabled()) {
      await expect(page.getByText(/^Unlimited$/).first()).toBeVisible();
      await expect(page.getByText(/no per-word metering/i)).toBeVisible();
      await expect(
        page.getByRole("progressbar", { name: "AI credit usage" }),
      ).toHaveCount(0);
    } else {
      await expect(page.getByText(/remaining|used/i).first()).toBeVisible();
      const creditUsage = page.getByRole("progressbar", {
        name: "AI credit usage",
      });
      await expect(creditUsage).toBeVisible();
      await expect(creditUsage).toHaveAttribute("aria-valuemin", "0");
      await expect(creditUsage).toHaveAttribute("aria-valuemax", "100");
      await expect(creditUsage).toHaveAttribute("aria-valuetext", /% used$/);
    }
  });

  test("billing upgrades, cancellation, downgrade, persistence, and mobile layout work end to end", async ({
    page,
  }) => {
    await login(
      page,
      profileBillingLifecycleCredentials(),
      "/app/settings/billing",
    );

    const currentPlanSection = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Current Plan" }),
    });
    const planButton = (name: "Free" | "Plus" | "Pro") =>
      page.getByRole("button", { name: new RegExp(`^${name}`) });

    await expect(currentPlanSection).toContainText("You are on the Free plan.");
    await expect(planButton("Free")).toBeDisabled();

    const billingPath = "/app/settings/billing";
    const billingActionRoute = `**${billingPath}`;
    let billingActionCount = 0;
    await page.route(billingActionRoute, async (route) => {
      const request = route.request();
      const isBillingAction =
        request.method() === "POST" &&
        new URL(request.url()).pathname === billingPath &&
        typeof request.headers()["next-action"] === "string";
      if (!isBillingAction) {
        await route.continue();
        return;
      }
      billingActionCount += 1;
      if (billingActionCount === 1) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await planButton("Plus").click();
    await expect(
      page.getByRole("alert").filter({
        hasText: "Could not update billing. Please try again.",
      }),
    ).toBeVisible();
    await expect(currentPlanSection).toContainText("You are on the Free plan.");
    const upgradeResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === billingPath,
    );
    await planButton("Plus").dblclick();
    expect((await upgradeResponse).ok()).toBe(true);
    await expect.poll(() => billingActionCount).toBe(2);
    await page.unroute(billingActionRoute);
    await expect(currentPlanSection).toContainText("You are on the Plus plan.");
    const assertNoPageErrors = await expectNoPageErrors(page);
    await expect(
      page.getByRole("status").filter({ hasText: "Plan updated to plus." }),
    ).toBeVisible();
    await expect(planButton("Plus")).toBeDisabled();

    await page.reload();
    await expect(currentPlanSection).toContainText("You are on the Plus plan.");
    await page.getByRole("button", { name: "Cancel subscription" }).click();
    await expect(
      page.getByRole("status").filter({
        hasText:
          "Subscription will be cancelled at the end of the current period.",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /will be cancelled at the end of the current billing period/i,
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cancel subscription" }),
    ).toHaveCount(0);

    await page.reload();
    await expect(
      page.getByText(
        /will be cancelled at the end of the current billing period/i,
      ),
    ).toBeVisible();

    await planButton("Pro").click();
    await expect(currentPlanSection).toContainText("You are on the Pro plan.");
    await expect(
      page.getByRole("status").filter({ hasText: "Plan updated to pro." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cancel subscription" }),
    ).toBeVisible();

    await planButton("Free").click();
    await expect(currentPlanSection).toContainText("You are on the Free plan.");
    await expect(
      page.getByRole("status").filter({ hasText: "Plan updated to free." }),
    ).toBeVisible();
    await expect(planButton("Free")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Cancel subscription" }),
    ).toHaveCount(0);

    await page.reload();
    await expect(currentPlanSection).toContainText("You are on the Free plan.");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(planButton("Free")).toBeVisible();
    await expect(planButton("Plus")).toBeVisible();
    await expect(planButton("Pro")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Math.max(
            document.body.scrollWidth - document.body.clientWidth,
            document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
        ),
      )
      .toBe(0);
    await assertNoPageErrors();
  });

  test("free owner sees the Brand Studio upgrade gate", async ({ page }) => {
    await login(page, profileOwnerCredentials(), "/app/brands");
    await expect(
      page.getByRole("heading", { name: /brand studio/i }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText(/upgrade your plan to save and apply/i),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /new brand style|create brand/i }),
    ).toHaveCount(0);
  });

  test("Pro editor creates, uploads, reloads, edits, and deletes a brand", async ({
    page,
  }) => {
    const fixture = E2E_PROFILE_FIXTURE.brandWorkflow;
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, profileEditorCredentials(), "/app/brands");
    await expect(
      page.getByRole("heading", { name: /brand studio/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/no brand styles yet/i)).toBeVisible();

    await page.getByRole("button", { name: "New brand style" }).click();
    const nameInput = page.getByLabel("Brand name");
    await expect(nameInput).toBeVisible();
    await nameInput.fill(fixture.initialName);

    await page
      .getByRole("button", { name: "Palette color 1", exact: true })
      .click();
    const palettePicker = page.getByRole("dialog", {
      name: "Palette color 1 picker",
    });
    await expect(palettePicker).toBeVisible();
    await palettePicker.getByRole("button", { name: "#ef4444" }).click();
    await expect(
      palettePicker.getByRole("button", { name: "#ef4444" }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(palettePicker).toHaveCount(0);

    const removePaletteColors = page.getByRole("button", {
      name: /remove palette color/i,
    });
    const paletteSizeBefore = await removePaletteColors.count();
    await page.getByRole("button", { name: "Add palette color" }).click();
    await expect(removePaletteColors).toHaveCount(paletteSizeBefore + 1);
    await page
      .getByRole("button", {
        name: `Remove palette color ${paletteSizeBefore + 1}`,
      })
      .click();
    await expect(removePaletteColors).toHaveCount(paletteSizeBefore);

    let releaseFontUpload!: () => void;
    const fontUploadGate = new Promise<void>((resolve) => {
      releaseFontUpload = resolve;
    });
    await page.route("**/api/brand/font", async (route) => {
      await fontUploadGate;
      await route.continue();
    });
    const fontUploadResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/brand/font",
    );
    await page
      .locator('input[type="file"][accept*=".woff2"]')
      .setInputFiles(path.resolve(process.cwd(), fixture.fontPath));
    await expect(
      page.getByRole("status").filter({
        hasText: "Uploading and validating font…",
      }),
    ).toBeVisible();
    const createPanel = page
      .getByRole("heading", { name: "New brand style" })
      .locator("..")
      .locator("..");
    await expect(
      createPanel.getByRole("button", { name: "Create brand" }),
    ).toBeDisabled();
    await expect(
      createPanel.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeDisabled();
    await expect(
      createPanel.getByRole("button", { name: "Close", exact: true }),
    ).toBeDisabled();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Math.max(
            document.body.scrollWidth - document.body.clientWidth,
            document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
        ),
      )
      .toBe(0);
    releaseFontUpload();
    const uploaded = await fontUploadResponse;
    await page.unroute("**/api/brand/font");
    expect(uploaded.status()).toBe(200);
    const uploadBody: unknown = await uploaded.json();
    expect(uploadBody).toEqual(
      expect.objectContaining({
        assetId: expect.any(String),
        familyName: "source-sans-3-latin-400-normal",
        url: expect.stringMatching(/^\/api\/brand-assets\//),
      }),
    );
    const fontAssetUrl = (uploadBody as { url: string }).url;
    await expect(page.getByRole("combobox").first()).toHaveValue(
      fixture.fontFamily,
    );

    const brandsPath = "/app/brands";
    const brandActionRoute = `**${brandsPath}`;
    let brandActionCount = 0;
    await page.route(brandActionRoute, async (route) => {
      const request = route.request();
      const isBrandAction =
        request.method() === "POST" &&
        new URL(request.url()).pathname === brandsPath &&
        typeof request.headers()["next-action"] === "string";
      if (!isBrandAction) {
        await route.continue();
        return;
      }
      brandActionCount += 1;
      if (brandActionCount === 1) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Create brand" }).click();
    await expect(
      page.getByRole("alert").filter({
        hasText:
          "Couldn't save the brand. Please check your connection and try again.",
      }),
    ).toBeVisible();
    await expect(nameInput).toHaveValue(fixture.initialName);
    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === brandsPath,
    );
    await page.getByRole("button", { name: "Create brand" }).dblclick();
    expect((await createResponse).ok()).toBe(true);
    await expect.poll(() => brandActionCount).toBe(2);
    await page.unroute(brandActionRoute);
    const createdCard = page.getByRole("article", {
      name: `Brand: ${fixture.initialName}`,
    });
    await expect(createdCard).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(createdCard).toBeVisible({ timeout: 30_000 });
    const hydratedFont = page.locator('style[id^="brand-font-"]').first();
    await expect(hydratedFont).toBeAttached();
    expect(await hydratedFont.textContent()).toContain(fontAssetUrl);
    expect(
      (await credentialGatedRequest(page).get(fontAssetUrl)).status(),
    ).toBe(200);

    await createdCard.getByRole("button", { name: "Edit brand" }).click();
    await createdCard
      .getByRole("button", { name: "Palette color 1", exact: true })
      .click();
    const persistedPalettePicker = page.getByRole("dialog", {
      name: "Palette color 1 picker",
    });
    await expect(
      persistedPalettePicker.getByRole("button", { name: "#ef4444" }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await createdCard.getByLabel("Brand name").fill(fixture.updatedName);
    await createdCard.getByRole("button", { name: "Save changes" }).click();
    const updatedCard = page.getByRole("article", {
      name: `Brand: ${fixture.updatedName}`,
    });
    await expect(updatedCard).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(updatedCard).toBeVisible({ timeout: 30_000 });
    await updatedCard.getByRole("button", { name: "Delete brand" }).click();
    const deleteDialog = page.getByRole("dialog", {
      name: `Delete “${fixture.updatedName}”?`,
    });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(updatedCard).toBeVisible();

    await updatedCard.getByRole("button", { name: "Delete brand" }).click();
    await deleteDialog.getByRole("button", { name: "Delete brand" }).click();
    await expect(updatedCard).toHaveCount(0);
    await expect(page.getByText(/no brand styles yet/i)).toBeVisible();
    expect(
      (await credentialGatedRequest(page).get(fontAssetUrl)).status(),
    ).toBe(404);
  });
});
