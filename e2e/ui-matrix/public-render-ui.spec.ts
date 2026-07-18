import { expect, test } from "@playwright/test";

import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
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

  test("share-bound slide assets serve only with present or embed binding", async () => {
    const publicRequest = unauthenticatedRequest();
    const presentAsset = await publicRequest.get(
      profileAssetSharePath("present"),
    );
    expect(presentAsset.status()).toBe(200);
    expect((await presentAsset.body()).byteLength).toBeGreaterThan(0);

    const embedAsset = await publicRequest.get(profileAssetSharePath("embed"));
    expect(embedAsset.status()).toBe(200);
    expect((await embedAsset.body()).byteLength).toBeGreaterThan(0);
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
  });
});
