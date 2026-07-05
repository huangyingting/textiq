import { expect, test, type Page } from "@playwright/test";

import { E2E_PROFILE_FIXTURE } from "../helpers/profile";

/**
 * Share / presentation fallback coverage (issue #107, building on #98).
 *
 * Unknown, non-shared, expired, regenerated, or deleted share links must resolve
 * to a safe "not found" fallback rather than leaking document content or
 * erroring out. Both the read-only `/share/[shareId]` view and the
 * `/present/[shareId]` presentation route call `notFound()` for links that fail
 * the centralized share-access decision.
 *
 * A random, non-existent share id is guaranteed to be unknown, so these specs
 * are deterministic without any seeded data.
 */
const UNKNOWN_SHARE_ID = "playwright-nonexistent-share-id";

/** Slug-prefixed form that mirrors the real `<slug>-<shareId>` URL shape. */
const SLUG_PREFIXED_SHARE_ID = "some-doc-slug-playwright-nonexistent-share-id";

/** Malformed share id with characters that cannot match any stored share. */
const MALFORMED_SHARE_ID = "!!!invalid-share-id!!!";

const DENIED_PUBLIC_ROUTES = [
  "/share",
  `/share/${UNKNOWN_SHARE_ID}`,
  `/share/${encodeURIComponent(MALFORMED_SHARE_ID)}`,
  `/present/${UNKNOWN_SHARE_ID}`,
  `/embed/${UNKNOWN_SHARE_ID}`,
  `/present/${UNKNOWN_SHARE_ID}/embed`,
] as const;

const FIXTURE_CONTENT_MARKERS = [
  E2E_PROFILE_FIXTURE.documentTitle,
  E2E_PROFILE_FIXTURE.documentBodyText,
  E2E_PROFILE_FIXTURE.slideTitleText,
  E2E_PROFILE_FIXTURE.slideBodyText,
] as const;

async function expectVisibleNotFoundWithoutFixtureContent(page: Page) {
  await expect(
    page.getByRole("heading", { name: /page not found/i }),
  ).toBeVisible();
  await expect(page.getByText("404").first()).toBeVisible();

  const bodyText = await page.locator("body").innerText();
  for (const marker of FIXTURE_CONTENT_MARKERS) {
    expect(bodyText, `browser fallback leaked ${marker}`).not.toContain(marker);
  }
}

test.describe("share/present fallback", () => {
  test("unknown and malformed public routes return 404 without leaking fixture content", async ({
    request,
  }) => {
    test.setTimeout(90_000);

    for (const route of DENIED_PUBLIC_ROUTES) {
      const response = await request.get(route);
      const body = await response.text();

      expect(response.status(), route).toBe(404);
      expect(body, route).toMatch(/not found|404/i);
      for (const marker of FIXTURE_CONTENT_MARKERS) {
        expect(body, `${route} leaked ${marker}`).not.toContain(marker);
      }
    }
  });

  test("unknown /share link renders the not-found fallback", async ({
    page,
  }) => {
    const response = await page.goto(`/share/${UNKNOWN_SHARE_ID}`);

    // Next.js notFound() serves the 404 page.
    expect(response?.status()).toBe(404);
    await expectVisibleNotFoundWithoutFixtureContent(page);
  });

  test("unknown /present link renders the not-found fallback", async ({
    page,
  }) => {
    const response = await page.goto(`/present/${UNKNOWN_SHARE_ID}`);

    expect(response?.status()).toBe(404);
    await expectVisibleNotFoundWithoutFixtureContent(page);
  });

  test("unknown /embed link renders the not-found fallback", async ({
    page,
  }) => {
    const response = await page.goto(`/embed/${UNKNOWN_SHARE_ID}`);

    expect(response?.status()).toBe(404);
    await expectVisibleNotFoundWithoutFixtureContent(page);
  });

  test("unknown /present/<share>/embed renders the not-found fallback", async ({
    page,
  }) => {
    // `/present/[shareId]/embed` is a distinct sub-route not covered above.
    const response = await page.goto(`/present/${UNKNOWN_SHARE_ID}/embed`);

    expect(response?.status()).toBe(404);
    // The embed sub-route goes through the same notFound() path as /present
    // and /embed, so the 404 page must render.
    await expectVisibleNotFoundWithoutFixtureContent(page);
  });

  test("slug-prefixed unknown share ID resolves to the safe 404 fallback without leaking content", async ({
    page,
  }) => {
    // Real public links use `<slug>-<shareId>`; ensure a plausible-looking
    // but non-existent slug-prefixed ID still returns 404 and does not leak.
    const response = await page.goto(`/present/${SLUG_PREFIXED_SHARE_ID}`);

    expect(response?.status()).toBe(404);
    await expectVisibleNotFoundWithoutFixtureContent(page);
  });

  test("malformed share ID resolves to the safe 404 fallback without leaking content", async ({
    page,
  }) => {
    const response = await page.goto(
      `/share/${encodeURIComponent(MALFORMED_SHARE_ID)}`,
    );

    expect(response?.status()).toBe(404);
    await expectVisibleNotFoundWithoutFixtureContent(page);
  });

  test("fallback 404 page does not render document editor or presentation regions", async ({
    page,
  }) => {
    await page.goto(`/present/${UNKNOWN_SHARE_ID}`);

    // Neither the document editor nor the presentation overlay should appear.
    await expect(
      page.getByRole("region", { name: "Presentation" }),
    ).toHaveCount(0);
    // The editor toolbar contains the "Export document" button — must be absent.
    await expect(
      page.getByRole("button", { name: "Export document" }),
    ).toHaveCount(0);
    // No document title input (editor landmark).
    await expect(page.getByLabel(/document title/i)).toHaveCount(0);
  });
});
