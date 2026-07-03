import { expect, test } from "@playwright/test";

function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

test.describe("UI matrix: auth and public pages", () => {
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
});
