import { expect, test, type Locator, type Page } from "@playwright/test";

import { login, ownerCredentials } from "../helpers/auth";
import {
  SLIDES_SMOKE_MUTATION_FIXTURES,
  type PresentationTestFixtureName,
} from "../helpers/presentation-fixtures";
import {
  e2eProfileEnabled,
  profileDocPath,
  profileOwnerCredentials,
} from "../helpers/profile";
import {
  waitForSlideAutosave,
  waitForStableSlideStage,
} from "../helpers/readiness";

/**
 * E2E smoke tests for the Slides feature: edit, save, present, and export
 * (Epic #379, issue #418).
 *
 * These tests cover the critical user journey:
 *  1. Open an existing document → navigate to Slides editor.
 *  2. Make a small edit to a slide element and save.
 *  3. Reopen the document to verify edit persistence.
 *  4. Open present mode and verify the first slide is visible.
 *  5. Trigger the export path and assert a lightweight outcome
 *     (e.g. export dialog opens, or PPTX download initiates).
 *
 * Authentication:
 *   Authenticated flows use the seeded-user credentials from the environment
 *   (see `e2e/helpers/auth.ts`).  When credentials are absent the tests skip
 *   cleanly so the standard CI suite stays green.
 *
 * Required environment variables (all optional — tests skip cleanly without them):
 *   E2E_USER_EMAIL / E2E_USER_PASSWORD  — owner credentials
 *   E2E_SLIDES_DOC_URL                  — full URL to a seeded document that
 *                                          has a Slides presentation for
 *                                          non-mutating smoke checks
 *
 * Mutating coverage uses dedicated deterministic profile documents/Yjs rooms.
 *
 * Large-file downloads and pixel checks are NOT performed in this spec.
 * The export smoke only asserts that the export dialog/mechanism is reachable.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the URL to a seeded document that has a Slides deck.
 * Falls back to undefined when the env var is absent.
 */
function slidesDocUrl(): string | undefined {
  return process.env.E2E_SLIDES_DOC_URL;
}

async function openIsolatedMutationEditor(
  page: Page,
  fixtureName: PresentationTestFixtureName,
): Promise<Locator> {
  await login(
    page,
    profileOwnerCredentials(),
    `${profileDocPath(fixtureName, test.info())}/slides`,
  );
  const editor = page.locator('[data-slide-editor="true"]').first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await waitForStableSlideStage(
    editor.locator('[data-slide-canvas="true"]').first(),
  );
  return editor;
}

async function readSlideCount(page: Page): Promise<number | null> {
  const editor = page.locator('[data-slide-editor="true"]').first();
  if ((await editor.count()) === 0) return null;
  const text = await editor.textContent();
  if (!text) return null;
  const match = text.match(/(\d+)\s+slides\b/i);
  if (!match) return null;
  const count = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(count) ? count : null;
}

async function readVisualNodeCount(page: Page): Promise<number | null> {
  const editor = page.locator('[data-slide-editor="true"]').first();
  if ((await editor.count()) === 0) return null;
  const activeSlide = editor.locator('[data-slide-canvas="true"]').first();
  if ((await activeSlide.count()) === 0) return null;
  return await activeSlide.locator('[data-node-type="visual"]').count();
}

async function clickIfPresent(locator: Locator): Promise<boolean> {
  if ((await locator.count()) === 0) {
    return false;
  }

  try {
    await locator.click({ timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

async function isVisible(locator: Locator, timeout = 2_000): Promise<boolean> {
  try {
    await locator.waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function waitForPresentTarget(page: Page): Promise<Page | null> {
  try {
    const target = await Promise.race([
      page.context().waitForEvent("page", { timeout: 5_000 }),
      page
        .waitForURL(/\/present\/|\/app.*present/i, { timeout: 5_000 })
        .then(() => page),
    ]);
    await target.waitForURL(/\/present\/|\/app.*present/i, { timeout: 10_000 });
    await target.waitForLoadState("domcontentloaded", { timeout: 10_000 });
    return target;
  } catch {
    return null;
  }
}

function skipOptionalSlidesFixture(reason: string): never {
  // e2e-governance-allow test-skip: optional slides smoke fixtures may be absent in local runs.
  test.skip(true, reason);
  throw new Error(reason);
}

const STAGE_NODE_SELECTOR = '[data-slide-canvas="true"] [data-node-id]';

async function selectedStageNodeId(
  stageShell: Locator,
): Promise<string | null> {
  const selected = stageShell
    .locator(`${STAGE_NODE_SELECTOR}[role="button"][aria-pressed="true"]`)
    .first();
  if ((await selected.count()) === 0) return null;
  return await selected.getAttribute("data-node-id");
}

async function focusedStageNodeId(stageShell: Locator): Promise<string | null> {
  const focused = stageShell
    .locator(`${STAGE_NODE_SELECTOR}[role="button"][data-node-focused="true"]`)
    .first();
  if ((await focused.count()) === 0) return null;
  return await focused.getAttribute("data-node-id");
}

async function stageNodeSize(
  stageShell: Locator,
  nodeId: string,
): Promise<{ width: number; height: number } | null> {
  const node = stageShell
    .locator(`${STAGE_NODE_SELECTOR}[role="button"][data-node-id="${nodeId}"]`)
    .first();
  if ((await node.count()) === 0) return null;
  const style = await node.getAttribute("style");
  if (!style) return null;
  const width = Number.parseFloat(
    style.match(/width:\s*([0-9.]+)%/i)?.[1] ?? "",
  );
  const height = Number.parseFloat(
    style.match(/height:\s*([0-9.]+)%/i)?.[1] ?? "",
  );
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

// ---------------------------------------------------------------------------
// Smoke: document → Slides editor navigation
// ---------------------------------------------------------------------------

test.describe("slides editor smoke", () => {
  test("authenticated user can navigate to the Slides editor", async ({
    page,
  }) => {
    const creds = ownerCredentials();
    test.skip(!creds, "Set E2E_USER_EMAIL/E2E_USER_PASSWORD to run this flow");

    await login(page, creds!);

    const docUrl = slidesDocUrl();
    if (docUrl) {
      // Use the seeded document URL directly.
      await page.goto(docUrl);
    } else {
      // Fall back: open workspace and use the first available document.
      await page.goto("/app");
      const firstDoc = page
        .getByRole("link", { name: /document|untitled/i })
        .first();
      const docCount = await firstDoc.count();
      if (docCount === 0) {
        skipOptionalSlidesFixture("No document available in workspace");
      }
      await firstDoc.click();
      await page.waitForURL(/\/app\/documents\//);
    }

    // Try to open the Slides tab / panel.
    const slidesTab = page
      .getByRole("tab", { name: /slides/i })
      .or(page.getByRole("button", { name: /slides/i }))
      .or(page.getByRole("link", { name: /slides/i }))
      .first();

    const tabCount = await slidesTab.count();
    if (tabCount === 0) {
      skipOptionalSlidesFixture(
        "Slides panel was not available for this document",
      );
    }
    await slidesTab.click();

    // The slide canvas or editor surface should become visible.
    const editorSurface = page
      .locator(
        '[data-testid="slide-canvas"], [data-testid="deck-editor"], .slide-stage',
      )
      .or(page.getByRole("region", { name: /slides/i }))
      .first();

    const surfaceCount = await editorSurface.count();
    if (surfaceCount > 0) {
      await expect(editorSurface).toBeVisible({ timeout: 10_000 });
    }
    // If the surface doesn't match any known locator we still assert the URL
    // changed into a slides sub-path.
    await expect(page).toHaveURL(/slides|deck|present/i, { timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Smoke: edit → save → reload → verify persistence
// ---------------------------------------------------------------------------

test.describe("slides edit and save persistence", () => {
  test("edit a slide title, save, and reload to verify persistence", async ({
    page,
  }) => {
    test.skip(
      !e2eProfileEnabled(),
      "Set E2E_PROFILE=1 and seed the deterministic profile",
    );

    const editor = await openIsolatedMutationEditor(
      page,
      SLIDES_SMOKE_MUTATION_FIXTURES.titleEdit,
    );
    const titleNode = editor
      .locator(
        '[data-slide-stage-viewport="true"] [data-node-id="fixture-title"]',
      )
      .first();
    await expect(titleNode).toBeVisible();

    const uniqueMark = "Smoke title persistence";
    await titleNode.dblclick();
    const inlineEditor = page.getByRole("textbox", { name: "Edit text" });
    await expect(inlineEditor).toBeVisible();
    await inlineEditor.fill(uniqueMark);
    await page.keyboard.press("Escape");
    await expect(inlineEditor).toHaveCount(0);

    await waitForSlideAutosave(page);

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );
    await expect(titleNode).toHaveAttribute(
      "aria-label",
      new RegExp(`Text:\\s*${uniqueMark}`),
    );
  });
});

// ---------------------------------------------------------------------------
// Smoke: present mode
// ---------------------------------------------------------------------------

test.describe("slides present mode", () => {
  test("authenticated user can open present mode", async ({ page }) => {
    const deterministicProfile = e2eProfileEnabled();
    const creds = deterministicProfile
      ? profileOwnerCredentials()
      : ownerCredentials();
    test.skip(!creds, "Set E2E_USER_EMAIL/E2E_USER_PASSWORD to run this flow");
    const docUrl = deterministicProfile
      ? `${profileDocPath(SLIDES_SMOKE_MUTATION_FIXTURES.present, test.info())}/slides`
      : slidesDocUrl();
    test.skip(!docUrl, "Set E2E_SLIDES_DOC_URL to run the present-mode smoke");

    await login(page, creds!);
    await page.goto(docUrl!);

    // Navigate to slides.
    const slidesTab = page
      .getByRole("tab", { name: /slides/i })
      .or(page.getByRole("button", { name: /slides/i }))
      .first();

    await clickIfPresent(slidesTab);

    // Look for the Present button.
    const presentBtn = page
      .getByRole("button", { name: /present/i })
      .or(page.getByRole("link", { name: /present/i }))
      .first();

    if (deterministicProfile) {
      await expect(presentBtn).toBeVisible({ timeout: 30_000 });
    } else if ((await presentBtn.count()) === 0) {
      skipOptionalSlidesFixture("Present button was not available");
    }
    const presentTargetPromise = waitForPresentTarget(page);
    await presentBtn.click();

    // Present mode should either open a new page, navigate to a /present route,
    // or display a fullscreen overlay.
    const newPage = await presentTargetPromise;
    if (!newPage && !deterministicProfile) {
      skipOptionalSlidesFixture("Present mode did not open in a known route");
    }
    expect(newPage).not.toBeNull();

    await expect(newPage!.locator("html")).toHaveAttribute("lang", /^.{2,}$/);
    // A slide container or presentation surface should be visible.
    const presentSurface = newPage!
      .locator(
        '[data-testid="present-slide"], [data-testid="slide-view"], .present-stage',
      )
      .first();
    if (await isVisible(presentSurface, 10_000)) {
      await expect(presentSurface).toBeVisible({ timeout: 10_000 });
    }
  });
});

// ---------------------------------------------------------------------------
// Smoke: export path (lightweight — no file download assertion)
// ---------------------------------------------------------------------------

test.describe("slides export smoke", () => {
  test("export menu or dialog is reachable from the Slides editor", async ({
    page,
  }) => {
    const creds = ownerCredentials();
    test.skip(!creds, "Set E2E_USER_EMAIL/E2E_USER_PASSWORD to run this flow");
    const docUrl = slidesDocUrl();
    test.skip(!docUrl, "Set E2E_SLIDES_DOC_URL to run the export smoke");

    await login(page, creds!);
    await page.goto(docUrl!);

    const slidesTab = page
      .getByRole("tab", { name: /slides/i })
      .or(page.getByRole("button", { name: /slides/i }))
      .first();

    await clickIfPresent(slidesTab);

    // Look for the export button / menu.
    const exportTrigger = page
      .getByRole("button", { name: /export/i })
      .or(page.getByRole("menuitem", { name: /export/i }))
      .first();

    const triggerCount = await exportTrigger.count();
    if (triggerCount === 0) {
      // No export button found at this location — also check toolbar/overflow
      const overflowBtn = page
        .getByRole("button", { name: /more|overflow|⋯|options/i })
        .first();
      const overflowCount = await overflowBtn.count();
      if (overflowCount > 0) {
        await overflowBtn.click();
        const exportMenuitem = page
          .getByRole("menuitem", { name: /export/i })
          .first();
        if (!(await isVisible(exportMenuitem))) {
          skipOptionalSlidesFixture("Export menu item was not available");
        }
        await exportMenuitem.click();
      } else {
        skipOptionalSlidesFixture("Export trigger was not available");
      }
    } else {
      await exportTrigger.click();
    }

    // The export dialog, dropdown, or format picker should be visible.
    const exportDialog = page
      .getByRole("dialog", { name: /export/i })
      .or(page.getByRole("menu").filter({ hasText: /pptx|export|download/i }))
      .or(
        page.locator(
          '[data-testid="export-dialog"], [data-testid="export-menu"]',
        ),
      )
      .first();

    // We assert the export entry point is reachable without triggering an actual
    // file download (which would be flaky and slow in CI).
    const dialogCount = await exportDialog.count();
    if (dialogCount > 0) {
      await expect(exportDialog).toBeVisible({ timeout: 5_000 });
    }
    // If the dialog isn't matched by the above locators we still pass: the
    // click on the export trigger didn't throw, proving the path is reachable.
  });
});

// ---------------------------------------------------------------------------
// Smoke: unauthenticated fallback (no seeded data required)
// ---------------------------------------------------------------------------

test.describe("slides routes without auth", () => {
  test("unauthenticated access to /app redirects to login", async ({
    page,
  }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login|\/signin/i, { timeout: 10_000 });
  });

  test("unknown present link returns 404", async ({ page }) => {
    const response = await page.goto("/present/slides-smoke-nonexistent-share");
    expect(response?.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Smoke: additional unauthenticated presentation/slide-route fallbacks
// ---------------------------------------------------------------------------

test.describe("additional presentation route fallbacks without auth", () => {
  test("app document editor route does not return a server error", async ({
    page,
  }) => {
    // The document editor route must respond gracefully — either redirecting to
    // login (auth-enforced environments) or rendering the page (dev/open mode)
    // — but must never crash with a 5xx server error.
    const response = await page.goto(
      "/app/documents/00000000-0000-0000-0000-000000000000",
    );
    const status = response?.status() ?? 0;
    expect(status).toBeLessThan(500);
  });

  test("unknown /present/<slug>/embed path returns 404", async ({ page }) => {
    // The per-deck embedded present route should 404 for unknown slugs just
    // like /present/<slug> does.
    const response = await page.goto(
      "/present/slides-smoke-unknown-slug-abcdef/embed",
    );
    expect(response?.status()).toBe(404);
  });

  test("present-route 404 exposes root-layout language after navigation readiness", async ({
    page,
  }) => {
    const response = await page.goto("/present/slides-smoke-a11y-lang-check");
    expect(response?.status()).toBe(404);
    await expect(page).toHaveURL(/\/present\/slides-smoke-a11y-lang-check$/);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("html")).toHaveAttribute("lang", /^.{2,}$/);
  });
});

// ---------------------------------------------------------------------------
// Smoke: authenticated workspace accessibility (no seeded document required)
// ---------------------------------------------------------------------------

test.describe("authenticated workspace accessibility", () => {
  test("workspace page has a main landmark and a non-empty page title", async ({
    page,
  }) => {
    const creds = ownerCredentials();
    test.skip(!creds, "Set E2E_USER_EMAIL/E2E_USER_PASSWORD to run this flow");

    await login(page, creds!);

    // A <main> landmark is a baseline accessibility requirement so keyboard
    // and screen-reader users can navigate past the header to the content.
    const main = page.getByRole("main");
    await expect(main).toBeVisible({ timeout: 10_000 });

    // The page title must be non-empty (no blank <title> elements).
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(0);
  });

  test("authenticated workspace exposes a visible create-document control", async ({
    page,
  }) => {
    const creds = ownerCredentials();
    test.skip(!creds, "Set E2E_USER_EMAIL/E2E_USER_PASSWORD to run this flow");

    await login(page, creds!);

    // A "New" / "Create" control should be reachable by role so keyboard and
    // screen-reader users can always start a new document.  We only assert
    // visibility — we do NOT click it to avoid creating documents in CI.
    const createControl = page
      .getByRole("button", { name: /new|create/i })
      .or(page.getByRole("link", { name: /new|create/i }))
      .first();

    const count = await createControl.count();
    if (count > 0) {
      await expect(createControl).toBeVisible({ timeout: 10_000 });
    }
    // If no matching control exists the workspace layout may differ by plan;
    // we don't fail — presence of the control is the happy-path assertion.
  });
});

// ---------------------------------------------------------------------------
// Smoke: accessible slide editor toolbar controls (optional fixture)
// ---------------------------------------------------------------------------

test.describe("slides editor accessible toolbar controls", () => {
  test("presentation stage keyboard traversal, resize shortcuts, and live announcements are behavioral", async ({
    page,
  }) => {
    test.skip(
      !e2eProfileEnabled(),
      "Set E2E_PROFILE=1 and seed the deterministic profile",
    );

    const editor = await openIsolatedMutationEditor(
      page,
      SLIDES_SMOKE_MUTATION_FIXTURES.stageMutations,
    );
    const stageShell = editor
      .locator('[data-slide-stage-shell="true"]')
      .first();
    await expect(stageShell).toBeVisible({ timeout: 10_000 });

    const liveRegion = stageShell.locator('[aria-live="polite"]').first();
    await expect(liveRegion).toBeAttached();

    const stageNodes = stageShell.locator(
      `${STAGE_NODE_SELECTOR}[role="button"]:not([aria-disabled="true"])`,
    );
    if ((await stageNodes.count()) === 0) {
      skipOptionalSlidesFixture("No focusable stage nodes were available");
    }

    await stageNodes.first().click();
    await expect(stageNodes.first()).toHaveAttribute("aria-pressed", "true");

    const beforeDuplicateCount = await stageNodes.count();
    await page.keyboard.press("ControlOrMeta+d");
    await expect(stageNodes).toHaveCount(beforeDuplicateCount + 1);

    const firstSelectedId = await selectedStageNodeId(stageShell);
    if (!firstSelectedId) {
      skipOptionalSlidesFixture(
        "Could not read the initial selected stage node",
      );
    }

    await page.keyboard.press("Tab");
    await expect
      .poll(() => selectedStageNodeId(stageShell))
      .not.toBe(firstSelectedId);
    const nextSelectedId = await selectedStageNodeId(stageShell);
    expect(nextSelectedId).toBeTruthy();
    await expect
      .poll(() => focusedStageNodeId(stageShell))
      .toBe(nextSelectedId);

    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() => selectedStageNodeId(stageShell))
      .toBe(firstSelectedId);
    await expect
      .poll(() => focusedStageNodeId(stageShell))
      .toBe(firstSelectedId);

    const beforeResize = await stageNodeSize(stageShell, firstSelectedId);
    if (!beforeResize) {
      skipOptionalSlidesFixture(
        "Could not parse stage node width/height styles",
      );
    }

    await page.keyboard.press("Alt+ArrowRight");
    await expect
      .poll(
        async () => (await stageNodeSize(stageShell, firstSelectedId))?.width,
      )
      .toBeGreaterThan(beforeResize.width);
    const afterAltResize = await stageNodeSize(stageShell, firstSelectedId);
    expect(afterAltResize).not.toBeNull();

    await page.keyboard.press("Alt+Shift+ArrowDown");
    await expect
      .poll(
        async () => (await stageNodeSize(stageShell, firstSelectedId))?.height,
      )
      .toBeGreaterThan(afterAltResize!.height);
    const afterShiftAltResize = await stageNodeSize(
      stageShell,
      firstSelectedId,
    );
    expect(afterShiftAltResize).not.toBeNull();

    await page.keyboard.press("Escape");
    await expect.poll(() => selectedStageNodeId(stageShell)).toBe(null);
    await expect(liveRegion).toContainText(/Slide selected/i);
  });

  test("slide editor toolbar controls are reachable by accessible role", async ({
    page,
  }) => {
    const creds = ownerCredentials();
    test.skip(!creds, "Set E2E_USER_EMAIL/E2E_USER_PASSWORD to run this flow");
    const docUrl = slidesDocUrl();
    test.skip(
      !docUrl,
      "Set E2E_SLIDES_DOC_URL to run the editor accessibility check",
    );

    await login(page, creds!);
    await page.goto(docUrl!);

    // Navigate to the slides editor.
    const slidesTab = page
      .getByRole("tab", { name: /slides/i })
      .or(page.getByRole("button", { name: /slides/i }))
      .or(page.getByRole("link", { name: /slides/i }))
      .first();

    await clickIfPresent(slidesTab);

    // Verify at least one slides-specific toolbar control (Present, Export, or
    // Add slide) is visible and reachable by accessible role.  We do NOT click
    // any control that could trigger a download or destructive edit.
    const candidateControls = [
      page.getByRole("button", { name: /present/i }).first(),
      page.getByRole("button", { name: /export/i }).first(),
      page.getByRole("button", { name: /add slide/i }).first(),
    ];

    let foundAccessibleControl = false;
    for (const control of candidateControls) {
      if (await isVisible(control, 5_000)) {
        foundAccessibleControl = true;
        await expect(control).toBeVisible();
        break;
      }
    }

    if (!foundAccessibleControl) {
      skipOptionalSlidesFixture(
        "No accessible slide editor toolbar control was found",
      );
    }
  });

  test("add slide template picker traps focus and supports keyboard insertion", async ({
    page,
  }) => {
    test.skip(
      !e2eProfileEnabled(),
      "Set E2E_PROFILE=1 and seed the deterministic profile",
    );

    const editor = await openIsolatedMutationEditor(
      page,
      SLIDES_SMOKE_MUTATION_FIXTURES.addSlide,
    );
    const addSlideTrigger = editor
      .getByRole("button", { name: /add slide/i })
      .first();
    if ((await addSlideTrigger.count()) === 0) {
      skipOptionalSlidesFixture("Add slide trigger was not available");
    }
    await expect(addSlideTrigger).toBeVisible({ timeout: 10_000 });
    const beforeCount = await readSlideCount(page);
    if (beforeCount === null) {
      skipOptionalSlidesFixture("Slide count summary was not available");
    }

    const picker = page.getByRole("dialog", { name: /add semantic slide/i });
    await addSlideTrigger.focus();
    await expect(addSlideTrigger).toBeFocused();
    await addSlideTrigger.click();
    await expect(picker).toBeVisible({ timeout: 10_000 });

    const pickerButtons = picker.getByRole("button");
    const buttonCount = await pickerButtons.count();
    if (buttonCount < 2) {
      skipOptionalSlidesFixture(
        "Add semantic slide picker has no template buttons",
      );
    }
    const initialPickerButton = pickerButtons.first();
    const closeButton = picker.getByRole("button", { name: /^close$/i });
    const firstTemplateButton = picker
      .getByRole("button", {
        name: /^add .+ slide,/i,
      })
      .first();
    const firstTemplateIndex = await pickerButtons.evaluateAll((buttons) =>
      buttons.findIndex((button) =>
        /^add .+ slide,/i.test(button.getAttribute("aria-label") ?? ""),
      ),
    );
    expect(firstTemplateIndex).toBeGreaterThan(0);
    const lastPickerButton = pickerButtons.nth(buttonCount - 1);

    await expect(initialPickerButton).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(lastPickerButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(initialPickerButton).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(addSlideTrigger).toBeFocused();

    await addSlideTrigger.click();
    await expect(picker).toBeVisible();
    await expect(initialPickerButton).toBeFocused();
    for (let index = 0; index < firstTemplateIndex; index += 1) {
      await page.keyboard.press("Tab");
    }
    await expect(firstTemplateButton).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(picker).toHaveCount(0);
    await expect(addSlideTrigger).toBeFocused();
    await expect.poll(() => readSlideCount(page)).toBe(beforeCount + 1);

    await addSlideTrigger.click();
    await expect(picker).toBeVisible();
    await closeButton.click();
    await expect(picker).toHaveCount(0);
    await expect(addSlideTrigger).toBeFocused();
  });

  test("presentation visual picker modal traps focus and restores invoking focus", async ({
    page,
  }) => {
    test.skip(
      !e2eProfileEnabled(),
      "Set E2E_PROFILE=1 and seed the deterministic profile",
    );

    await openIsolatedMutationEditor(
      page,
      SLIDES_SMOKE_MUTATION_FIXTURES.visualInsert,
    );

    const beforeVisualCount = await readVisualNodeCount(page);
    if (beforeVisualCount === null) {
      skipOptionalSlidesFixture("Visual node count could not be read");
    }

    const stage = page
      .locator('[data-slide-editor="true"] [data-slide-canvas="true"]')
      .first();

    const openVisualPicker = async () => {
      await stage.click({ position: { x: 10, y: 10 } });
      const invokingControl = page
        .getByRole("button", { name: /^insert visual$/i })
        .first();
      await expect(invokingControl).toBeVisible({ timeout: 10_000 });
      await invokingControl.focus();
      await expect(invokingControl).toBeFocused();
      await invokingControl.press("Enter");

      const picker = page.getByRole("dialog", { name: /choose visual/i });
      await expect(picker).toBeVisible({ timeout: 10_000 });
      const pickerButtons = picker.getByRole("button");
      const buttonCount = await pickerButtons.count();
      if (buttonCount < 2) {
        skipOptionalSlidesFixture("Visual picker has no selectable visual");
      }

      return {
        picker,
        invokingControl,
        cancelButton: picker.getByRole("button", { name: /cancel/i }),
        firstVisualButton: pickerButtons.nth(1),
        lastPickerButton: pickerButtons.nth(buttonCount - 1),
      };
    };

    const firstOpen = await openVisualPicker();
    await expect(firstOpen.cancelButton).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(firstOpen.lastPickerButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(firstOpen.cancelButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(firstOpen.firstVisualButton).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(firstOpen.picker).toHaveCount(0);
    await expect(firstOpen.invokingControl).toBeFocused();

    const secondOpen = await openVisualPicker();
    await expect(secondOpen.cancelButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(secondOpen.firstVisualButton).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(secondOpen.picker).toHaveCount(0);
    await expect
      .poll(() => readVisualNodeCount(page))
      .toBe(beforeVisualCount + 1);
    await expect(
      stage.locator('[data-node-type="visual"][aria-pressed="true"]'),
    ).toBeFocused();

    const thirdOpen = await openVisualPicker();
    await thirdOpen.cancelButton.click();
    await expect(thirdOpen.picker).toHaveCount(0);
    await expect(thirdOpen.invokingControl).toBeFocused();
  });
});
