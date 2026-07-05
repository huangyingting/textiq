import { expect, test } from "@playwright/test";

/**
 * Auth-redirect smoke coverage (issue #107).
 *
 * Unauthenticated requests to a protected `/app` route are bounced to the login
 * page by the Auth.js Edge middleware (`authorized` returning `false`), which
 * preserves the originally requested path in a `callbackUrl` query parameter so
 * the user lands back where they started after signing in (issue #90).
 */
test.describe("auth redirects", () => {
  test("protected /app redirects to /login with a callbackUrl", async ({
    page,
  }) => {
    await page.goto("/app");

    await expect(page).toHaveURL(/\/login\?/);

    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    const callbackUrl = url.searchParams.get("callbackUrl");
    expect(callbackUrl, "callbackUrl should be preserved").toBeTruthy();
    expect(callbackUrl).toContain("/app");

    await expect(
      page.getByRole("heading", { name: /welcome back/i }),
    ).toBeVisible();
  });

  test("a deep protected route preserves its full path in callbackUrl", async ({
    page,
  }) => {
    await page.goto("/app/settings");

    await expect(page).toHaveURL(/\/login\?/);

    const callbackUrl = new URL(page.url()).searchParams.get("callbackUrl");
    expect(callbackUrl).toBeTruthy();
    expect(decodeURIComponent(callbackUrl ?? "")).toContain("/app/settings");
  });
});
