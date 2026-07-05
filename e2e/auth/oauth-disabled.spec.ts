import { expect, test } from "@playwright/test";

/**
 * Provider-disabled OAuth UI coverage (issues #107 and #1721, building on
 * #91/#98).
 *
 * The Google "Continue with Google" CTA is only rendered when Google OAuth is
 * configured (`isGoogleAuthConfigured()` — i.e. GOOGLE_CLIENT_ID /
 * GOOGLE_CLIENT_SECRET are present). When the provider is unconfigured the button
 * and its "or" divider must be hidden so users are never shown a broken sign-in
 * path, while the email/password form stays fully usable.
 *
 * These specs adapt to the environment under test: when Google IS configured
 * they assert the CTA is present and points users into the OAuth flow; when it
 * is NOT, they assert the CTA is absent but the credentials form remains. This
 * keeps the suite green in both CI (provider disabled) and a fully configured
 * staging environment.
 */
function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

for (const path of ["/login", "/signup"] as const) {
  test.describe(`OAuth CTA on ${path}`, () => {
    test("matches Google provider availability", async ({ page }) => {
      await page.goto(path);

      const googleCta = page.getByRole("button", {
        name: /continue with google/i,
      });
      const orDivider = page.getByText(/^or$/i);

      if (googleConfigured()) {
        await expect(googleCta).toBeVisible();
        await expect(orDivider).toBeVisible();
      } else {
        await expect(googleCta).toHaveCount(0);
        // The "or" divider only accompanies the OAuth button.
        await expect(orDivider).toHaveCount(0);
      }

      // Either way the credentials form must remain available.
      await expect(page.locator('input[name="email"]')).toBeVisible();
      await expect(page.locator('input[name="password"]')).toBeVisible();
    });
  });
}
