import { expect, test } from "@playwright/test";

import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileAssetPath,
  profileAssetSharePath,
  profilePresentEmbedPath,
  profilePresentPath,
  profileShareSegment,
} from "../helpers/profile";
import { unauthenticatedRequest } from "../helpers/credential-gate";

const UNKNOWN_SHARE_ID = "ui-matrix-missing-share-id";

test.describe("UI matrix: public render, share, embed, and present", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run public-render UI matrix checks",
  );

  test("valid public present route renders seeded slide content", async ({
    page,
  }) => {
    const response = await page.goto(profilePresentPath());
    expect(response?.status()).toBe(200);

    const region = page.getByRole("region", { name: /^Presentation/ });
    await expect(region).toBeVisible({ timeout: 20_000 });
    await expect(
      page
        .getByText(E2E_PROFILE_FIXTURE.slideTitleText, { exact: false })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("presentation embed route suppresses top HUD chrome and renders the first slide", async ({
    page,
  }) => {
    const response = await page.goto(profilePresentEmbedPath());
    expect(response?.status()).toBe(200);

    const region = page.getByRole("region", { name: /^Presentation/ });
    await expect(region).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("Presentation controls")).toHaveCount(0);
    await expect(
      page.getByRole("progressbar", { name: "Presentation progress" }),
    ).toHaveCount(0);
    await expect(
      page
        .getByText(E2E_PROFILE_FIXTURE.slideTitleText, { exact: false })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: "Next slide" }).last(),
    ).toBeVisible();
  });

  test("unknown share and present routes return safe 404s without fixture leaks", async () => {
    const publicRequest = unauthenticatedRequest();
    for (const route of [
      `/share/${UNKNOWN_SHARE_ID}`,
      `/present/${UNKNOWN_SHARE_ID}`,
    ]) {
      const response = await publicRequest.get(route);
      const body = await response.text();
      expect(response.status(), route).toBe(404);
      expect(body, route).toMatch(/not found|404/i);
      expect(body, route).not.toContain(E2E_PROFILE_FIXTURE.documentTitle);
      expect(body, route).not.toContain(E2E_PROFILE_FIXTURE.slideTitleText);
    }
  });

  test("share-bound slide assets require an active present or embed binding", async () => {
    const publicRequest = unauthenticatedRequest();
    const presentAsset = await publicRequest.get(
      profileAssetSharePath("present"),
    );
    expect(presentAsset.status()).toBe(200);
    expect((await presentAsset.body()).byteLength).toBeGreaterThan(0);

    const embedAsset = await publicRequest.get(profileAssetSharePath("embed"));
    expect(embedAsset.status()).toBe(200);
    expect((await embedAsset.body()).byteLength).toBeGreaterThan(0);

    for (const deniedPath of [
      profileAssetPath(),
      `${profileAssetPath()}?shareId=${E2E_PROFILE_FIXTURE.shareId}&shareMode=view`,
      `${profileAssetPath()}?shareId=rotated-share-id&shareMode=present`,
    ]) {
      const denied = await publicRequest.get(deniedPath);
      expect(denied.status(), deniedPath).toBe(403);
      expect(await denied.text(), deniedPath).toMatch(/forbidden/i);
    }
  });

  test("valid public share route renders a read-only document surface", async ({
    page,
  }) => {
    const response = await page.goto(`/share/${profileShareSegment()}`);
    expect(response?.status()).toBe(200);
    await expect(
      page
        .getByText(E2E_PROFILE_FIXTURE.documentBodyText, { exact: false })
        .first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel(/document title/i)).toHaveCount(0);
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Open slide editor" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Export document" }),
    ).toHaveCount(0);
  });

  test("public share visuals expose an accessible lightbox lifecycle", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await page.goto(`/share/${profileShareSegment()}`);
    expect(response?.status()).toBe(200);

    const visual = page.getByRole("button", {
      name: "E2E profile flow — enlarge visual",
    });
    await expect(visual).toBeVisible({ timeout: 20_000 });
    await expect(visual).toHaveAttribute("aria-haspopup", "dialog");
    await expect(visual).toHaveAttribute("aria-expanded", "false");

    await visual.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", {
      name: "E2E profile flow — enlarged",
    });
    const closeButton = dialog.getByRole("button", {
      name: "Close enlarged visual",
    });
    await expect(dialog).toBeVisible();
    await expect(closeButton).toBeFocused();
    await expect(visual).toHaveAttribute("aria-expanded", "true");
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe("hidden");

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(visual).toBeFocused();
    await expect(visual).toHaveAttribute("aria-expanded", "false");
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe("");

    await page.setViewportSize({ width: 390, height: 844 });
    await visual.click();
    await expect(dialog).toBeVisible();
    await expect(closeButton).toBeVisible();
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
    await closeButton.click();
    await expect(dialog).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});
