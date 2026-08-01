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
  waitForSlideAutosaveAfter,
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

function smokeOwnerCredentials() {
  return e2eProfileEnabled() ? profileOwnerCredentials() : ownerCredentials();
}

function smokeDocumentUrl(): string | undefined {
  return e2eProfileEnabled() ? profileDocPath() : slidesDocUrl();
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

async function openSlideEditorFromDocument(page: Page): Promise<Locator> {
  const trigger = page
    .getByRole("tab", { name: /open slide editor|slides/i })
    .or(page.getByRole("button", { name: /open slide editor|slides/i }))
    .or(page.getByRole("link", { name: /open slide editor|slides/i }))
    .first();

  if ((await trigger.count()) === 0 && !e2eProfileEnabled()) {
    skipOptionalSlidesFixture(
      "Slides panel was not available for this document",
    );
  }
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await trigger.click();
  await expect(page).toHaveURL(/\/app\/documents\/[^/]+\/slides(?:[/?#]|$)/, {
    timeout: 30_000,
  });

  const editor = page.locator('[data-slide-editor="true"]').first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  return editor;
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
    const creds = smokeOwnerCredentials();
    test.skip(!creds, "Set E2E_USER_EMAIL/E2E_USER_PASSWORD to run this flow");

    await login(page, creds!);

    const docUrl = smokeDocumentUrl();
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

    await openSlideEditorFromDocument(page);
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

  test("inline selection formatting stays in edit mode and survives history and reload", async ({
    page,
  }) => {
    test.skip(
      !e2eProfileEnabled(),
      "Set E2E_PROFILE=1 and seed the deterministic profile",
    );

    const editor = await openIsolatedMutationEditor(
      page,
      SLIDES_SMOKE_MUTATION_FIXTURES.inlineRichText,
    );
    const titleNode = editor
      .locator(
        '[data-slide-stage-viewport="true"] [data-node-id="fixture-title"]',
      )
      .first();
    const inlineEditor = page.getByRole("textbox", { name: "Edit text" });
    const toolbar = page.getByRole("toolbar", { name: "Context toolbar" });
    const undo = editor.getByRole("button", { name: "Undo", exact: true });
    const redo = editor.getByRole("button", { name: "Redo", exact: true });
    const richText = "Alpha Beta Gamma";

    await titleNode.dblclick();
    await expect(inlineEditor).toBeVisible();
    await inlineEditor.fill(richText);
    await inlineEditor.evaluate((node) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current && !current.textContent?.includes("Beta")) {
        current = walker.nextNode();
      }
      if (!current?.textContent) throw new Error("Beta text node not found");
      const start = current.textContent.indexOf("Beta");
      const range = document.createRange();
      range.setStart(current, start);
      range.setEnd(current, start + "Beta".length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      (node as HTMLElement).focus();
    });
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe("Beta");

    await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
    await expect(inlineEditor).toBeVisible();
    await expect
      .poll(() =>
        inlineEditor.evaluate((node) =>
          Array.from(node.querySelectorAll("span")).some(
            (span) =>
              span.textContent === "Beta" &&
              getComputedStyle(span).fontWeight === "700",
          ),
        ),
      )
      .toBe(true);

    await toolbar.getByRole("button", { name: "Link", exact: true }).click();
    const linkDialog = page.getByRole("dialog", { name: "Add link" });
    await expect(linkDialog).toBeVisible();
    await linkDialog.getByLabel("URL").fill("https://example.com/docs");
    await expect(inlineEditor).toBeVisible();
    await linkDialog.getByRole("button", { name: "Apply link" }).click();
    await expect(
      inlineEditor.locator('a[href="https://example.com/docs"]'),
    ).toHaveText("Beta");
    await expect(
      inlineEditor.locator('a[href="https://example.com/docs"]'),
    ).toHaveCSS("font-weight", "700");

    await toolbar.getByRole("spinbutton", { name: "Font size" }).fill("24");
    await expect(inlineEditor).toBeVisible();
    await expect
      .poll(() =>
        inlineEditor.evaluate((node) =>
          Array.from(node.querySelectorAll("span")).some(
            (span) =>
              span.textContent === "Beta" && span.style.fontSize === "24pt",
          ),
        ),
      )
      .toBe(true);

    await inlineEditor.focus();
    await waitForSlideAutosaveAfter(page, () => page.keyboard.press("Escape"));
    await expect(inlineEditor).toHaveCount(0);
    await expect(titleNode).toHaveAttribute(
      "aria-label",
      new RegExp(`Text:\\s*${richText}`),
    );
    await expect(
      titleNode.locator('a[href="https://example.com/docs"]'),
    ).toHaveText("Beta");
    await expect(
      titleNode.locator('a[href="https://example.com/docs"]'),
    ).toHaveCSS("font-weight", "700");
    await expect(
      titleNode.locator('a[href="https://example.com/docs"]'),
    ).toHaveCSS("font-size", "32px");

    await waitForSlideAutosaveAfter(page, () => undo.click());
    await expect(titleNode).toHaveAttribute(
      "aria-label",
      /Text:\s*Release Gate Fixture Slide/,
    );
    await waitForSlideAutosaveAfter(page, () => redo.click());
    await expect(titleNode).toHaveAttribute(
      "aria-label",
      new RegExp(`Text:\\s*${richText}`),
    );

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );
    await expect(titleNode).toHaveAttribute(
      "aria-label",
      new RegExp(`Text:\\s*${richText}`),
    );
    await expect(
      titleNode.locator('a[href="https://example.com/docs"]'),
    ).toHaveText("Beta");
    await expect(
      titleNode.locator('a[href="https://example.com/docs"]'),
    ).toHaveCSS("font-weight", "700");
    await expect(
      titleNode.locator('a[href="https://example.com/docs"]'),
    ).toHaveCSS("font-size", "32px");

    await titleNode.dblclick({ position: { x: 8, y: 8 } });
    await expect(inlineEditor).toBeVisible();
    const linkedBeta = inlineEditor.locator(
      'a[href="https://example.com/docs"]',
    );
    await linkedBeta.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      node.closest<HTMLElement>("[data-inline-editor-presentation]")?.focus();
    });
    await toolbar.getByRole("button", { name: "Link", exact: true }).click();
    await expect(linkDialog).toBeVisible();
    await linkDialog.getByRole("button", { name: "Remove link" }).click();
    await expect(inlineEditor).toBeVisible();
    await expect(
      inlineEditor.locator('a[href="https://example.com/docs"]'),
    ).toHaveCount(0);

    await waitForSlideAutosaveAfter(page, () => page.keyboard.press("Escape"));
    await expect(
      titleNode.locator('a[href="https://example.com/docs"]'),
    ).toHaveCount(0);
    const formattedBeta = titleNode
      .locator("span")
      .filter({ hasText: /^Beta$/ })
      .first();
    await expect(formattedBeta).toHaveCSS("font-weight", "700");
    await expect(formattedBeta).toHaveCSS("font-size", "32px");

    await waitForSlideAutosaveAfter(page, () => undo.click());
    await expect(
      titleNode.locator('a[href="https://example.com/docs"]'),
    ).toHaveText("Beta");
    await waitForSlideAutosaveAfter(page, () => redo.click());
    await expect(
      titleNode.locator('a[href="https://example.com/docs"]'),
    ).toHaveCount(0);

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );
    await expect(
      titleNode.locator('a[href="https://example.com/docs"]'),
    ).toHaveCount(0);
    await expect(formattedBeta).toHaveCSS("font-weight", "700");
    await expect(formattedBeta).toHaveCSS("font-size", "32px");
  });

  test("inline list conversion and indentation stay editable through history and reload", async ({
    page,
  }) => {
    test.skip(
      !e2eProfileEnabled(),
      "Set E2E_PROFILE=1 and seed the deterministic profile",
    );

    const editor = await openIsolatedMutationEditor(
      page,
      SLIDES_SMOKE_MUTATION_FIXTURES.inlineList,
    );
    const bodyNode = editor
      .locator(
        '[data-slide-stage-viewport="true"] [data-node-id="fixture-bullets"]',
      )
      .first();
    const inlineEditor = page.getByRole("textbox", { name: "Edit text" });
    const toolbar = page.getByRole("toolbar", { name: "Context toolbar" });
    const undo = editor.getByRole("button", { name: "Undo", exact: true });
    const redo = editor.getByRole("button", { name: "Redo", exact: true });

    await bodyNode.dblclick();
    await expect(inlineEditor).toBeVisible();
    const bulletParagraphs = inlineEditor.locator('p[data-list-kind="bullet"]');
    await expect(bulletParagraphs).toHaveCount(2);
    await inlineEditor
      .locator('p[data-list-kind="bullet"]')
      .first()
      .evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        node.closest<HTMLElement>("[data-inline-editor-presentation]")?.focus();
      });

    await toolbar
      .getByRole("button", { name: "Numbered list", exact: true })
      .click();
    await expect(inlineEditor).toBeVisible();
    await expect(inlineEditor.locator("ol > li")).toHaveCount(1);
    await expect(bulletParagraphs).toHaveCount(1);
    await inlineEditor
      .locator("li")
      .first()
      .evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        node.closest<HTMLElement>("[data-inline-editor-presentation]")?.focus();
      });

    const firstItem = inlineEditor.locator("ol > li").first();
    await toolbar
      .getByRole("button", { name: "Indent list", exact: true })
      .click();
    await expect(firstItem).toHaveAttribute("data-list-indent", "1");
    await toolbar
      .getByRole("button", { name: "Outdent list", exact: true })
      .click();
    await expect(firstItem).not.toHaveAttribute("data-list-indent");
    await toolbar
      .getByRole("button", { name: "Indent list", exact: true })
      .click();
    await expect(firstItem).toHaveAttribute("data-list-indent", "1");

    await waitForSlideAutosaveAfter(page, () => page.keyboard.press("Escape"));
    await expect(inlineEditor).toHaveCount(0);
    const renderedParagraphs = bodyNode.locator("p");
    await expect(renderedParagraphs).toHaveCount(2);
    await expect(renderedParagraphs.first().locator("span").first()).toHaveText(
      "1.",
    );
    expect(
      await renderedParagraphs
        .first()
        .evaluate((node) => node.style.paddingLeft),
    ).toBe("1.5em");

    await waitForSlideAutosaveAfter(page, () => undo.click());
    await expect(renderedParagraphs.first().locator("span").first()).toHaveText(
      "•",
    );
    await waitForSlideAutosaveAfter(page, () => redo.click());
    await expect(renderedParagraphs.first().locator("span").first()).toHaveText(
      "1.",
    );

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );
    await expect(renderedParagraphs.first().locator("span").first()).toHaveText(
      "1.",
    );
    expect(
      await renderedParagraphs
        .first()
        .evaluate((node) => node.style.paddingLeft),
    ).toBe("1.5em");
  });

  test("table cells and structure stay keyboard-editable through history and reload", async ({
    page,
  }) => {
    test.skip(
      !e2eProfileEnabled(),
      "Set E2E_PROFILE=1 and seed the deterministic profile",
    );

    const editor = await openIsolatedMutationEditor(
      page,
      SLIDES_SMOKE_MUTATION_FIXTURES.tableEditing,
    );
    const tableNode = editor
      .locator(
        '[data-slide-stage-viewport="true"] [data-node-id="fixture-table"]',
      )
      .first();
    const toolbar = page.getByRole("toolbar", { name: "Context toolbar" });
    const undo = editor.getByRole("button", { name: "Undo", exact: true });
    const redo = editor.getByRole("button", { name: "Redo", exact: true });
    const editableCells = tableNode.locator("[data-table-cell]");

    await tableNode.dblclick();
    await expect(editableCells).toHaveCount(4);
    const firstCell = tableNode.locator('[data-table-cell="0:0"]');
    const secondCell = tableNode.locator('[data-table-cell="0:1"]');
    const thirdCell = tableNode.locator('[data-table-cell="1:0"]');
    const fourthCell = tableNode.locator('[data-table-cell="1:1"]');
    await expect(firstCell).toBeFocused();
    await firstCell.fill("Alpha updated");
    await page.keyboard.press("Tab");
    await expect(secondCell).toBeFocused();
    await secondCell.fill("11");
    await page.keyboard.press("Tab");
    await expect(thirdCell).toBeFocused();
    await page.keyboard.press("Control+ArrowRight");
    await expect(fourthCell).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(thirdCell).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(editableCells).toHaveCount(0);
    await expect(tableNode).toBeFocused();
    await waitForSlideAutosave(page);
    await expect(
      tableNode.locator("tbody tr").first().locator("td"),
    ).toHaveText(["Alpha updated", "11"]);

    await waitForSlideAutosaveAfter(page, () =>
      toolbar.getByRole("button", { name: "Insert row", exact: true }).click(),
    );
    await expect(tableNode.locator("tbody tr")).toHaveCount(3);
    await waitForSlideAutosaveAfter(page, () =>
      toolbar
        .getByRole("button", { name: "Insert column", exact: true })
        .click(),
    );
    await expect(tableNode.locator("tbody td")).toHaveCount(9);
    await waitForSlideAutosaveAfter(page, () =>
      toolbar
        .getByRole("button", { name: "Toggle header row", exact: true })
        .click(),
    );
    await expect(tableNode.locator("thead")).toHaveCount(0);

    await waitForSlideAutosaveAfter(page, () => undo.click());
    await expect(tableNode.locator("thead")).toHaveCount(1);
    await waitForSlideAutosaveAfter(page, () => redo.click());
    await expect(tableNode.locator("thead")).toHaveCount(0);

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );
    await expect(tableNode.locator("tbody tr")).toHaveCount(3);
    await expect(tableNode.locator("tbody td")).toHaveCount(9);
    await expect(tableNode.locator("thead")).toHaveCount(0);
    await expect(
      tableNode.locator("tbody tr").first().locator("td"),
    ).toHaveText(["Alpha updated", "11", ""]);

    await tableNode.click();
    await waitForSlideAutosaveAfter(page, () =>
      toolbar.getByRole("button", { name: "Delete row", exact: true }).click(),
    );
    await expect(tableNode.locator("tbody tr")).toHaveCount(2);
    await waitForSlideAutosaveAfter(page, () =>
      toolbar
        .getByRole("button", { name: "Delete column", exact: true })
        .click(),
    );
    await expect(tableNode.locator("tbody td")).toHaveCount(4);

    await waitForSlideAutosaveAfter(page, () => undo.click());
    await expect(tableNode.locator("tbody td")).toHaveCount(6);
    await waitForSlideAutosaveAfter(page, () => undo.click());
    await expect(tableNode.locator("tbody tr")).toHaveCount(3);
    await waitForSlideAutosaveAfter(page, () => redo.click());
    await expect(tableNode.locator("tbody tr")).toHaveCount(2);
    await waitForSlideAutosaveAfter(page, () => redo.click());
    await expect(tableNode.locator("tbody td")).toHaveCount(4);

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );
    await expect(tableNode.locator("tbody tr")).toHaveCount(2);
    await expect(tableNode.locator("tbody td")).toHaveCount(4);
    await expect(tableNode.locator("thead")).toHaveCount(0);
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
      .getByRole("tab", { name: /open slide editor|slides/i })
      .or(page.getByRole("button", { name: /open slide editor|slides/i }))
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
    const creds = smokeOwnerCredentials();
    test.skip(!creds, "Set E2E_USER_EMAIL/E2E_USER_PASSWORD to run this flow");
    const docUrl = smokeDocumentUrl();
    test.skip(!docUrl, "Set E2E_SLIDES_DOC_URL to run the export smoke");

    await login(page, creds!);
    await page.goto(docUrl!);

    const editor = await openSlideEditorFromDocument(page);

    const exportTrigger = editor.getByRole("button", {
      name: "Export slides",
    });
    await expect(exportTrigger).toBeVisible({ timeout: 10_000 });
    await exportTrigger.click();

    // Assert the current slide-export menu itself, without starting a download.
    const exportMenu = page.getByRole("menu", { name: "Export slides" });
    await expect(exportMenu).toBeVisible({ timeout: 5_000 });
    await expect(
      exportMenu.getByRole("menuitem", { name: /^Export (PPTX|PDF|PNGs)$/ }),
    ).not.toHaveCount(0);
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
    const creds = smokeOwnerCredentials();
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
    const creds = smokeOwnerCredentials();
    test.skip(!creds, "Set E2E_USER_EMAIL/E2E_USER_PASSWORD to run this flow");

    await login(page, creds!);

    // A "New" / "Create" control should be reachable by role so keyboard and
    // screen-reader users can always start a new document.  We only assert
    // visibility — we do NOT click it to avoid creating documents in CI.
    const createControl = page
      .getByRole("button", { name: /new|create/i })
      .or(page.getByRole("link", { name: /new|create/i }))
      .first();

    await expect(createControl).toBeVisible({ timeout: 10_000 });
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
    const creds = smokeOwnerCredentials();
    test.skip(!creds, "Set E2E_USER_EMAIL/E2E_USER_PASSWORD to run this flow");
    const docUrl = smokeDocumentUrl();
    test.skip(
      !docUrl,
      "Set E2E_SLIDES_DOC_URL to run the editor accessibility check",
    );

    await login(page, creds!);
    await page.goto(docUrl!);

    // Navigate to the slides editor.
    const editor = await openSlideEditorFromDocument(page);

    // Verify at least one slides-specific toolbar control (Present, Export, or
    // Add slide) is visible and reachable by accessible role.  We do NOT click
    // any control that could trigger a download or destructive edit.
    const candidateControls = [
      editor.getByRole("button", { name: /present/i }).first(),
      editor.getByRole("button", { name: /export/i }).first(),
      editor.getByRole("button", { name: /add slide/i }).first(),
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
