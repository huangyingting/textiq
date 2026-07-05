import { expect, test } from "@playwright/test";

/**
 * Smoke coverage for the public, unauthenticated pages (issue #107).
 *
 * These assert that the marketing home page plus the login and signup pages
 * render their primary content without requiring a session. They are resilient
 * to copy tweaks by anchoring on stable headings, roles, and form controls
 * rather than exact marketing strings.
 */
test.describe("public pages smoke", () => {
  test("home page renders the hero and primary CTAs", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /turn text into visuals/i }),
    ).toBeVisible();

    // The header exposes auth entry points on the public site.
    await expect(
      page.getByRole("link", { name: /log in/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /sign up/i }).first(),
    ).toBeVisible();
  });

  test("login page renders the credentials form", async ({ page }) => {
    await page.goto("/login");

    await expect(
      page.getByRole("heading", { name: /welcome back/i }),
    ).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /log in/i })).toBeVisible();
  });

  test("signup page renders the credentials form", async ({ page }) => {
    await page.goto("/signup");

    await expect(
      page.getByRole("heading", { name: /create your account/i }),
    ).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });
});
