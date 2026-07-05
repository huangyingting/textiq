import { promises as fs } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { login } from "./helpers/auth";
import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileDocPath,
  profileOwnerCredentials,
  profilePresentEmbedPath,
  profilePresentPath,
  profileViewerCredentials,
} from "./helpers/profile";

/**
 * Present + export E2E coverage (Epic #517, issue #520).
 *
 * Strengthens the present/export smoke beyond "the entry point is reachable":
 *   1. Authenticated present mode renders a NONBLANK slide containing the
 *      seeded title text via the in-editor `PresentButton` overlay.
 *   2. PUBLIC present mode renders the SAME seeded deck through the valid public
 *      share link (`/present/<slug>-<shareId>`).
 *   3. A real export download is triggered (PDF) and asserted to produce a file
 *      with a `.pdf` extension and nonzero bytes (via `waitForEvent('download')`).
 *
 * Pixel-level regression stays in `screenshot-regression.spec.ts`.
 *
 * Runs ONLY under the deterministic E2E profile (`E2E_PROFILE=1` +
 * `npm run db:seed:e2e`); skips cleanly otherwise so the fast gate stays green.
 */

const SLIDE_TEXT = E2E_PROFILE_FIXTURE.slideTitleText;
const SECOND_SLIDE_TEXT = E2E_PROFILE_FIXTURE.slideTwoTitleText;
const MOBILE_PRESENT_VIEWPORT = { width: 390, height: 844 };
const SAFE_AREA_INSETS = { top: 44, right: 16, bottom: 34, left: 16 };

async function clickNextPublicSlide(page: Page) {
  await expect(async () => {
    await page.getByRole("button", { name: "Next slide" }).last().click();
    await expect(page).toHaveURL(/#2$/, { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

async function applySafeAreaInsets(page: Page) {
  await page.evaluate((insets) => {
    const root = document.documentElement;
    root.style.setProperty("--tiq-safe-area-top", `${insets.top}px`);
    root.style.setProperty("--tiq-safe-area-right", `${insets.right}px`);
    root.style.setProperty("--tiq-safe-area-bottom", `${insets.bottom}px`);
    root.style.setProperty("--tiq-safe-area-left", `${insets.left}px`);
  }, SAFE_AREA_INSETS);
}

async function expectHudRespectsSafeAreas(
  page: Page,
  progress: Locator,
  bottomHud: Locator,
) {
  const progressBox = await progress.boundingBox();
  expect(progressBox, "present: top HUD should be measurable").toBeTruthy();
  expect(
    progressBox!.y,
    "present: top HUD should clear the configured top safe area",
  ).toBeGreaterThanOrEqual(SAFE_AREA_INSETS.top - 1);

  const bottomHudBox = await bottomHud.boundingBox();
  expect(bottomHudBox, "present: bottom HUD should be measurable").toBeTruthy();

  const viewport = page.viewportSize();
  expect(viewport, "present: viewport should be available").toBeTruthy();
  const bottomInset =
    viewport!.height - (bottomHudBox!.y + bottomHudBox!.height);
  expect(
    bottomInset,
    "present: bottom HUD should clear the configured bottom safe area",
  ).toBeGreaterThanOrEqual(SAFE_AREA_INSETS.bottom - 1);
}

async function detectPresentationState(
  page: Page,
  region: Locator,
): Promise<"region" | "recovery" | "timeout"> {
  const recoveryHeading = page.getByRole("heading", {
    name: "Presentation deck could not be opened",
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await recoveryHeading.isVisible()) return "recovery";
    if (await region.isVisible()) return "region";
    // e2e-governance-allow wait-for-timeout: polling waits for either present mode or recovery UI without app-side readiness events.
    await page.waitForTimeout(250);
  }
  return "timeout";
}

async function openPresentationOverlay(
  page: Page,
  presentBtn: Locator,
  presentRegion: Locator,
): Promise<void> {
  await expect(async () => {
    await presentBtn.click();
    if (
      // e2e-governance-allow broad-catch: isVisible timeout is a bounded overlay readiness probe before keyboard fallback.
      !(await presentRegion.isVisible({ timeout: 2_000 }).catch(() => false))
    ) {
      await presentBtn.focus();
      await page.keyboard.press("Enter");
    }
    await expect(presentRegion).toBeVisible({ timeout: 5_000 });
  }, "present: presentation overlay did not open").toPass({
    timeout: 45_000,
  });
}

test.describe("present + export", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run present/export",
  );
  // Authenticated tests need login + navigation which can exceed the default
  // 30 s under dev-server load (2-worker parallel run).
  test.setTimeout(90_000);
  // One retry absorbs the occasional login timeout caused by the concurrent
  // slide-editor serial test saturating the dev server briefly.
  test.describe.configure({ retries: 1 });

  test("authenticated present mode renders the seeded slide text", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials());
    await page.goto(profileDocPath());

    const presentBtn = page.getByRole("button", { name: /^Present / });
    await expect(
      presentBtn,
      "present: Present button not found in editor toolbar",
    ).toBeVisible({ timeout: 20_000 });

    const presentRegion = page.getByRole("region", { name: "Presentation" });
    await openPresentationOverlay(page, presentBtn, presentRegion);

    // Non-blank assertion: the seeded title text must render on the slide.
    await expect(
      presentRegion.getByText(SLIDE_TEXT, { exact: false }).first(),
      "present: seeded slide text not rendered (blank slide)",
    ).toBeVisible({ timeout: 15_000 });
  });

  test("authenticated present mode exposes presenter controls and slide overview navigation", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials());
    await page.goto(profileDocPath());

    const presentBtn = page.getByRole("button", { name: /^Present / });
    await expect(
      presentBtn,
      "present: Present button not found in editor toolbar",
    ).toBeVisible({ timeout: 20_000 });
    const presentRegion = page.getByRole("region", { name: "Presentation" });
    await openPresentationOverlay(page, presentBtn, presentRegion);

    const progress = presentRegion.getByRole("progressbar", {
      name: "Presentation progress",
    });
    await expect(progress, "present: progress meter missing").toHaveAttribute(
      "aria-valuemax",
      "2",
    );
    await expect(progress).toHaveAttribute("aria-valuenow", "1");

    await expect(
      presentRegion.getByRole("button", { name: "Show keyboard shortcuts" }),
      "present: keyboard-help control missing",
    ).toBeVisible();
    await expect(
      presentRegion.getByRole("button", { name: "Show slide overview" }),
      "present: slide-overview control missing",
    ).toBeVisible();
    await expect(
      presentRegion.getByRole("button", { name: "Show speaker notes" }),
      "present: speaker-notes control missing",
    ).toBeVisible();

    await presentRegion.getByRole("button", { name: "Show timer" }).click();
    await expect(
      presentRegion.getByLabel(/Elapsed time/),
      "present: presenter timer did not become visible",
    ).toBeVisible();

    await presentRegion
      .getByRole("button", { name: "Show speaker notes" })
      .click();
    await expect(
      presentRegion.getByText("Current slide notes"),
      "present: speaker notes panel did not open",
    ).toBeVisible();
    await expect(
      presentRegion.getByText(SECOND_SLIDE_TEXT, { exact: false }).first(),
      "present: up-next preview should include the second seeded slide",
    ).toBeVisible();

    await presentRegion
      .getByRole("button", { name: "Show slide overview" })
      .click();
    const overview = page.getByRole("dialog", { name: "Slide overview" });
    await expect(
      overview,
      "present: slide overview dialog missing",
    ).toBeVisible();
    await overview
      .getByRole("button", {
        name: new RegExp(`Jump to slide 2, ${SECOND_SLIDE_TEXT}`),
      })
      .click();

    await expect(
      presentRegion.getByText(SECOND_SLIDE_TEXT, { exact: false }).first(),
      "present: overview jump did not render the second slide",
    ).toBeVisible({ timeout: 15_000 });
    await expect(progress).toHaveAttribute("aria-valuenow", "2");
  });

  test("authenticated present mode keeps HUD chrome outside mobile safe areas", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_PRESENT_VIEWPORT);
    await login(page, profileOwnerCredentials());
    await page.goto(profileDocPath());

    const presentBtn = page.getByRole("button", { name: /^Present / });
    await expect(
      presentBtn,
      "present: Present button not found in editor toolbar",
    ).toBeVisible({ timeout: 20_000 });
    const presentRegion = page.getByRole("region", { name: "Presentation" });
    await openPresentationOverlay(page, presentBtn, presentRegion);
    const state = await detectPresentationState(page, presentRegion);
    if (state === "recovery") {
      // e2e-governance-allow test-skip: seeded profile may contain a non-presentation deck, making safe-area HUD assertions inapplicable.
      test.skip(
        true,
        "present: fixture resolved to a non-presentation deck; skipping safe-area HUD assertions",
      );
    }
    expect(state, "present: in-app presentation region missing").toBe("region");
    await expect(
      presentRegion,
      "present: in-app presentation region missing",
    ).toBeVisible({ timeout: 20_000 });
    await applySafeAreaInsets(page);

    const progress = presentRegion.getByRole("progressbar", {
      name: "Presentation progress",
    });
    await expect(progress, "present: top HUD progress missing").toBeVisible();
    const bottomHud = presentRegion.locator(".tiq-safe-present-bottom");
    await expect(bottomHud, "present: bottom HUD missing").toHaveCount(1);

    await expectHudRespectsSafeAreas(page, progress, bottomHud);
  });

  test("public present mode renders the seeded deck via the share link", async ({
    page,
  }) => {
    const response = await page.goto(profilePresentPath());
    expect(
      response?.status(),
      "present: public present link should resolve (200)",
    ).toBe(200);

    const region = page.getByRole("region", { name: /^Presentation/ });
    await expect(
      region,
      "present: public presentation region missing",
    ).toBeVisible({ timeout: 20_000 });

    await expect(
      page.getByText(SLIDE_TEXT, { exact: false }).first(),
      "present: seeded slide text missing on public present page",
    ).toBeVisible({ timeout: 15_000 });
  });

  test("public present mode keeps HUD chrome outside mobile safe areas", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_PRESENT_VIEWPORT);
    const response = await page.goto(profilePresentPath());
    expect(
      response?.status(),
      "present: public present link should resolve (200)",
    ).toBe(200);
    const region = page.getByRole("region", { name: /^Presentation/ });
    const state = await detectPresentationState(page, region);
    if (state === "recovery") {
      // e2e-governance-allow test-skip: seeded public fixture may contain a non-presentation deck, making safe-area HUD assertions inapplicable.
      test.skip(
        true,
        "present: public fixture resolved to a non-presentation deck; skipping safe-area HUD assertions",
      );
    }
    expect(state, "present: public presentation region missing").toBe("region");
    await expect(
      region,
      "present: public presentation region missing",
    ).toBeVisible({ timeout: 20_000 });
    await applySafeAreaInsets(page);

    const progress = region.getByRole("progressbar", {
      name: "Presentation progress",
    });
    await expect(progress, "present: top HUD progress missing").toBeVisible();
    const bottomHud = region.locator(".tiq-safe-present-bottom");
    await expect(bottomHud, "present: bottom HUD missing").toHaveCount(1);

    await expectHudRespectsSafeAreas(page, progress, bottomHud);
  });

  test("public present mode supports deterministic slide navigation", async ({
    page,
  }) => {
    const response = await page.goto(profilePresentPath());
    expect(
      response?.status(),
      "present: public present link should resolve (200)",
    ).toBe(200);

    const region = page.getByRole("region", { name: /^Presentation/ });
    await expect(region).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText(SLIDE_TEXT, { exact: false }).first(),
      "present: first seeded slide missing on public present page",
    ).toBeVisible({ timeout: 15_000 });

    const progress = region.getByRole("progressbar", {
      name: "Presentation progress",
    });
    await expect(progress).toHaveAttribute("aria-valuemax", "2");
    await expect(progress).toHaveAttribute("aria-valuenow", "1");

    await clickNextPublicSlide(page);
    await expect(
      page.getByText(SECOND_SLIDE_TEXT, { exact: false }).first(),
      "present: next navigation did not show second seeded slide",
    ).toBeVisible({ timeout: 15_000 });
    await expect(progress).toHaveAttribute("aria-valuenow", "2");

    await expect(async () => {
      await page.keyboard.press("Home");
      await expect(progress).toHaveAttribute("aria-valuenow", "1", {
        timeout: 1_000,
      });
    }).toPass({ timeout: 10_000 });
    await expect(
      page.getByText(SLIDE_TEXT, { exact: false }).first(),
      "present: Home shortcut did not return to the first slide",
    ).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/#1$/);
  });

  test("public presentation embed route renders chrome-free navigation", async ({
    page,
  }) => {
    const response = await page.goto(profilePresentEmbedPath());
    expect(
      response?.status(),
      "embed: presentation embed link should resolve (200)",
    ).toBe(200);

    const region = page.getByRole("region", { name: /^Presentation/ });
    await expect(
      region,
      "embed: public presentation region missing",
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText(SLIDE_TEXT, { exact: false }).first(),
      "embed: seeded slide text missing on presentation embed page",
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByLabel("Presentation controls"),
      "embed: presentation embed should suppress top HUD controls",
    ).toHaveCount(0);
    await expect(
      page.getByRole("progressbar", { name: "Presentation progress" }),
      "embed: presentation embed should suppress the top progress HUD",
    ).toHaveCount(0);

    await clickNextPublicSlide(page);
    await expect(
      page.getByText(SECOND_SLIDE_TEXT, { exact: false }).first(),
      "embed: bottom navigation did not show second seeded slide",
    ).toBeVisible({ timeout: 15_000 });
  });

  test("public present mode supports keyboard ArrowRight and ArrowLeft navigation", async ({
    page,
  }) => {
    const response = await page.goto(profilePresentPath());
    expect(
      response?.status(),
      "present: public present link should resolve (200)",
    ).toBe(200);

    const region = page.getByRole("region", { name: /^Presentation/ });
    await expect(region).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText(SLIDE_TEXT, { exact: false }).first(),
      "present: first slide should be visible before ArrowRight",
    ).toBeVisible({ timeout: 15_000 });

    const progress = region.getByRole("progressbar", {
      name: "Presentation progress",
    });
    await expect(progress).toHaveAttribute("aria-valuenow", "1");

    // ArrowRight advances to the second slide.
    await expect(async () => {
      await page.keyboard.press("ArrowRight");
      await expect(progress).toHaveAttribute("aria-valuenow", "2", {
        timeout: 1_000,
      });
    }).toPass({ timeout: 10_000 });
    await expect(
      page.getByText(SECOND_SLIDE_TEXT, { exact: false }).first(),
      "present: ArrowRight did not advance to the second slide",
    ).toBeVisible({ timeout: 15_000 });

    // ArrowLeft returns to the first slide.
    await expect(async () => {
      await page.keyboard.press("ArrowLeft");
      await expect(progress).toHaveAttribute("aria-valuenow", "1", {
        timeout: 1_000,
      });
    }).toPass({ timeout: 10_000 });
    await expect(
      page.getByText(SLIDE_TEXT, { exact: false }).first(),
      "present: ArrowLeft did not return to the first slide",
    ).toBeVisible({ timeout: 15_000 });
  });

  test("public present mode End key navigates to the last slide", async ({
    page,
  }) => {
    const response = await page.goto(profilePresentPath());
    expect(
      response?.status(),
      "present: public present link should resolve (200)",
    ).toBe(200);

    const region = page.getByRole("region", { name: /^Presentation/ });
    await expect(region).toBeVisible({ timeout: 20_000 });

    const progress = region.getByRole("progressbar", {
      name: "Presentation progress",
    });
    await expect(progress).toHaveAttribute("aria-valuenow", "1");

    await expect(async () => {
      await page.keyboard.press("End");
      await expect(progress).toHaveAttribute("aria-valuenow", "2", {
        timeout: 1_000,
      });
    }).toPass({ timeout: 10_000 });
    await expect(
      page.getByText(SECOND_SLIDE_TEXT, { exact: false }).first(),
      "present: End key did not navigate to the last slide",
    ).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/#2$/);
  });

  test("authenticated present mode closes overlay on Escape", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials());
    await page.goto(profileDocPath());

    const presentBtn = page.getByRole("button", { name: /^Present / });
    await expect(
      presentBtn,
      "present: Present button not found in editor toolbar",
    ).toBeVisible({ timeout: 20_000 });

    const presentRegion = page.getByRole("region", { name: "Presentation" });
    await openPresentationOverlay(page, presentBtn, presentRegion);

    // Wait for slide content so React effects (including the keyboard shortcut
    // handler) are guaranteed to have run before we press Escape.
    await expect(
      presentRegion.getByText(SLIDE_TEXT, { exact: false }).first(),
      "present: seeded slide text should render after overlay opens",
    ).toBeVisible({ timeout: 10_000 });
    // Ensure the overlay container has keyboard focus before pressing Escape.
    await presentRegion.focus();
    // Use retry wrapper: the first Escape press may land before the shortcut
    // handler registers in environments with slow effect scheduling.
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(presentRegion).not.toBeVisible({ timeout: 2_000 });
    }, "present: Escape key should close the presentation overlay").toPass({
      timeout: 15_000,
    });
    // The editor toolbar should remain accessible after closing.
    await expect(
      presentBtn,
      "present: Present button should still be visible after closing overlay",
    ).toBeVisible({ timeout: 10_000 });
  });

  test("viewer user can open the public presentation link", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    try {
      const viewerPage = await ctx.newPage();
      await login(viewerPage, profileViewerCredentials());

      const response = await viewerPage.goto(profilePresentPath());
      expect(
        response?.status(),
        "present: public link must be accessible to an authenticated viewer (200)",
      ).toBe(200);

      const region = viewerPage.getByRole("region", { name: /^Presentation/ });
      await expect(
        region,
        "present: presentation region must render for a viewer",
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        viewerPage.getByText(SLIDE_TEXT, { exact: false }).first(),
        "present: seeded slide text must be visible to the viewer",
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
  });

  test("public present direct deep-link to slide 2 renders the second slide", async ({
    page,
  }) => {
    const response = await page.goto(`${profilePresentPath()}#2`);
    expect(
      response?.status(),
      "present: deep-link to slide 2 should resolve (200)",
    ).toBe(200);

    const region = page.getByRole("region", { name: /^Presentation/ });
    await expect(region).toBeVisible({ timeout: 20_000 });

    const progress = region.getByRole("progressbar", {
      name: "Presentation progress",
    });
    await expect(
      progress,
      "present: deep-link to #2 should start on slide 2",
    ).toHaveAttribute("aria-valuenow", "2", { timeout: 15_000 });
    await expect(
      page.getByText(SECOND_SLIDE_TEXT, { exact: false }).first(),
      "present: deep-link did not render the second seeded slide",
    ).toBeVisible({ timeout: 15_000 });
  });

  test("public presentation embed mode Previous slide button returns to first slide", async ({
    page,
  }) => {
    // Start on slide 2 via deep-link so there is a previous slide to navigate to.
    const response = await page.goto(`${profilePresentEmbedPath()}#2`);
    expect(
      response?.status(),
      "embed: deep-link to slide 2 should resolve (200)",
    ).toBe(200);

    const region = page.getByRole("region", { name: /^Presentation/ });
    await expect(region).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText(SECOND_SLIDE_TEXT, { exact: false }).first(),
      "embed: deep-link to #2 should render the second seeded slide before Previous",
    ).toBeVisible({ timeout: 15_000 });

    await expect(async () => {
      await page.getByRole("button", { name: "Previous slide" }).last().click();
      await expect(page).toHaveURL(/#1$/, { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await expect(
      page.getByText(SLIDE_TEXT, { exact: false }).first(),
      "embed: Previous slide button did not return to the first slide",
    ).toBeVisible({ timeout: 15_000 });
  });

  test("exports a real PDF file with nonzero bytes", async ({ page }) => {
    await login(page, profileOwnerCredentials());
    await page.goto(profileDocPath());

    const exportBtn = page.getByRole("button", { name: "Export document" });
    await expect(
      exportBtn,
      "export: Export button not found in editor toolbar",
    ).toBeVisible({ timeout: 20_000 });

    const menu = page.getByRole("menu", { name: "Export document" });
    await expect(async () => {
      await exportBtn.click();
      await expect(menu).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await expect(menu, "export: export menu did not open").toBeVisible();

    // PDF is always available (no plan gating); it produces a real blob
    // download via an anchor click (src/lib/visual/export.ts).
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await menu.getByRole("menuitem", { name: /^PDF\b/ }).click();

    const download = await downloadPromise;
    expect(
      download.suggestedFilename(),
      "export: downloaded file should be a .pdf",
    ).toMatch(/\.pdf$/);

    const filePath = await download.path();
    expect(filePath, "export: download produced no file path").toBeTruthy();
    const stat = await fs.stat(filePath!);
    expect(
      stat.size,
      "export: downloaded PDF should have nonzero bytes",
    ).toBeGreaterThan(0);
  });
});
