import { promises as fs } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { login } from "../helpers/auth";
import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileDocPath,
  profileOwnerCredentials,
  profileShareSegment,
  profileViewerCredentials,
} from "../helpers/profile";
import type { PresentationTestFixtureName } from "../helpers/presentation-fixtures";
import {
  waitForSlideAutosave,
  waitForSlideAutosaveAfter,
  waitForStableSlideStage,
} from "../helpers/readiness";

async function activate(locator: Locator): Promise<void> {
  await locator.focus();
  await locator.press("Enter");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function documentLink(page: Page, title: string): Locator {
  return page
    .getByRole("link", { name: new RegExp(escapeRegExp(title), "i") })
    .first();
}

async function selectListboxOption(
  page: Page,
  label: RegExp,
  optionName: string,
): Promise<void> {
  await page.getByRole("button", { name: label }).click();
  const listbox = page.getByRole("listbox").last();
  await expect(listbox).toBeVisible();
  await listbox
    .getByRole("button", { name: new RegExp(escapeRegExp(optionName), "i") })
    .click();
  await expect(listbox).toHaveCount(0);
}

async function expectDocumentsInRelativeOrder(
  page: Page,
  titles: string[],
): Promise<void> {
  for (const title of titles) {
    await expect(documentLink(page, title)).toBeVisible();
  }
  const cardTexts = await page.locator("main ul > li").allTextContents();
  const indices = titles.map((title) =>
    cardTexts.findIndex((text) => text.includes(title)),
  );
  expect(
    indices.every((index) => index >= 0),
    `Expected dashboard cards for ${titles.join(", ")}`,
  ).toBe(true);
  expect(indices, `Expected ${titles.join(", ")} to be sorted`).toEqual(
    [...indices].sort((a, b) => a - b),
  );
}

async function waitForDashboardInteractivity(page: Page): Promise<void> {
  const favoritesButton = page.getByRole("button", {
    name: /show favorites only/i,
  });
  await expect(async () => {
    await favoritesButton.click();
    await expect(favoritesButton).toHaveAttribute("aria-pressed", "true", {
      timeout: 500,
    });
  }).toPass({ timeout: 10_000 });
  await favoritesButton.click();
  await expect(favoritesButton).toHaveAttribute("aria-pressed", "false");
}

async function openProfileDocument(
  page: Page,
  fixtureName?: PresentationTestFixtureName,
): Promise<void> {
  await login(page, profileOwnerCredentials(), profileDocPath(fixtureName));
  await expect(
    page.getByText(E2E_PROFILE_FIXTURE.documentBodyText),
  ).toBeVisible({ timeout: 60_000 });
}

async function openProfileSlideEditor(page: Page): Promise<Locator> {
  await activate(page.getByRole("link", { name: "Open slide editor" }));
  const editor = page.getByRole("dialog", { name: "Slide editor" }).first();
  await expect(editor).toBeVisible({ timeout: 60_000 });
  return editor;
}

async function expectHistoryFocusOnNodeOrStage(
  page: Page,
  expectedNodeId: string,
): Promise<void> {
  await expect(async () => {
    const focusTarget = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return null;
      const nodeId = active.getAttribute("data-node-id");
      if (nodeId) return `node:${nodeId}`;
      return active.getAttribute("data-slide-stage-viewport") === "true"
        ? "stage-viewport"
        : null;
    });
    expect(
      focusTarget === `node:${expectedNodeId}` ||
        focusTarget === "stage-viewport",
    ).toBe(true);
  }).toPass({ timeout: 5_000 });
}

test.describe("deterministic profile document editor smoke", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run profile smoke",
  );
  test.setTimeout(180_000);

  test("dashboard search, filters, sorting, favorites, and safe actions are deterministic", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials());

    await expect(
      page.getByRole("heading", { name: /your documents/i }),
    ).toBeVisible({ timeout: 60_000 });

    const alpha = E2E_PROFILE_FIXTURE.dashboardDocuments.alphaFavorite;
    const beta = E2E_PROFILE_FIXTURE.dashboardDocuments.betaTagged;
    const fixtureTitle = E2E_PROFILE_FIXTURE.documentTitle;
    const releaseGateTag = E2E_PROFILE_FIXTURE.dashboardTag;
    const fixtureDocument = documentLink(page, fixtureTitle);

    await expect(fixtureDocument).toBeVisible();
    await expect(documentLink(page, alpha.title)).toBeVisible();
    await expect(documentLink(page, beta.title)).toBeVisible();
    await waitForDashboardInteractivity(page);

    const search = page.getByRole("searchbox", { name: /search documents/i });
    await search.fill("__playwright_no_matching_document__");
    await expect(
      page.getByRole("heading", { name: /no documents match your search/i }),
    ).toBeVisible({ timeout: 10_000 });

    await search.fill("Alpha favorite deterministic dashboard");
    await expect(documentLink(page, alpha.title)).toBeVisible({
      timeout: 10_000,
    });
    await expect(documentLink(page, beta.title)).toHaveCount(0);

    await search.fill("");
    await expect(fixtureDocument).toBeVisible({ timeout: 10_000 });

    await selectListboxOption(page, /sort documents/i, "Title (A–Z)");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sort"))
      .toBe("title");
    await expectDocumentsInRelativeOrder(page, [
      alpha.title,
      beta.title,
      fixtureTitle,
    ]);

    const favoritesButton = page.getByRole("button", {
      name: /show favorites only/i,
    });
    await favoritesButton.click();
    await expect(favoritesButton).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("view"))
      .toBe("favorites");
    await expect(documentLink(page, alpha.title)).toBeVisible();
    await expect(documentLink(page, beta.title)).toHaveCount(0);
    await expect(documentLink(page, fixtureTitle)).toHaveCount(0);

    await favoritesButton.click();
    await expect(favoritesButton).toHaveAttribute("aria-pressed", "false");
    await selectListboxOption(page, /filter by tag/i, releaseGateTag.name);
    await expect
      .poll(() => new URL(page.url()).searchParams.get("tag"))
      .toBe(releaseGateTag.slug);
    await expect(documentLink(page, beta.title)).toBeVisible();
    await expect(documentLink(page, fixtureTitle)).toBeVisible();
    await expect(documentLink(page, alpha.title)).toHaveCount(0);

    await activate(
      page.getByRole("button", {
        name: new RegExp(`Actions for ${escapeRegExp(fixtureTitle)}`, "i"),
      }),
    );
    const actionsMenu = page.getByRole("menu");
    await expect(actionsMenu).toBeVisible();
    await activate(actionsMenu.getByRole("menuitem", { name: /^rename$/i }));
    const renameDialog = page.getByRole("dialog", {
      name: /rename document/i,
    });
    await expect(renameDialog).toBeVisible();
    await activate(renameDialog.getByRole("button", { name: /cancel/i }));
    await expect(renameDialog).toHaveCount(0);

    await activate(
      page.getByRole("button", {
        name: new RegExp(`Actions for ${escapeRegExp(fixtureTitle)}`, "i"),
      }),
    );
    await activate(page.getByRole("menuitem", { name: /^delete$/i }));
    const deleteDialog = page.getByRole("dialog", {
      name: /delete document/i,
    });
    await expect(deleteDialog).toBeVisible();
    await activate(deleteDialog.getByRole("button", { name: /cancel/i }));
    await expect(deleteDialog).toHaveCount(0);
    await expect(documentLink(page, fixtureTitle)).toBeVisible();
  });

  test("dashboard search, history, and template picker controls are reachable", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials());

    await expect(
      page.getByRole("heading", { name: /your documents/i }),
    ).toBeVisible({ timeout: 60_000 });

    const fixtureDocument = documentLink(
      page,
      E2E_PROFILE_FIXTURE.documentTitle,
    );
    await expect(fixtureDocument).toBeVisible();
    await waitForDashboardInteractivity(page);

    const search = page.getByRole("searchbox", { name: /search documents/i });
    await search.fill("__playwright_no_matching_document__");
    await expect(search).toHaveValue("__playwright_no_matching_document__");
    await expect(
      page.getByRole("heading", { name: /no documents match your search/i }),
    ).toBeVisible({ timeout: 10_000 });
    await search.fill("");
    await expect(search).toHaveValue("");
    await expect(fixtureDocument).toBeVisible();

    await activate(fixtureDocument);
    await page.waitForURL(/\/app\/documents\/[^/]+/);
    await expect(
      page.getByText(E2E_PROFILE_FIXTURE.documentBodyText),
    ).toBeVisible({ timeout: 60_000 });

    await page.goBack();
    await expect(page).toHaveURL(/\/app$/);
    await expect(fixtureDocument).toBeVisible();

    await page.keyboard.press("n");
    const templateDialog = page.getByRole("dialog", {
      name: /start a new document/i,
    });
    await expect(templateDialog).toBeVisible();
    await expect(
      templateDialog.getByRole("button", { name: /blank template/i }),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(templateDialog).toHaveCount(0);
  });

  test("mobile authenticated navigation drawer reaches workspace and brand routes", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, profileOwnerCredentials());

    await activate(documentLink(page, E2E_PROFILE_FIXTURE.documentTitle));
    await page.waitForURL(/\/app\/documents\/[^/]+/);
    await expect(
      page.getByText(E2E_PROFILE_FIXTURE.documentBodyText),
    ).toBeVisible({ timeout: 60_000 });
    await activate(page.getByRole("link", { name: /back/i }));
    await expect(page).toHaveURL(/\/app$/);
    await expect(
      documentLink(page, E2E_PROFILE_FIXTURE.documentTitle),
    ).toBeVisible({ timeout: 30_000 });

    await activate(page.getByRole("button", { name: /open navigation menu/i }));
    const drawer = page.getByRole("dialog", { name: /navigation menu/i });
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole("link", { name: /documents/i }),
    ).toBeVisible();
    const workspacesLink = drawer.getByRole("link", { name: /workspaces/i });
    await expect(workspacesLink).toHaveAttribute("href", "/app/workspaces");
    await workspacesLink.click();

    await expect(page).toHaveURL(/\/app\/workspaces$/, { timeout: 60_000 });
    await expect(
      page.getByRole("heading", { name: /^workspaces$/i }),
    ).toBeVisible({ timeout: 20_000 });

    await activate(page.getByRole("button", { name: /open navigation menu/i }));
    const brandsLink = page
      .getByRole("dialog", { name: /navigation menu/i })
      .getByRole("link", { name: /brands/i });
    await expect(brandsLink).toHaveAttribute("href", "/app/brands");
    await brandsLink.click();
    await expect(page).toHaveURL(/\/app\/brands$/, { timeout: 60_000 });
    await expect(
      page.getByRole("heading", { name: /brand studio/i }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("opens the seeded document editor with deterministic content @required-profile", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials(), profileDocPath());

    await expect(
      page.getByText(E2E_PROFILE_FIXTURE.documentBodyText),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByLabel("Document statistics")).toContainText(
      "9 words",
    );
  });

  test("document editor survives reload and browser back-forward navigation", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials());

    await activate(documentLink(page, E2E_PROFILE_FIXTURE.documentTitle));
    await page.waitForURL(new RegExp(`${profileDocPath()}$`));
    await expect(
      page.getByText(E2E_PROFILE_FIXTURE.documentBodyText),
    ).toBeVisible({ timeout: 60_000 });

    await page.reload();
    await expect(
      page.getByText(E2E_PROFILE_FIXTURE.documentBodyText),
    ).toBeVisible({ timeout: 60_000 });

    await page.goBack();
    await expect(page).toHaveURL(/\/app$/);
    await expect(
      documentLink(page, E2E_PROFILE_FIXTURE.documentTitle),
    ).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${profileDocPath()}$`));
    await expect(
      page.getByText(E2E_PROFILE_FIXTURE.documentBodyText),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("editor chrome exposes non-mutating panels and share metadata", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials(), profileDocPath());

    await expect(
      page.getByText(E2E_PROFILE_FIXTURE.documentBodyText),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByLabel("Tags")).toContainText(
      E2E_PROFILE_FIXTURE.dashboardTag.name,
    );
    await expect(page.getByLabel("Document statistics")).toContainText(
      /min read · \d+ words?/i,
    );

    const pageGuides = page.getByRole("button", { name: /page guides/i });
    await expect(pageGuides).toBeVisible();
    await expect(pageGuides).toHaveAttribute("aria-pressed", "false");
    await activate(pageGuides);
    await expect(
      page.getByRole("button", { name: /hide page-break guides/i }),
    ).toHaveAttribute("aria-pressed", "true");
    await activate(
      page.getByRole("button", { name: /hide page-break guides/i }),
    );
    await expect(pageGuides).toHaveAttribute("aria-pressed", "false");

    const styleButton = page.getByRole("button", { name: /^style$/i });
    await expect(styleButton).toBeEnabled({ timeout: 20_000 });
    await activate(styleButton);
    const styleDialog = page.getByRole("dialog", { name: /document style/i });
    await expect(styleDialog).toBeVisible();
    await expect(styleDialog.getByText(/document adjustments/i)).toBeVisible();
    await expect(
      styleDialog
        .getByRole("button", {
          name: /apply .* theme to all visuals/i,
        })
        .first(),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(styleDialog).toHaveCount(0);

    await activate(page.getByRole("button", { name: /^share$/i }));
    const shareDialog = page.getByRole("dialog", {
      name: /share this document/i,
    });
    await expect(shareDialog).toBeVisible();
    await expect(
      shareDialog.getByRole("switch", { name: /public link enabled/i }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      shareDialog.locator('input[readonly][value*="/share/"]').first(),
    ).toHaveValue(new RegExp(`/share/${profileShareSegment()}$`));
    await expect(shareDialog.getByLabel("Embed code")).toHaveValue(
      new RegExp(`/embed/${profileShareSegment()}`),
    );
    await expect(shareDialog.getByLabel("Presentation link")).toHaveValue(
      new RegExp(`/present/${profileShareSegment()}$`),
    );
    await expect(shareDialog.getByText(/allow embedding/i)).toBeVisible();
    await expect(shareDialog.getByText(/allow presentation/i)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(shareDialog).toHaveCount(0);

    await activate(page.getByRole("button", { name: /version history/i }));
    const historyPanel = page.getByRole("dialog", { name: /version history/i });
    await expect(historyPanel).toBeVisible();
    await expect(
      historyPanel
        .getByText(/loading|no saved versions/i)
        .or(historyPanel.locator("li").first())
        .first(),
    ).toBeVisible({ timeout: 10_000 });
    await historyPanel
      .getByRole("button", { name: /close version history/i })
      .focus();
    await page.keyboard.press("Enter");
    await expect(historyPanel).toHaveCount(0);
  });

  test("editor import and export controls expose non-destructive menu states", async ({
    page,
  }) => {
    await openProfileDocument(page);

    const importInput = page.getByLabel("Import document file");
    await expect(importInput).toHaveAttribute("accept", /markdown|\.md/i);
    const importButton = page.getByRole("button", { name: /^import$/i });
    await expect(importButton).toBeEnabled();
    await importButton.focus();
    await expect(importButton).toBeFocused();

    const exportButton = page.getByRole("button", { name: "Export document" });
    await expect(exportButton).toHaveAttribute("aria-expanded", "false");
    await activate(exportButton);
    await expect(exportButton).toHaveAttribute("aria-expanded", "true");

    const exportMenu = page.getByRole("menu", { name: "Export document" });
    await expect(exportMenu).toBeVisible();
    await expect(
      exportMenu.getByRole("menuitem", { name: /^PDF\b/ }),
    ).toBeEnabled();
    await expect(
      exportMenu.getByRole("menuitem", { name: /^PPTX deck\b/ }),
    ).toHaveAttribute("aria-disabled", /^(true|false)$/);
    await expect(
      exportMenu.getByRole("menuitem", { name: /^Infographic PNG\b/ }),
    ).toBeVisible();
    await expect(
      exportMenu.getByRole("menuitem", { name: /^Infographic PDF\b/ }),
    ).toBeVisible();

    const defaultWidth = exportMenu.getByRole("button", { name: "1080px" });
    await expect(defaultWidth).toHaveAttribute("aria-pressed", "true");
    const wideWidth = exportMenu.getByRole("button", { name: "1200px" });
    await activate(wideWidth);
    await expect(wideWidth).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("Escape");
    await expect(exportMenu).toHaveCount(0);
    await expect(exportButton).toHaveAttribute("aria-expanded", "false");
  });

  test("slide editor opens, exposes controls and insert panels, then closes cleanly", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openProfileDocument(page);
    const editor = await openProfileSlideEditor(page);
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );

    await expect(
      page.getByRole("toolbar", { name: "Context toolbar" }),
    ).toBeVisible();
    // Use position-agnostic regex — a previous test may have reordered the deck,
    // so the slot numbers are not guaranteed to match the seed order on retry.
    const slideOneButton = editor.getByRole("button", {
      name: new RegExp(
        `Slide \\d+: ${escapeRegExp(E2E_PROFILE_FIXTURE.slideTitleText)}`,
      ),
    });
    await expect(slideOneButton).toBeVisible({ timeout: 15_000 });
    const slideTwoButton = editor.getByRole("button", {
      name: new RegExp(
        `Slide \\d+: ${escapeRegExp(E2E_PROFILE_FIXTURE.slideTwoTitleText)}`,
      ),
    });
    await expect(slideTwoButton).toBeVisible({ timeout: 15_000 });
    await activate(slideTwoButton);

    const railToggle = editor.getByRole("button", {
      name: "Hide slide thumbnails",
    });
    await expect(railToggle).toHaveAttribute("aria-pressed", "true");
    await activate(railToggle);
    await expect(
      editor.getByRole("button", { name: "Show slide thumbnails" }),
    ).toHaveAttribute("aria-pressed", "false");
    await activate(
      editor.getByRole("button", { name: "Show slide thumbnails" }),
    );
    await expect(railToggle).toHaveAttribute("aria-pressed", "true");

    await activate(editor.getByRole("button", { name: /^Notes$/i }));
    await expect(editor.getByLabel("Speaker notes")).toBeVisible();
    await expect(editor.getByLabel("Speaker notes")).toHaveValue(
      "Use this seeded slide to verify presentation navigation.",
    );

    // The "Keyboard shortcuts" command lives in the "Open more deck commands"
    // menu as a menuitem — it is not a standalone button.
    const moreCommandsButton = editor.getByRole("button", {
      name: "Open more deck commands",
    });
    await activate(moreCommandsButton);
    const moreCommandsMenu = page.getByRole("menu", {
      name: "More deck commands",
    });
    await expect(moreCommandsMenu).toBeVisible();
    await activate(
      moreCommandsMenu.getByRole("menuitem", { name: "Keyboard shortcuts" }),
    );
    const shortcutsDialog = page.getByRole("dialog", {
      name: "Keyboard shortcuts",
    });
    await expect(shortcutsDialog).toBeVisible();
    await expect(
      shortcutsDialog.getByText(/move selection/i).first(),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(shortcutsDialog).toHaveCount(0);

    // Click the stage shell to clear any selection; the context toolbar then
    // shows slide-level insert tools (slide is the current object).
    await editor
      .locator('[data-slide-stage-viewport="true"]')
      .click({ position: { x: 5, y: 5 } });
    const contextToolbar = page.getByRole("toolbar", {
      name: "Context toolbar",
    });
    await expect(contextToolbar).toBeVisible();
    await expect(
      contextToolbar.getByRole("button", { name: "Insert text" }),
    ).toBeVisible();
    await expect(
      contextToolbar.getByRole("button", { name: "Insert image" }),
    ).toBeVisible();
    await expect(
      contextToolbar.getByRole("button", { name: "From document" }),
    ).toBeVisible();

    // Open the "From document" menu and verify the seeded visual block is present.
    // The deterministic fixture also carries a text block id; the dedicated
    // block-id preservation spec exercises that text insertion deeply.
    await activate(
      contextToolbar.getByRole("button", { name: "From document" }),
    );
    const fromDocMenu = page.getByRole("menu", {
      name: "Insert from document",
    });
    await expect(fromDocMenu).toBeVisible();
    await expect(
      fromDocMenu.getByRole("menuitem", { name: /e2e profile flow/i }),
    ).toBeVisible();
    // Toggle closed via the toolbar button (pressing Escape would bubble to the
    // slide editor's global Escape handler and close the editor itself).
    await activate(
      contextToolbar.getByRole("button", { name: "From document" }),
    );
    await expect(fromDocMenu).toHaveCount(0);

    await activate(editor.getByRole("button", { name: "Close slide editor" }));
    await expect(editor).toHaveCount(0);
  });

  test("slide rail duplicate, delete, and reorder actions mutate deck state and persist after reload", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openProfileDocument(page, "editorRailMutations");
    const editor = await openProfileSlideEditor(page);
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );
    const filmstrip = editor.locator('[aria-label="Slide filmstrip"]');
    const slideButtons = filmstrip.getByRole("button", {
      name: /^Slide \d+(: |$)/,
    });
    const goToSlide = (index: number) =>
      filmstrip.getByRole("button", {
        name: new RegExp(`^Slide ${index}(: |$)`),
      });
    const duplicateSlide = (index: number) =>
      filmstrip.getByRole("button", { name: `Duplicate slide ${index}` });
    const deleteSlide = (index: number) =>
      filmstrip.getByRole("button", { name: `Delete slide ${index}` });
    const titleNode = (title: string) =>
      editor
        .getByRole("button", {
          name: new RegExp(`Text:\\s*${escapeRegExp(title)}`, "i"),
        })
        .first();

    await expect(slideButtons).toHaveCount(2, { timeout: 15_000 });
    await activate(goToSlide(1));
    await expect(titleNode(E2E_PROFILE_FIXTURE.slideTitleText)).toBeVisible();

    await filmstrip.locator('[data-slide-index="0"]').hover();
    await duplicateSlide(1).click();
    await expect(slideButtons).toHaveCount(3);
    await expect(goToSlide(2)).toHaveAttribute("aria-current", "true");
    await activate(goToSlide(3));
    await expect(
      titleNode(E2E_PROFILE_FIXTURE.slideTwoTitleText),
    ).toBeVisible();
    await activate(goToSlide(2));
    await expect(titleNode(E2E_PROFILE_FIXTURE.slideTitleText)).toBeVisible();

    await filmstrip.locator('[data-slide-index="1"]').hover();
    await deleteSlide(2).click();
    await expect(slideButtons).toHaveCount(2);
    await expect(goToSlide(3)).toHaveCount(0);
    await expect(
      titleNode(E2E_PROFILE_FIXTURE.slideTwoTitleText),
    ).toBeVisible();

    await activate(goToSlide(1));
    await expect(titleNode(E2E_PROFILE_FIXTURE.slideTitleText)).toBeVisible();
    await waitForSlideAutosaveAfter(page, async () => {
      await goToSlide(1).focus();
      await page.keyboard.press("Alt+ArrowRight");
    });
    await expect(goToSlide(2)).toHaveAttribute("aria-current", "true");
    await expect(titleNode(E2E_PROFILE_FIXTURE.slideTitleText)).toBeVisible();

    await activate(goToSlide(1));
    await expect(
      titleNode(E2E_PROFILE_FIXTURE.slideTwoTitleText),
    ).toBeVisible();
    await activate(goToSlide(2));
    await expect(titleNode(E2E_PROFILE_FIXTURE.slideTitleText)).toBeVisible();

    // The slide editor lives at /app/documents/{id}/slides (a separate route).
    // After reload we remain on that route — the "Open slide editor" link only
    // exists in the document editor, so we locate the dialog directly instead
    // of calling openProfileSlideEditor.  Accept beforeunload if the save-state
    // race briefly leaves the guard listener registered after save completes.
    page.once("dialog", (dialog) => void dialog.accept());
    await page.reload();
    const reopenedEditor = page
      .getByRole("dialog", { name: "Slide editor" })
      .first();
    await waitForStableSlideStage(
      reopenedEditor.locator('[data-slide-canvas="true"]').first(),
    );
    const reopenedFilmstrip = reopenedEditor.locator(
      '[aria-label="Slide filmstrip"]',
    );
    const reopenedGoToSlide = (index: number) =>
      reopenedFilmstrip.getByRole("button", {
        name: new RegExp(`^Slide ${index}(: |$)`),
      });
    const reopenedTitleNode = (title: string) =>
      reopenedEditor
        .getByRole("button", {
          name: new RegExp(`Text:\\s*${escapeRegExp(title)}`, "i"),
        })
        .first();
    await expect(
      reopenedFilmstrip.getByRole("button", { name: /^Slide \d+(: |$)/ }),
    ).toHaveCount(2);
    await activate(reopenedGoToSlide(1));
    await expect(
      reopenedTitleNode(E2E_PROFILE_FIXTURE.slideTwoTitleText),
    ).toBeVisible();
    await activate(reopenedGoToSlide(2));
    await expect(
      reopenedTitleNode(E2E_PROFILE_FIXTURE.slideTitleText),
    ).toBeVisible();
  });

  test("rapid slide edit and delete cannot race Save now or regeneration into stale rollback", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openProfileDocument(page, "editorRailMutations");
    let editor = await openProfileSlideEditor(page);
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );
    const seededTitle = E2E_PROFILE_FIXTURE.slideTitleText;
    const generatedTitle = "Document";
    const generatedSecondTitle = "E2E profile flow";
    const generatedBody = E2E_PROFILE_FIXTURE.documentBodyText;
    const savedTitle = `${generatedTitle} [save-now race]`;
    const regenerateRaceTitle = `${generatedTitle} [regenerate race]`;
    const textNode = (root: Locator, text: string) =>
      root
        .locator('[data-slide-stage-viewport="true"]')
        .getByRole("button", { name: `Text: ${text}`, exact: true });
    const slideItems = (root: Locator) =>
      root
        .locator('[aria-label="Slide filmstrip"]')
        .locator("[data-slide-index]");

    const seededTitleNode = textNode(editor, seededTitle);
    // The prior serial test may have reordered the fixture — navigate to
    // whichever filmstrip slide contains seededTitle before inspecting it.
    const initFilmstrip = editor.locator('[aria-label="Slide filmstrip"]');
    const seededSlideButton = initFilmstrip.getByRole("button", {
      name: new RegExp(`^Slide \\d+: ${escapeRegExp(seededTitle)}`),
    });
    await expect(seededSlideButton).toBeVisible({ timeout: 15_000 });
    await seededSlideButton.click();
    await expect(seededTitleNode).toBeVisible({ timeout: 10_000 });
    const seededTitleNodeId =
      await seededTitleNode.getAttribute("data-node-id");
    expect(seededTitleNodeId).toBeTruthy();

    // Return to slide 1 so that after regeneration the viewport is on the
    // newly-generated first slide (title "Document"), not on the visual slide.
    await initFilmstrip.getByRole("button", { name: /^Slide 1(: |$)/ }).click();

    await editor
      .getByRole("button", { name: "Regenerate deck from document" })
      .click();
    const generatedTitleNode = textNode(editor, generatedTitle);
    await expect(generatedTitleNode).toBeVisible({ timeout: 30_000 });
    await expect(textNode(editor, generatedBody)).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      editor.getByRole("button", {
        name: `Slide 2: ${generatedSecondTitle}`,
        exact: true,
      }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(textNode(editor, seededTitle)).toHaveCount(0);
    await expect(
      textNode(editor, E2E_PROFILE_FIXTURE.slideTwoTitleText),
    ).toHaveCount(0);
    expect(await generatedTitleNode.getAttribute("data-node-id")).not.toBe(
      seededTitleNodeId,
    );
    await waitForSlideAutosave(page);

    await generatedTitleNode.dblclick();
    let inlineEditor = page.getByRole("textbox", { name: "Edit text" });
    await inlineEditor.fill(savedTitle);
    await page.keyboard.press("Escape");
    await expect(textNode(editor, savedTitle)).toBeVisible();

    let filmstrip = editor.locator('[aria-label="Slide filmstrip"]');
    await filmstrip
      .getByRole("button", {
        name: `Slide 2: ${generatedSecondTitle}`,
        exact: true,
      })
      .hover();
    await filmstrip.getByRole("button", { name: "Delete slide 2" }).click();
    await expect(slideItems(editor)).toHaveCount(1);
    await expect(textNode(editor, generatedSecondTitle)).toHaveCount(0);
    await editor
      .getByRole("button", { name: "Open more deck commands" })
      .click();
    await page
      .getByRole("menu", { name: "More deck commands" })
      .getByRole("menuitem", { name: "Save now" })
      .click();
    await waitForSlideAutosave(page);

    await page.reload();
    editor = page.getByRole("dialog", { name: "Slide editor" }).first();
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );
    filmstrip = editor.locator('[aria-label="Slide filmstrip"]');
    await expect(slideItems(editor)).toHaveCount(1);
    await expect(
      filmstrip.getByRole("button", {
        name: `Slide 1: ${savedTitle}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(textNode(editor, savedTitle)).toBeVisible();
    await expect(textNode(editor, generatedBody)).toBeVisible();
    await expect(textNode(editor, generatedSecondTitle)).toHaveCount(0);
    await expect(textNode(editor, seededTitle)).toHaveCount(0);

    await textNode(editor, savedTitle).dblclick();
    inlineEditor = page.getByRole("textbox", { name: "Edit text" });
    await inlineEditor.fill(regenerateRaceTitle);
    await page.keyboard.press("Escape");
    await expect(textNode(editor, regenerateRaceTitle)).toBeVisible();
    await editor
      .getByRole("button", { name: "Regenerate deck from document" })
      .click();
    await expect(textNode(editor, generatedTitle)).toBeVisible({
      timeout: 30_000,
    });
    await expect(textNode(editor, generatedBody)).toBeVisible({
      timeout: 10_000,
    });
    await expect(textNode(editor, regenerateRaceTitle)).toHaveCount(0);
    await expect(textNode(editor, savedTitle)).toHaveCount(0);
    await expect(textNode(editor, seededTitle)).toHaveCount(0);
    await expect(slideItems(editor)).toHaveCount(2);
    await waitForSlideAutosave(page);

    await page.reload();
    editor = page.getByRole("dialog", { name: "Slide editor" }).first();
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );
    filmstrip = editor.locator('[aria-label="Slide filmstrip"]');
    await expect(slideItems(editor)).toHaveCount(2);
    await expect(
      filmstrip.getByRole("button", {
        name: `Slide 1: ${generatedTitle}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      filmstrip.getByRole("button", {
        name: `Slide 2: ${generatedSecondTitle}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(textNode(editor, generatedTitle)).toBeVisible();
    await expect(textNode(editor, generatedBody)).toBeVisible();
    await expect(textNode(editor, regenerateRaceTitle)).toHaveCount(0);
    await expect(textNode(editor, savedTitle)).toHaveCount(0);
    await expect(textNode(editor, seededTitle)).toHaveCount(0);
  });

  test("deckpresentation create-edit-save-reopen-export-share roundtrip stays deterministic", async ({
    page,
    browser,
  }) => {
    const closeEditor = async (target: Locator) => {
      await target.getByRole("button", { name: "Close slide editor" }).click();
      const discardDialog = page.getByRole("dialog", {
        name: /close and discard changes/i,
      });
      // e2e-governance-allow broad-catch: optional discard dialog may disappear between locator creation and visibility check.
      if (await discardDialog.isVisible().catch(() => false)) {
        await discardDialog
          .getByRole("button", { name: /discard changes/i })
          .click();
      }
      await expect(target).toHaveCount(0, { timeout: 10_000 });
    };

    await page.setViewportSize({ width: 1280, height: 900 });
    await login(
      page,
      profileOwnerCredentials(),
      profileDocPath("editorRoundtrip"),
    );
    await expect(
      page.getByRole("link", { name: "Open slide editor" }),
    ).toBeVisible({ timeout: 60_000 });
    const editor = await openProfileSlideEditor(page);
    const filmstrip = editor.locator('[aria-label="Slide filmstrip"]');
    const slideButtons = filmstrip.getByRole("button", {
      name: /^Slide \d+(: |$)/,
    });
    const goToSlide = (index: number) =>
      filmstrip.getByRole("button", {
        name: new RegExp(`^Slide ${index}(: |$)`),
      });
    const duplicateSlide = (index: number) =>
      filmstrip.getByRole("button", { name: `Duplicate slide ${index}` });

    const originalSlideCount = await slideButtons.count();
    expect(originalSlideCount).toBeGreaterThanOrEqual(2);

    // Navigate by title so the test remains coupled to fixture content rather
    // than a positional implementation detail.
    const contentSlideButton = filmstrip.getByRole("button", {
      name: new RegExp(
        `^Slide \\d+: ${escapeRegExp(E2E_PROFILE_FIXTURE.slideTitleText)}`,
      ),
    });
    await activate(contentSlideButton);
    // Derive the 1-based slide number so duplicate/navigate calls are correct.
    const contentSlideAriaLabel =
      (await contentSlideButton.getAttribute("aria-label")) ?? "Slide 1";
    const contentSlideNum = parseInt(
      contentSlideAriaLabel.match(/^Slide (\d+)/)?.[1] ?? "1",
      10,
    );

    const titleNode = editor.locator('[data-node-id="fixture-title"]').first();
    await expect(titleNode).toBeVisible();
    const originalLabel =
      (await titleNode.getAttribute("aria-label")) ??
      `Text: ${E2E_PROFILE_FIXTURE.slideTitleText}`;
    const originalTitle = originalLabel.replace(/^Text:\s*/i, "").trim();
    const roundtripSuffix = "[Deck roundtrip]";
    const editedTitle = originalTitle.endsWith(roundtripSuffix)
      ? originalTitle.slice(0, -roundtripSuffix.length).trim()
      : `${originalTitle} ${roundtripSuffix}`;

    // Hover the filmstrip item for the content slide using its 0-based index
    // (data-slide-index is 0-based; contentSlideNum is 1-based).
    await filmstrip
      .locator(`[data-slide-index="${contentSlideNum - 1}"]`)
      .hover();
    await duplicateSlide(contentSlideNum).click();
    await expect(slideButtons).toHaveCount(originalSlideCount + 1);

    // The original content slide keeps its position after duplication; navigate
    // back to it (the copy is inserted after it).
    await activate(goToSlide(contentSlideNum));
    await titleNode.dblclick();
    const inlineEditor = page.getByRole("textbox", { name: "Edit text" });
    await expect(inlineEditor).toBeVisible();
    await inlineEditor.fill(editedTitle);
    await page.keyboard.press("Escape");
    await expect(inlineEditor).toHaveCount(0);

    const editedTitleNode = editor
      .getByRole("button", {
        name: new RegExp(`Text:\\s*${escapeRegExp(editedTitle)}`, "i"),
      })
      .first();
    await expect(editedTitleNode).toBeVisible();
    await waitForSlideAutosave(page);
    await closeEditor(editor);

    let cleanupApplied = false;
    try {
      await page.reload();
      const reopenedEditor = await openProfileSlideEditor(page);
      const reopenedFilmstrip = reopenedEditor.locator(
        '[aria-label="Slide filmstrip"]',
      );
      const reopenedSlideButtons = reopenedFilmstrip.getByRole("button", {
        name: /^Slide \d+(: |$)/,
      });
      const reopenedGoToSlide = (index: number) =>
        reopenedFilmstrip.getByRole("button", {
          name: new RegExp(`^Slide ${index}(: |$)`),
        });
      await expect(reopenedSlideButtons).toHaveCount(originalSlideCount + 1);
      // The content slide keeps its original 1-based position after duplication.
      await activate(reopenedGoToSlide(contentSlideNum));
      await expect(
        reopenedEditor
          .getByRole("button", {
            name: new RegExp(`Text:\\s*${escapeRegExp(editedTitle)}`, "i"),
          })
          .first(),
      ).toBeVisible();

      const downloadPromise = page.waitForEvent("download", {
        timeout: 60_000,
      });

      // The export menu is portal-rendered to document.body; open the trigger
      // first, then find the menu globally to click "Export PPTX".
      await reopenedEditor
        .getByRole("button", { name: "Export slides" })
        .click();
      // Wait for the portal-rendered menu to be visible before clicking the item.
      const exportMenu = page.getByRole("menu", { name: "Export slides" });
      await exportMenu.waitFor({ state: "visible" });
      const exportPptx = exportMenu.getByRole("menuitem", {
        name: "Export PPTX",
      });
      await expect(exportPptx).toBeVisible();
      await exportPptx.click();
      // If the deck has export warnings, the preflight dialog appears and the
      // user must click "Continue export" before the download starts.
      const preflightDialog = page.locator(
        '[data-export-preflight-dialog="pptx"]',
      );
      // e2e-governance-allow broad-catch: the export warning dialog is optional for decks without preflight diagnostics.
      if (
        await preflightDialog.isVisible({ timeout: 3_000 }).catch(() => false)
      ) {
        await preflightDialog
          .getByRole("button", { name: "Continue export" })
          .click();
      }

      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/\.pptx$/i);
      const filePath = await download.path();
      expect(filePath, "export: download produced no file path").toBeTruthy();
      const stat = await fs.stat(filePath!);
      expect(
        stat.size,
        "export: downloaded PPTX should have nonzero bytes",
      ).toBeGreaterThan(0);

      await closeEditor(reopenedEditor);

      await activate(page.getByRole("button", { name: /^share$/i }));
      const shareDialog = page.getByRole("dialog", {
        name: /share this document/i,
      });
      await expect(shareDialog).toBeVisible();
      await expect(
        shareDialog.getByRole("switch", { name: /public link enabled/i }),
      ).toHaveAttribute("aria-checked", "true");
      const presentationLink = (
        await shareDialog.getByLabel("Presentation link").inputValue()
      ).trim();
      expect(presentationLink).toContain("/present/");
      await page.keyboard.press("Escape");
      await expect(shareDialog).toHaveCount(0);

      const presentPage = await browser.newPage();
      try {
        const response = await presentPage.goto(presentationLink);
        expect(
          response?.status(),
          "present: public presentation link should resolve (200)",
        ).toBe(200);
        const presentRegion = presentPage.getByRole("region", {
          name: /^Presentation/,
        });
        await expect(presentRegion).toBeVisible({ timeout: 20_000 });
        // Navigate to the edited content slide without coupling the public
        // presentation assertion to its current position.
        await expect(async () => {
          const textEl = presentPage
            .getByText(editedTitle, { exact: false })
            .first();
          // e2e-governance-allow broad-catch: bounded visibility probing drives deterministic slide navigation.
          if (await textEl.isVisible({ timeout: 500 }).catch(() => false))
            return;
          await presentPage.keyboard.press("ArrowRight");
          await expect(textEl).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 20_000 });
      } finally {
        await presentPage.close();
      }
    } finally {
      const inlineEditor = page
        .getByRole("dialog", { name: "Slide editor" })
        .first();
      const cleanupEditor =
        (await inlineEditor.count()) > 0
          ? inlineEditor
          : await openProfileSlideEditor(page);
      const cleanupFilmstrip = cleanupEditor.locator(
        '[aria-label="Slide filmstrip"]',
      );
      const cleanupSlideButtons = cleanupFilmstrip.getByRole("button", {
        name: /^Slide \d+(: |$)/,
      });
      const cleanupGoToSlide = (index: number) =>
        cleanupFilmstrip.getByRole("button", {
          name: new RegExp(`^Slide ${index}(: |$)`),
        });

      // Navigate to the content slide (same position it was before duplication).
      await activate(cleanupGoToSlide(contentSlideNum));
      const cleanupTitleNode = cleanupEditor
        .getByRole("button", {
          name: new RegExp(`Text:\\s*${escapeRegExp(editedTitle)}`, "i"),
        })
        .first();
      if ((await cleanupTitleNode.count()) > 0) {
        await cleanupTitleNode.dblclick();
        const cleanupInlineEditor = page.getByRole("textbox", {
          name: "Edit text",
        });
        await expect(cleanupInlineEditor).toBeVisible();
        await cleanupInlineEditor.fill(originalTitle);
        await page.keyboard.press("Escape");
        await expect(cleanupInlineEditor).toHaveCount(0);
        cleanupApplied = true;
      }

      if ((await cleanupSlideButtons.count()) > originalSlideCount) {
        // The duplicate is inserted after the original content slide; its
        // 0-based data-slide-index equals contentSlideNum (1-based).
        await cleanupFilmstrip
          .locator(`[data-slide-index="${contentSlideNum}"]`)
          .hover();
        const cleanupDeleteSlide = cleanupFilmstrip.getByRole("button", {
          name: `Delete slide ${contentSlideNum + 1}`,
        });
        if ((await cleanupDeleteSlide.count()) > 0) {
          await cleanupDeleteSlide.click();
          await expect(cleanupSlideButtons).toHaveCount(originalSlideCount);
          cleanupApplied = true;
        }
      }

      if (cleanupApplied) {
        await waitForSlideAutosave(page);
      }
      await closeEditor(cleanupEditor);
    }
  });

  test("slide editor undo and redo keep deck state, autosave status, and focus coherent", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openProfileDocument(page, "editorUndoRedo");
    const editor = await openProfileSlideEditor(page);

    const undoButton = editor.getByRole("button", { name: "Undo" });
    const redoButton = editor.getByRole("button", { name: "Redo" });
    await expect(undoButton).toBeDisabled();
    await expect(redoButton).toBeDisabled();

    // Use click (not activate/keyboard) to avoid bubbling key events into the
    // global slide-editor keydown handler, which would dirty the undo stack.
    const filmstrip = editor.locator('[aria-label="Slide filmstrip"]');
    const contentSlideButton = filmstrip.getByRole("button", {
      name: new RegExp(
        `^Slide \\d+: ${escapeRegExp(E2E_PROFILE_FIXTURE.slideTitleText)}`,
      ),
    });
    await contentSlideButton.click();

    const titleNode = editor.locator('[data-node-id="fixture-title"]').first();
    await expect(titleNode).toBeVisible();
    const originalLabel =
      (await titleNode.getAttribute("aria-label")) ??
      `Text: ${E2E_PROFILE_FIXTURE.slideTitleText}`;
    const originalTitle = originalLabel.replace(/^Text:\s*/i, "").trim();
    // e2e-governance-allow nondeterministic-id: profile roundtrip needs a unique visible title token within one test run.
    const mutationToken = Date.now().toString().slice(-6);
    const editedTitle = `${originalTitle} ${mutationToken}`;

    await titleNode.dblclick();
    const inlineEditor = page.getByRole("textbox", { name: "Edit text" });
    await expect(inlineEditor).toBeVisible();
    await inlineEditor.fill(editedTitle);
    await page.keyboard.press("Escape");
    await expect(inlineEditor).toHaveCount(0);

    const editedTitleNode = editor
      .getByRole("button", {
        name: new RegExp(`Text:\\s*${escapeRegExp(editedTitle)}`, "i"),
      })
      .first();
    const originalTitleNode = editor
      .getByRole("button", {
        name: new RegExp(`Text:\\s*${escapeRegExp(originalTitle)}`, "i"),
      })
      .first();

    await expect(editedTitleNode).toBeVisible();
    await expect(undoButton).toBeEnabled();
    await expect(redoButton).toBeDisabled();
    await waitForSlideAutosave(page);

    await activate(undoButton);
    await expect(originalTitleNode).toBeVisible();
    await expect(editedTitleNode).toHaveCount(0);
    // Undo must have populated the redo stack — that is the key behavioral
    // invariant.  We do not assert the undo stack is empty here because prior
    // slide-navigation in this serial run may have left transient entries.
    await expect(redoButton).toBeEnabled();
    await expectHistoryFocusOnNodeOrStage(page, "fixture-title");
    await waitForSlideAutosave(page);

    await activate(redoButton);
    await expect(editedTitleNode).toBeVisible();
    await expect(undoButton).toBeEnabled();
    await expectHistoryFocusOnNodeOrStage(page, "fixture-title");
    await waitForSlideAutosave(page);
  });

  test("context toolbar Escape restores focus to the selected stage target", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openProfileDocument(page);
    const editor = await openProfileSlideEditor(page);

    const selectedNode = editor.locator("[data-node-id]:visible").first();
    await expect(selectedNode).toBeVisible();
    const selectedNodeId = await selectedNode.getAttribute("data-node-id");
    expect(selectedNodeId).toBeTruthy();
    await selectedNode.click();

    const contextToolbar = page.getByRole("toolbar", {
      name: "Context toolbar",
    });
    await expect(contextToolbar).toBeVisible();
    // Use the first focusable button in the toolbar (e.g. "Bold" for a text node).
    // There is no standalone "Delete" button in the floating context toolbar — deletion
    // goes through the keyboard shortcut or right-click context menu.
    const firstToolbarButton = contextToolbar.getByRole("button").first();
    await firstToolbarButton.focus();
    await expect(firstToolbarButton).toBeFocused();

    await page.keyboard.press("Escape");

    await expect(async () => {
      const focusTarget = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active) return null;
        const nodeId = active.getAttribute("data-node-id");
        if (nodeId) return `node:${nodeId}`;
        return active.getAttribute("data-slide-stage-viewport") === "true"
          ? "stage-viewport"
          : null;
      });
      expect(
        focusTarget === `node:${selectedNodeId}` ||
          focusTarget === "stage-viewport",
      ).toBe(true);
    }, "Escape should return focus to the selected node or stage viewport").toPass(
      {
        timeout: 5_000,
      },
    );

    await expect(contextToolbar).toBeVisible();
  });

  test("slide editor bottom dock stays compact and keyboard reachable across viewports", async ({
    page,
  }) => {
    const viewports = [
      { width: 390, height: 844 },
      { width: 834, height: 1112 },
      { width: 1280, height: 900 },
    ] as const;

    await page.setViewportSize({
      width: viewports[0].width,
      height: viewports[0].height,
    });
    await openProfileDocument(page);

    for (const viewport of viewports) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });

      const editor = await openProfileSlideEditor(page);
      const bottomDock = editor.locator('[data-slide-bottom-dock="true"]');
      await expect(bottomDock).toBeVisible();

      await expect
        .poll(async () => {
          return await page.evaluate(() =>
            Math.max(
              0,
              document.documentElement.scrollWidth -
                document.documentElement.clientWidth,
            ),
          );
        })
        .toBeLessThanOrEqual(1);

      await expect
        .poll(async () =>
          bottomDock.evaluate((node) =>
            Math.max(0, node.scrollWidth - node.clientWidth),
          ),
        )
        .toBeLessThanOrEqual(1);

      const railToggle = editor.getByRole("button", {
        name: /slide thumbnails/i,
      });
      await railToggle.focus();
      await expect(railToggle).toBeFocused();

      const notesButton = editor.getByRole("button", { name: /^Notes$/i });
      await notesButton.focus();
      await expect(notesButton).toBeFocused();

      const zoomButton = editor.getByRole("button", {
        name: /set slide zoom/i,
      });
      await zoomButton.focus();
      await expect(zoomButton).toBeFocused();

      if (viewport.width < 640) {
        const footerStatus = editor.getByRole("button", {
          name: /footer status:/i,
        });
        await footerStatus.focus();
        await expect(footerStatus).toBeFocused();
        await activate(footerStatus);

        // The Footer status popup uses role="menu", not "dialog".
        const statusPopover = page.getByRole("menu", {
          name: "Footer status",
        });
        await expect(statusPopover).toBeVisible();
        // The diagnostics menuitem is only present when there are deck diagnostics.
        const diagnosticsButton = statusPopover.getByRole("menuitem", {
          name: /open deck diagnostics review/i,
        });
        if (await diagnosticsButton.isVisible()) {
          await diagnosticsButton.focus();
          await expect(diagnosticsButton).toBeFocused();
        }
        await page.keyboard.press("Escape");
        await expect(statusPopover).toHaveCount(0);
      } else {
        const zoomSlider = editor.getByRole("slider", { name: "Slide zoom" });
        await zoomSlider.focus();
        await expect(zoomSlider).toBeFocused();

        // The diagnostics button is only present when there are deck diagnostics.
        const diagnosticsButton = bottomDock.getByRole("button", {
          name: /open deck diagnostics review/i,
        });
        if (await diagnosticsButton.isVisible()) {
          await diagnosticsButton.focus();
          await expect(diagnosticsButton).toBeFocused();
        }
      }

      await activate(
        editor.getByRole("button", { name: "Close slide editor" }),
      );
      await expect(editor).toHaveCount(0);
    }
  });

  test("viewer can open the seeded document in read-only mode without owner controls", async ({
    page,
  }) => {
    await login(page, profileViewerCredentials(), profileDocPath());

    await expect(
      page.getByText(E2E_PROFILE_FIXTURE.documentBodyText),
    ).toBeVisible({ timeout: 60_000 });

    // Viewers must not see the Share button (owner-only control).
    await expect(page.getByRole("button", { name: /^share$/i })).toHaveCount(0);

    // Viewers must not see the Import button (edit-only control).
    await expect(page.getByRole("button", { name: /^import$/i })).toHaveCount(
      0,
    );
  });

  test("editor autosave status live region is present and reports a known save state", async ({
    page,
  }) => {
    await openProfileDocument(page);

    // The editor exposes a [role="status"] live region that cycles through
    // "All changes saved", "Saving…", or "Unsaved changes…".
    // Filter by text to avoid matching the "Live" collaboration-presence status
    // that also uses role="status" and appears first in the DOM.
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /all changes saved|saving|unsaved changes/i }),
      "editor should report a known save state",
    ).toBeVisible({ timeout: 20_000 });
  });

  test("dashboard sort by date created changes the sort URL param and preserves all documents", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials());

    await expect(
      page.getByRole("heading", { name: /your documents/i }),
    ).toBeVisible({ timeout: 60_000 });
    await waitForDashboardInteractivity(page);

    await selectListboxOption(page, /sort documents/i, "Date created");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sort"))
      .toBe("created");

    // All fixture documents remain visible after sorting by date created.
    await expect(
      documentLink(page, E2E_PROFILE_FIXTURE.documentTitle),
    ).toBeVisible();
    await expect(
      documentLink(
        page,
        E2E_PROFILE_FIXTURE.dashboardDocuments.alphaFavorite.title,
      ),
    ).toBeVisible();
    await expect(
      documentLink(
        page,
        E2E_PROFILE_FIXTURE.dashboardDocuments.betaTagged.title,
      ),
    ).toBeVisible();
  });

  test("share dialog exposes copy and regenerate link controls alongside share metadata", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials(), profileDocPath());

    await expect(
      page.getByText(E2E_PROFILE_FIXTURE.documentBodyText),
    ).toBeVisible({ timeout: 60_000 });

    await activate(page.getByRole("button", { name: /^share$/i }));
    const shareDialog = page.getByRole("dialog", {
      name: /share this document/i,
    });
    await expect(shareDialog).toBeVisible();

    // At least one "Copy" button should be visible for the share link.
    await expect(
      shareDialog.getByRole("button", { name: "Copy" }).first(),
    ).toBeVisible();

    // "Regenerate link" lets owners rotate the share URL without deleting the document.
    await expect(
      shareDialog.getByRole("button", { name: /regenerate link/i }),
    ).toBeVisible();
    await expect(
      shareDialog.getByRole("button", { name: /regenerate link/i }),
    ).toBeEnabled();

    // Helper text explains the read-only nature of the shared link.
    await expect(
      shareDialog.getByText(/anyone with this link can view/i),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(shareDialog).toHaveCount(0);
  });

  test("mobile editor chrome keeps key slide and collaboration actions reachable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openProfileDocument(page);

    const expectReachable = async (locator: Locator) => {
      await locator.scrollIntoViewIfNeeded();
      await expect(locator).toBeVisible();
    };

    await expectReachable(page.getByRole("button", { name: /^import$/i }));
    await expectReachable(page.getByRole("button", { name: /^style$/i }));
    await expectReachable(
      page.getByRole("link", { name: "Open slide editor" }),
    );
    await expectReachable(page.getByRole("button", { name: /^Present / }));
    await expectReachable(
      page.getByRole("button", { name: "Export document" }),
    );
    await expectReachable(page.getByRole("button", { name: /^share$/i }));
    await expectReachable(
      page.getByRole("button", { name: /version history/i }),
    );

    await activate(page.getByRole("button", { name: "Export document" }));
    const exportMenu = page.getByRole("menu", { name: "Export document" });
    await expect(exportMenu).toBeVisible();
    await expect(
      exportMenu.getByRole("button", { name: "Close export menu" }),
    ).toBeVisible();
    await activate(
      exportMenu.getByRole("button", { name: "Close export menu" }),
    );
    await expect(exportMenu).toHaveCount(0);
  });
});
