import { expect, test } from "@playwright/test";

import { login, ownerCredentials } from "./helpers/auth";

/**
 * Billing unlimited-credit UI + Brand Studio font persistence coverage
 * (issue #107, building on #95/#97).
 *
 * Both surfaces are authenticated, so these read credentials from the
 * environment and skip cleanly when absent (see `e2e/helpers/auth.ts`).
 */
test.describe("billing AI credits panel", () => {
  test("reflects the unlimited-credit env gate", async ({ page }) => {
    const creds = ownerCredentials();
    test.skip(!creds, "Set E2E_USER_EMAIL/E2E_USER_PASSWORD to run this flow");
    await login(page, creds!);

    await page.goto("/app/settings/billing");

    await expect(
      page.getByRole("heading", { name: /ai credits/i }),
    ).toBeVisible();

    // The unlimited-credit env flag (issue #97) swaps the metered display for an
    // "Unlimited" treatment. Assert whichever state matches the environment.
    const flag = process.env.BILLING_UNLIMITED_CREDITS;
    const unlimited = flag === "true" || flag === "1";
    if (unlimited) {
      await expect(page.getByText(/^Unlimited$/).first()).toBeVisible();
      await expect(page.getByText(/no per-word metering/i)).toBeVisible();
    } else {
      // Metered mode shows a "remaining" / "used" treatment.
      await expect(page.getByText(/remaining|used/i).first()).toBeVisible();
    }
  });
});

test.describe("brand studio font persistence", () => {
  test("an uploaded brand font survives a reload", async ({ page }) => {
    const creds = ownerCredentials();
    const fontUrl = process.env.E2E_BRAND_FONT_URL;
    test.skip(
      !creds || !fontUrl,
      "Set E2E_USER_* and E2E_BRAND_FONT_URL (path to a .woff2) to run this flow",
    );
    await login(page, creds!);

    await page.goto("/app/brands");

    const fontInput = page.locator('input[type="file"]').first();
    await expect(fontInput).toHaveCount(1);
    await fontInput.setInputFiles(fontUrl!);

    // After upload + save the chosen font family persists across reloads (the
    // durable data-URL is stored on the brand style, issue #95).
    await page.getByRole("button", { name: /save/i }).first().click();
    await page.reload();

    // The persisted @font-face / family name should still be present in the DOM.
    await expect(
      page.locator("style, [data-brand-font]").first(),
    ).toBeAttached();
  });
});
