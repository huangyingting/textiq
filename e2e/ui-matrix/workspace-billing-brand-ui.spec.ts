import { expect, test } from "@playwright/test";

import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileOwnerCredentials,
} from "../helpers/profile";
import { login } from "../helpers/auth";

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
    } else {
      await expect(page.getByText(/remaining|used/i).first()).toBeVisible();
    }
  });

  test("brand studio route renders entitlement-aware brand controls or teaser", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials(), "/app/brands");
    await expect(
      page.getByRole("heading", { name: /brand studio/i }),
    ).toBeVisible({
      timeout: 30_000,
    });
    const createBrand = page.getByRole("button", {
      name: /new brand style|create brand/i,
    });
    const upgradeTeaser = page.getByText(
      /upgrade your plan to save and apply/i,
    );
    await expect(createBrand.or(upgradeTeaser).first()).toBeVisible();
  });
});
