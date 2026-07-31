import { expect, test } from "@playwright/test";

import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileDocPath,
  profileOwnerCredentials,
} from "../helpers/profile";

function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

test.describe("UI matrix: auth and public pages", () => {
  test.setTimeout(90_000);

  test("public home, login, and signup expose primary unauthenticated controls", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /turn text into visuals/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /log in/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /sign up/i }).first(),
    ).toBeVisible();

    await page.goto("/login");
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /log in/i })).toBeVisible();

    await page.goto("/signup");
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test("deep protected slide route redirects with callbackUrl intact", async ({
    page,
  }) => {
    await page.goto("/app/documents/ui-matrix-doc/slides");

    await expect(page).toHaveURL(/\/login\?/);
    const callbackUrl = new URL(page.url()).searchParams.get("callbackUrl");
    expect(callbackUrl).toBeTruthy();
    expect(decodeURIComponent(callbackUrl ?? "")).toContain(
      "/app/documents/ui-matrix-doc/slides",
    );
  });

  test("Google OAuth CTA matches provider configuration", async ({ page }) => {
    await page.goto("/login");
    const googleCta = page.getByRole("button", {
      name: /continue with google/i,
    });
    const orDivider = page.getByText(/^or$/i);

    if (googleConfigured()) {
      await expect(googleCta).toBeVisible();
      await expect(orDivider).toBeVisible();
    } else {
      await expect(googleCta).toHaveCount(0);
      await expect(orDivider).toHaveCount(0);
    }

    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test("invalid credentials stay generic and a successful retry preserves the deep callback", async ({
    page,
  }) => {
    test.skip(
      !e2eProfileEnabled(),
      "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run credential recovery",
    );

    const credentials = profileOwnerCredentials();
    const callbackPath = profileDocPath();
    await page.goto(`/login?callbackUrl=${encodeURIComponent(callbackPath)}`);

    const email = page.locator('input[name="email"]');
    const password = page.locator('input[name="password"]');
    await email.fill(credentials.email);
    await password.fill(`${credentials.password}-invalid`);
    await page.getByRole("button", { name: /log in/i }).click();

    const credentialError = page.getByText("Invalid email or password.", {
      exact: true,
    });
    await expect(credentialError).toBeVisible({ timeout: 20_000 });
    await expect(credentialError).toHaveAttribute("role", "alert");
    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
    await expect(page.locator('input[name="email"]')).toHaveValue(
      credentials.email,
    );

    await password.fill(credentials.password);
    await Promise.all([
      page.waitForURL(new RegExp(`${callbackPath}$`), {
        waitUntil: "commit",
      }),
      page.getByRole("button", { name: /log in/i }).click(),
    ]);

    await expect(page).toHaveURL(new RegExp(`${callbackPath}$`));
    await expect(
      page.getByText(E2E_PROFILE_FIXTURE.documentBodyText, { exact: false }),
    ).toBeVisible({ timeout: 30_000 });
  });
});
