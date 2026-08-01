import { expect, test } from "@playwright/test";

import { login } from "../helpers/auth";
import {
  credentialGatedRequest,
  unauthenticatedRequest,
} from "../helpers/credential-gate";
import {
  e2eProfileEnabled,
  profileAssetSharePath,
  fixturePngBuffer,
  profileAssetPath,
  profileDocPath,
  profileOwnerCredentials,
  profilePresentPath,
  profilePrivateAssetPath,
  profileViewerCredentials,
} from "../helpers/profile";
import {
  waitForSlideAutosave,
  waitForStableSlideStage,
} from "../helpers/readiness";

/**
 * Slide image upload + protected asset access-control E2E (Epic #517, #521).
 *
 * Two concerns are covered:
 *  1. Upload a small raster image through the slide inspector, persist it on the
 *     image element, RELOAD, and verify the rendered slide still resolves the
 *     protected `/api/slide-assets/…` URL.
 *  2. Access control on protected slide assets:
 *     - the owner can fetch its document's protected bytes (200);
 *     - an anonymous/unrelated request to a PRIVATE document's asset is denied
 *       (403/404) — access-control denial, distinct from a missing file;
 *     - a public present/embed share policy still serves the shared document's
 *       asset to anonymous requests (200).
 *
 * Runs ONLY under the deterministic E2E profile (`E2E_PROFILE=1` +
 * `npm run db:seed:e2e`); skips cleanly otherwise so the fast gate stays green.
 */

test.describe("slide asset access control", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run slide-asset checks",
  );

  test("owner fetches protected bytes; anonymous denied for private, allowed for shared @required-profile", async ({
    page,
  }) => {
    // Owner session — fetches go out with the owner's auth cookie.
    await login(page, profileOwnerCredentials());

    const ownerShared =
      await credentialGatedRequest(page).get(profileAssetPath());
    expect(
      ownerShared.status(),
      "access: owner should fetch its shared-document asset (200)",
    ).toBe(200);
    expect(
      ownerShared.headers()["content-type"] ?? "",
      "access: shared asset should be served as image/png",
    ).toContain("image/png");
    expect(
      (await ownerShared.body()).byteLength,
      "missing-file: owner asset bytes should be nonzero",
    ).toBeGreaterThan(0);

    const ownerPrivate = await credentialGatedRequest(page).get(
      profilePrivateAssetPath(),
    );
    expect(
      ownerPrivate.status(),
      "access: owner should fetch its private-document asset (200)",
    ).toBe(200);

    const publicRequest = unauthenticatedRequest();
    const anonPrivate = await publicRequest.get(profilePrivateAssetPath());
    expect(
      anonPrivate.status(),
      "access: anonymous request to a PRIVATE asset must be denied (403/404)",
    ).toBeGreaterThanOrEqual(403);
    expect(anonPrivate.status()).toBeLessThan(405);

    const anonSharedUnbound = await publicRequest.get(profileAssetPath());
    expect(
      anonSharedUnbound.status(),
      "access: anonymous shared asset without share binding must be denied",
    ).toBe(403);

    const anonShared = await publicRequest.get(profileAssetSharePath());
    expect(
      anonShared.status(),
      "access: share-bound public present asset must serve anonymously (200)",
    ).toBe(200);
    expect(
      (await anonShared.body()).byteLength,
      "missing-file: shared asset bytes should be nonzero for anonymous",
    ).toBeGreaterThan(0);
  });

  test("an unrelated authenticated user is denied the private asset", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    try {
      const viewerPage = await ctx.newPage();
      // The viewer has no relationship to the private (workspace-less) document.
      await login(viewerPage, profileViewerCredentials());

      const res = await credentialGatedRequest(viewerPage).get(
        profilePrivateAssetPath(),
      );
      expect(
        res.status(),
        "access: unrelated user must be denied the private asset (403/404)",
      ).toBeGreaterThanOrEqual(403);
      expect(res.status()).toBeLessThan(405);
    } finally {
      await ctx.close();
    }
  });
});

test.describe("slide image upload round-trip", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run slide upload",
  );

  test("uploads via the inspector and the reloaded slide resolves the protected asset @required-profile", async ({
    page,
  }, testInfo) => {
    await login(page, profileOwnerCredentials());
    await page.goto(profileDocPath("slideAssetUpload", test.info()));

    // Open the slide editor.
    const openEditor = page.getByRole("link", { name: "Open slide editor" });
    await expect(
      openEditor,
      "upload: 'Open slide editor' link not found",
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("status").filter({ hasText: /^Live$/ }),
    ).toBeVisible({ timeout: 30_000 });
    const slidesPath = `${profileDocPath("slideAssetUpload", test.info())}/slides`;
    await expect(openEditor).toHaveAttribute("href", slidesPath);
    await page.goto(slidesPath);
    const editor = page.locator('[data-slide-editor="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );

    // Select the seeded image element (its accessible name is its alt text).
    const seededImage = editor.getByRole("button", {
      name: "Seeded fixture image",
    });
    await expect(
      seededImage,
      "upload: seeded image element not present on the canvas",
    ).toBeVisible({ timeout: 20_000 });
    await seededImage.click();

    // The editor exposes image upload controls with explicit accepted formats.
    const fileInput = page.locator('input[type="file"][accept*="image/png"]');
    await expect(
      fileInput.first(),
      "upload: inspector image file input not found after selecting element",
    ).toHaveCount(1, { timeout: 10_000 });

    await fileInput.first().setInputFiles({
      name: "uploaded-fixture.png",
      mimeType: "image/png",
      buffer: fixturePngBuffer(),
    });

    // No product upload error should be surfaced by the inspector.
    // Exclude Next.js's #__next-route-announcer__ live region, which always
    // renders with role="alert" but is a framework artefact, not a product error.
    await expect(
      page.locator('[role="alert"]:not(#__next-route-announcer__)'),
      "upload: inspector reported an upload error",
    ).toHaveCount(0, { timeout: 15_000 });

    await waitForSlideAutosave(page);
    await page.reload();

    // Verify the rendered slide still resolves a protected asset URL by loading
    // the public present page (which renders the persisted deck's image) and
    // confirming the asset request returns real bytes.
    const present = await page.goto(
      profilePresentPath("slideAssetUpload", test.info()),
    );
    expect(
      present?.status(),
      "upload: public present page should load after upload",
    ).toBe(200);

    const slideImg = page.locator('img[src*="/api/slide-assets/"]').first();
    await expect(
      slideImg,
      "upload: reloaded slide does not render a protected asset image",
    ).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        () =>
          slideImg.evaluate(
            (node) =>
              node instanceof HTMLImageElement &&
              node.complete &&
              node.naturalWidth > 0 &&
              node.naturalHeight > 0,
          ),
        {
          message: "upload: protected image pixels should finish loading",
          timeout: 20_000,
        },
      )
      .toBe(true);

    const src = await slideImg.getAttribute("src");
    expect(src, "upload: protected image has no src").toBeTruthy();
    const assetResponse = await credentialGatedRequest(page).get(src!);
    expect(
      assetResponse.status(),
      "upload: protected asset URL did not resolve to servable bytes",
    ).toBe(200);

    const presentRegion = page.getByRole("region", { name: /^Presentation/ });
    await expect(
      presentRegion,
      "upload: public presentation region missing after upload",
    ).toBeVisible();
    await presentRegion.screenshot({
      path: testInfo.outputPath("uploaded-slide-present-mode.png"),
    });
  });
});
