import { promises as fs } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { login } from "./helpers/auth";
import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileDocPath,
  profileOwnerCredentials,
  profileShareSegment,
  profileViewerCredentials,
} from "./helpers/profile";
import { waitForSlideAutosave } from "./helpers/readiness";

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

async function openProfileDocument(page: Page): Promise<void> {
  await login(page, profileOwnerCredentials(), profileDocPath());
  await expect(
    page.getByText(E2E_PROFILE_FIXTURE.documentBodyText),
  ).toBeVisible({ timeout: 60_000 });
}

async function openProfileSlideEditor(page: Page): Promise<Locator> {
  await activate(page.getByRole("button", { name: "Open slide editor" }));
  const editor = page.getByRole("dialog", { name: "Slide editor" }).first();
  await expect(editor).toBeVisible({ timeout: 20_000 });
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
  // Serial mode keeps each test's browser state independent of the others.
  // retries: 1 handles the occasional dev-server saturation when the
  // present-export tests run concurrently on the other worker.
  test.describe.configure({ mode: "serial", retries: 1 });
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
    ).toBeVisible();

    await activate(page.getByRole("button", { name: /open navigation menu/i }));
    const drawer = page.getByRole("dialog", { name: /navigation menu/i });
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole("link", { name: /documents/i }),
    ).toBeVisible();
    await activate(drawer.getByRole("link", { name: /workspaces/i }));

    await expect(page).toHaveURL(/\/app\/workspaces$/);
    await expect(
      page.getByRole("heading", { name: /^workspaces$/i }),
    ).toBeVisible({ timeout: 20_000 });

    await activate(page.getByRole("button", { name: /open navigation menu/i }));
    await activate(
      page
        .getByRole("dialog", { name: /navigation menu/i })
        .getByRole("link", { name: /brands/i }),
    );
    await expect(page).toHaveURL(/\/app\/brands$/);
    await expect(
      page.getByRole("heading", { name: /brand studio/i }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("opens the seeded document editor with deterministic content", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials(), profileDocPath());

    await expect(
      page.getByText(E2E_PROFILE_FIXTURE.documentBodyText),
    ).toBeVisible({ timeout: 60_000 });
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
      exportMenu.getByRole("menuitem", { name: /^Slide SVGs\b/ }),
    ).toBeVisible();
    await expect(
      exportMenu.getByRole("menuitem", { name: /^Slide PNGs\b/ }),
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

    await expect(
      editor.getByRole("toolbar", { name: "Slide editing tools" }),
    ).toBeVisible();
    const slideOneButton = editor.getByRole("button", {
      name: new RegExp(
        `Slide 1: ${escapeRegExp(E2E_PROFILE_FIXTURE.slideTitleText)}`,
      ),
    });
    await expect(slideOneButton).toBeVisible();
    const slideTwoButton = editor.getByRole("button", {
      name: new RegExp(
        `Slide 2: ${escapeRegExp(E2E_PROFILE_FIXTURE.slideTwoTitleText)}`,
      ),
    });
    await expect(slideTwoButton).toBeVisible();
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

    const shortcuts = editor.getByRole("button", {
      name: "Keyboard shortcuts",
    });
    await activate(shortcuts);
    const shortcutsDialog = page.getByRole("dialog", {
      name: "Keyboard shortcuts",
    });
    await expect(shortcutsDialog).toBeVisible();
    await expect(
      shortcutsDialog.getByText(/move selection/i).first(),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(shortcutsDialog).toHaveCount(0);

    await editor
      .locator("[data-slide-stage]")
      .click({ position: { x: 5, y: 5 } });
    const slideTools = page.getByRole("toolbar", { name: "Slide tools" });
    await expect(slideTools).toBeVisible();

    await activate(slideTools.getByRole("button", { name: "Add element" }));
    const addElementPanel = page.getByRole("dialog", { name: "Add element" });
    await expect(addElementPanel).toBeVisible();
    await expect(
      addElementPanel.getByRole("tablist", { name: "Element category" }),
    ).toBeVisible();
    await activate(addElementPanel.getByRole("tab", { name: /media/i }));
    await expect(
      addElementPanel.getByRole("button", { name: "Visual" }),
    ).toBeVisible();
    // Toggle the toolbar button to close the panel — pressing Escape would also
    // fire the slide editor's global Escape handler and close the editor itself.
    await activate(slideTools.getByRole("button", { name: "Add element" }));
    await expect(addElementPanel).toHaveCount(0);

    await expect(slideTools).toBeVisible();
    await activate(slideTools.getByRole("button", { name: "From document" }));
    const fromDocumentPanel = page.getByRole("dialog", {
      name: "From document",
    });
    await expect(fromDocumentPanel).toBeVisible();
    await expect(
      fromDocumentPanel.getByRole("region", { name: "Document visuals" }),
    ).toBeVisible();
    await expect(
      fromDocumentPanel.getByRole("region", { name: "Document text" }),
    ).toBeVisible();
    await expect(
      fromDocumentPanel.getByRole("button", {
        name: /insert e2e profile flow/i,
      }),
    ).toBeVisible();
    await expect(
      fromDocumentPanel.getByRole("button", {
        name: /insert text: e2e fixture document body/i,
      }),
    ).toBeVisible();
    // Toggle closed via the toolbar button for the same reason as addElementPanel.
    await activate(slideTools.getByRole("button", { name: "From document" }));
    await expect(fromDocumentPanel).toHaveCount(0);

    await activate(editor.getByRole("button", { name: "Close slide editor" }));
    await expect(editor).toHaveCount(0);
  });

  test("slide rail duplicate, delete, and reorder actions mutate deck state and persist after reload", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openProfileDocument(page);
    const editor = await openProfileSlideEditor(page);
    const filmstrip = editor.getByRole("list", { name: "Slides" });
    const slideButtons = filmstrip.getByRole("button", {
      name: /^Go to slide \d+$/,
    });
    const goToSlide = (index: number) =>
      filmstrip.getByRole("button", { name: `Go to slide ${index}` });
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

    await expect(slideButtons).toHaveCount(2);
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
    await goToSlide(1).focus();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(goToSlide(2)).toHaveAttribute("aria-current", "true");
    await expect(titleNode(E2E_PROFILE_FIXTURE.slideTitleText)).toBeVisible();

    await activate(goToSlide(1));
    await expect(
      titleNode(E2E_PROFILE_FIXTURE.slideTwoTitleText),
    ).toBeVisible();
    await activate(goToSlide(2));
    await expect(titleNode(E2E_PROFILE_FIXTURE.slideTitleText)).toBeVisible();

    await activate(editor.getByRole("button", { name: /save slide deck/i }));
    await waitForSlideAutosave(page);
    await page.reload();
    const reopenedEditor = await openProfileSlideEditor(page);
    const reopenedFilmstrip = reopenedEditor.getByRole("list", {
      name: "Slides",
    });
    const reopenedGoToSlide = (index: number) =>
      reopenedFilmstrip.getByRole("button", { name: `Go to slide ${index}` });
    const reopenedTitleNode = (title: string) =>
      reopenedEditor
        .getByRole("button", {
          name: new RegExp(`Text:\\s*${escapeRegExp(title)}`, "i"),
        })
        .first();
    await expect(
      reopenedFilmstrip.getByRole("button", { name: /^Go to slide \d+$/ }),
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
    await login(page, profileOwnerCredentials(), profileDocPath());
    await expect(
      page.getByRole("button", { name: "Open slide editor" }),
    ).toBeVisible({ timeout: 60_000 });
    const editor = await openProfileSlideEditor(page);
    const filmstrip = editor.getByRole("list", { name: "Slides" });
    const slideButtons = filmstrip.getByRole("button", {
      name: /^Go to slide \d+$/,
    });
    const goToSlide = (index: number) =>
      filmstrip.getByRole("button", { name: `Go to slide ${index}` });
    const duplicateSlide = (index: number) =>
      filmstrip.getByRole("button", { name: `Duplicate slide ${index}` });

    const originalSlideCount = await slideButtons.count();
    expect(originalSlideCount).toBeGreaterThanOrEqual(2);
    await activate(goToSlide(1));

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

    await filmstrip.locator('[data-slide-index="0"]').hover();
    await duplicateSlide(1).click();
    await expect(slideButtons).toHaveCount(originalSlideCount + 1);

    await activate(goToSlide(1));
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
    await activate(editor.getByRole("button", { name: /save slide deck/i }));
    await waitForSlideAutosave(page);
    await closeEditor(editor);

    let cleanupApplied = false;
    try {
      await page.reload();
      const reopenedEditor = await openProfileSlideEditor(page);
      const reopenedFilmstrip = reopenedEditor.getByRole("list", {
        name: "Slides",
      });
      const reopenedSlideButtons = reopenedFilmstrip.getByRole("button", {
        name: /^Go to slide \d+$/,
      });
      const reopenedGoToSlide = (index: number) =>
        reopenedFilmstrip.getByRole("button", { name: `Go to slide ${index}` });
      await expect(reopenedSlideButtons).toHaveCount(originalSlideCount + 1);
      await activate(reopenedGoToSlide(1));
      await expect(
        reopenedEditor
          .getByRole("button", {
            name: new RegExp(`Text:\\s*${escapeRegExp(editedTitle)}`, "i"),
          })
          .first(),
      ).toBeVisible();

      const downloadPromise = page.waitForEvent("download", {
        timeout: 30_000,
      });
      await reopenedEditor
        .getByRole("button", { name: /export as pptx/i })
        .click();
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
        await expect(
          presentPage.getByText(editedTitle, { exact: false }).first(),
          "present: edited deck text should render on public present route",
        ).toBeVisible({ timeout: 20_000 });
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
      const cleanupFilmstrip = cleanupEditor.getByRole("list", {
        name: "Slides",
      });
      const cleanupSlideButtons = cleanupFilmstrip.getByRole("button", {
        name: /^Go to slide \d+$/,
      });
      const cleanupGoToSlide = (index: number) =>
        cleanupFilmstrip.getByRole("button", { name: `Go to slide ${index}` });

      await activate(cleanupGoToSlide(1));
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
        await cleanupFilmstrip.locator('[data-slide-index="1"]').hover();
        const cleanupDeleteSlide = cleanupFilmstrip.getByRole("button", {
          name: "Delete slide 2",
        });
        if ((await cleanupDeleteSlide.count()) > 0) {
          await cleanupDeleteSlide.click();
          await expect(cleanupSlideButtons).toHaveCount(originalSlideCount);
          cleanupApplied = true;
        }
      }

      if (cleanupApplied) {
        await activate(
          cleanupEditor.getByRole("button", { name: /save slide deck/i }),
        );
        await waitForSlideAutosave(page);
      }
      await closeEditor(cleanupEditor);
    }
  });

  test("slide editor undo and redo keep deck state, autosave status, and focus coherent", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openProfileDocument(page);
    const editor = await openProfileSlideEditor(page);

    const undoButton = editor.getByRole("button", { name: "Undo" });
    const redoButton = editor.getByRole("button", { name: "Redo" });
    await expect(undoButton).toBeDisabled();
    await expect(redoButton).toBeDisabled();

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
    await expect(undoButton).toBeDisabled();
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
    const deleteButton = contextToolbar.getByRole("button", { name: "Delete" });
    await deleteButton.focus();
    await expect(deleteButton).toBeFocused();

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

        const statusPopover = page.getByRole("dialog", {
          name: "Footer status",
        });
        await expect(statusPopover).toBeVisible();
        const diagnosticsButton = statusPopover.getByRole("button", {
          name: /open deck diagnostics review/i,
        });
        await diagnosticsButton.focus();
        await expect(diagnosticsButton).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(statusPopover).toHaveCount(0);
      } else {
        const zoomSlider = editor.getByLabel("Slide zoom");
        await zoomSlider.focus();
        await expect(zoomSlider).toBeFocused();

        const diagnosticsButton = bottomDock.getByRole("button", {
          name: /open deck diagnostics review/i,
        });
        await diagnosticsButton.focus();
        await expect(diagnosticsButton).toBeFocused();
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
      page.getByRole("button", { name: "Open slide editor" }),
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
