import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { login } from "../helpers/auth";
import {
  CONFLICT_RECOVERY_FIXTURES,
  E2E_CONFLICT_OWNER_THEME_FIXTURE,
  type PresentationTestFixtureName,
} from "../helpers/presentation-fixtures";
import {
  e2eProfileEnabled,
  profileDocPath,
  profileEditorCredentials,
  profileOwnerCredentials,
} from "../helpers/profile";
import {
  waitForSlideAutosave,
  waitForStableSlideStage,
} from "../helpers/readiness";

const BODY_NODE_SELECTOR =
  '[data-slide-stage-viewport="true"] [data-slide-canvas="true"] [data-node-id="fixture-bullets"][role="button"]';

type Frame = { width: number; height: number };

async function openConflictEditor(
  page: Page,
  fixtureName: PresentationTestFixtureName,
  credentials = profileOwnerCredentials(),
): Promise<Locator> {
  await login(
    page,
    credentials,
    `${profileDocPath(fixtureName, test.info())}/slides`,
  );
  const editor = page.locator('[data-slide-editor="true"]').first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await waitForStableSlideStage(
    editor.locator('[data-slide-canvas="true"]').first(),
  );
  await expect(editor.locator(BODY_NODE_SELECTOR)).toBeVisible();
  return editor;
}

async function openTwoLoadedSessions(
  browser: Browser,
  firstPage: Page,
  fixtureName: PresentationTestFixtureName,
): Promise<{
  firstEditor: Locator;
  secondContext: BrowserContext;
  secondPage: Page;
  secondEditor: Locator;
}> {
  const secondContext = await browser.newContext({
    baseURL: test.info().project.use.baseURL as string,
    viewport: { width: 1280, height: 720 },
  });
  const secondPage = await secondContext.newPage();
  try {
    const [firstEditor, secondEditor] = await Promise.all([
      openConflictEditor(firstPage, fixtureName),
      openConflictEditor(secondPage, fixtureName, profileEditorCredentials()),
    ]);
    return { firstEditor, secondContext, secondPage, secondEditor };
  } catch (error) {
    await secondContext.close();
    throw error;
  }
}

async function readFrame(editor: Locator): Promise<Frame> {
  const style = await editor.locator(BODY_NODE_SELECTOR).getAttribute("style");
  expect(style).not.toBeNull();
  const width = Number.parseFloat(
    style!.match(/width:\s*([0-9.]+)%/i)?.[1] ?? "",
  );
  const height = Number.parseFloat(
    style!.match(/height:\s*([0-9.]+)%/i)?.[1] ?? "",
  );
  expect(Number.isFinite(width)).toBe(true);
  expect(Number.isFinite(height)).toBe(true);
  return { width, height };
}

async function resizeSelectedNode(
  page: Page,
  editor: Locator,
  key: "Alt+ArrowRight" | "Alt+Shift+ArrowDown",
): Promise<Frame> {
  const node = editor.locator(BODY_NODE_SELECTOR);
  await node.click();
  await expect(node).toHaveAttribute("aria-pressed", "true");
  await node.focus();
  const before = await readFrame(editor);
  await page.keyboard.press(key);
  await expect
    .poll(() => readFrame(editor), { timeout: 15_000 })
    .not.toEqual(before);
  return readFrame(editor);
}

async function readThemeMarker(editor: Locator): Promise<string> {
  return editor
    .locator('[data-slide-canvas="true"]')
    .first()
    .evaluate((canvas) => {
      const style = getComputedStyle(canvas);
      return `${style.backgroundColor}|${style.backgroundImage}`;
    });
}

async function applyOwnerOnlyTheme(page: Page, editor: Locator): Promise<void> {
  await page.getByRole("button", { name: "Deck theme" }).click();
  const picker = page.getByRole("dialog", { name: "Theme picker" });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "Recent", exact: true }).click();
  await picker
    .getByRole("option", {
      name: new RegExp(E2E_CONFLICT_OWNER_THEME_FIXTURE.name),
    })
    .click();
  await expect(page.getByRole("button", { name: "Deck theme" })).toContainText(
    E2E_CONFLICT_OWNER_THEME_FIXTURE.name,
  );
  await expect
    .poll(() => readThemeMarker(editor))
    .toContain("rgb(124, 58, 237)");
  await waitForSlideAutosave(page);
}

function conflictDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Save conflict detected" });
}

type ConflictTestFixtures = {
  browser: Browser;
  page: Page;
};

const keepMineConflictTest = async ({
  browser,
  page,
}: ConflictTestFixtures) => {
  const sessions = await openTwoLoadedSessions(
    browser,
    page,
    CONFLICT_RECOVERY_FIXTURES.keepMine,
  );
  try {
    const initial = await readFrame(sessions.firstEditor);
    await expect
      .poll(() => readFrame(sessions.secondEditor), { timeout: 15_000 })
      .toEqual(initial);

    const firstSaved = await resizeSelectedNode(
      page,
      sessions.firstEditor,
      "Alt+ArrowRight",
    );
    expect(firstSaved.width).toBeGreaterThan(initial.width);
    expect(firstSaved.height).toBe(initial.height);
    await waitForSlideAutosave(page);

    const staleLocal = await resizeSelectedNode(
      sessions.secondPage,
      sessions.secondEditor,
      "Alt+Shift+ArrowDown",
    );
    expect(staleLocal.width).toBe(initial.width);
    expect(staleLocal.height).toBeGreaterThan(initial.height);
    const undo = sessions.secondEditor.getByRole("button", {
      name: "Undo",
      exact: true,
    });
    const redo = sessions.secondEditor.getByRole("button", {
      name: "Redo",
      exact: true,
    });
    await expect(undo).toBeEnabled();

    const dialog = conflictDialog(sessions.secondPage);
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "Keep my version" }).click();
    // handleConflictKeepMine calls setConflictState(null) only after saveDeckJson
    // resolves; the dialog stays visible until the save completes.  Wait for the
    // observable semantic condition (save acknowledged in the footer) before
    // asserting the dialog is gone — both state updates land in the same React
    // render batch, so toBeHidden() is immediately satisfied after the save.
    await waitForSlideAutosave(sessions.secondPage, { timeout: 45_000 });
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => readFrame(sessions.secondEditor), { timeout: 15_000 })
      .toEqual(staleLocal);

    await undo.click();
    await expect
      .poll(() => readFrame(sessions.secondEditor), { timeout: 15_000 })
      .toEqual(initial);
    await waitForSlideAutosave(sessions.secondPage, { timeout: 45_000 });
    await expect(redo).toBeEnabled();

    await redo.click();
    await expect
      .poll(() => readFrame(sessions.secondEditor), { timeout: 15_000 })
      .toEqual(staleLocal);
    await waitForSlideAutosave(sessions.secondPage, { timeout: 45_000 });

    await sessions.secondPage.reload();
    await waitForStableSlideStage(
      sessions.secondEditor.locator('[data-slide-canvas="true"]').first(),
    );
    await expect
      .poll(() => readFrame(sessions.secondEditor), { timeout: 15_000 })
      .toEqual(staleLocal);

    await page.reload();
    await waitForStableSlideStage(
      sessions.firstEditor.locator('[data-slide-canvas="true"]').first(),
    );
    await expect
      .poll(() => readFrame(sessions.firstEditor))
      .toEqual(staleLocal);
  } finally {
    await sessions.secondContext.close();
  }
};

const useServerConflictTest = async ({
  browser,
  page,
}: ConflictTestFixtures) => {
  const sessions = await openTwoLoadedSessions(
    browser,
    page,
    CONFLICT_RECOVERY_FIXTURES.useServer,
  );
  try {
    const initial = await readFrame(sessions.firstEditor);
    await expect
      .poll(() => readFrame(sessions.secondEditor), { timeout: 15_000 })
      .toEqual(initial);

    await applyOwnerOnlyTheme(page, sessions.firstEditor);
    await waitForStableSlideStage(
      sessions.firstEditor.locator('[data-slide-canvas="true"]').first(),
    );
    const serverFrame = await resizeSelectedNode(
      page,
      sessions.firstEditor,
      "Alt+ArrowRight",
    );
    expect(serverFrame.width).toBeGreaterThan(initial.width);
    expect(serverFrame.height).toBe(initial.height);
    await waitForSlideAutosave(page);

    const undo = sessions.secondEditor.getByRole("button", {
      name: "Undo",
      exact: true,
    });
    const redo = sessions.secondEditor.getByRole("button", {
      name: "Redo",
      exact: true,
    });
    const staleLocal = await resizeSelectedNode(
      sessions.secondPage,
      sessions.secondEditor,
      "Alt+Shift+ArrowDown",
    );
    expect(staleLocal.width).toBe(initial.width);
    expect(staleLocal.height).toBeGreaterThan(initial.height);
    await expect(undo).toBeEnabled();

    const dialog = conflictDialog(sessions.secondPage);
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await sessions.secondPage.evaluate(
      ({ bodySelector, serverWidth }) => {
        const body = document.querySelector<HTMLElement>(bodySelector);
        const canvas = document.querySelector<HTMLElement>(
          '[data-slide-editor="true"] [data-slide-canvas="true"]',
        );
        if (!body || !canvas) throw new Error("Conflict theme markers missing");
        const samples: { width: number; marker: string }[] = [];
        const sample = () => {
          const width = Number.parseFloat(
            body.style.width.match(/([0-9.]+)%/)?.[1] ?? "",
          );
          const style = getComputedStyle(canvas);
          samples.push({
            width,
            marker: `${style.backgroundColor}|${style.backgroundImage}`,
          });
        };
        sample();
        const observer = new MutationObserver(sample);
        observer.observe(body, {
          attributes: true,
          attributeFilter: ["style"],
        });
        observer.observe(canvas, {
          attributes: true,
          attributeFilter: ["style"],
        });
        Object.assign(window, {
          __conflictThemeObserver: observer,
          __conflictThemeSamples: samples,
          __conflictServerWidth: serverWidth,
        });
      },
      { bodySelector: BODY_NODE_SELECTOR, serverWidth: serverFrame.width },
    );
    await dialog.getByRole("button", { name: "Use server version" }).click();
    // handleConflictUseTheirs batches setDeck and setConflictState(null) in one
    // React render after the reload resolves.  Wait for the frame to reflect the
    // server geometry (observable semantic condition) before asserting the dialog
    // is hidden — both updates land together, so toBeHidden() is immediate.
    await expect
      .poll(() => readFrame(sessions.secondEditor), { timeout: 15_000 })
      .toEqual(serverFrame);
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => readThemeMarker(sessions.secondEditor), { timeout: 15_000 })
      .toContain("rgb(124, 58, 237)");
    const themeSamples = await sessions.secondPage.evaluate(() => {
      const state = window as typeof window & {
        __conflictThemeObserver?: MutationObserver;
        __conflictThemeSamples?: { width: number; marker: string }[];
        __conflictServerWidth?: number;
      };
      state.__conflictThemeObserver?.disconnect();
      return {
        samples: state.__conflictThemeSamples ?? [],
        serverWidth: state.__conflictServerWidth,
      };
    });
    const serverRenderSamples = themeSamples.samples.filter(
      (sample) =>
        themeSamples.serverWidth !== undefined &&
        Math.abs(sample.width - themeSamples.serverWidth) < 0.01,
    );
    expect(serverRenderSamples.length).toBeGreaterThan(0);
    expect(
      serverRenderSamples.every((sample) =>
        sample.marker.includes("rgb(124, 58, 237)"),
      ),
      "the accepted server geometry must never commit with Neutral",
    ).toBe(true);
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    await sessions.secondPage
      .getByRole("button", { name: "Deck theme" })
      .click();
    const collaboratorPicker = sessions.secondPage.getByRole("dialog", {
      name: "Theme picker",
    });
    await collaboratorPicker
      .getByRole("button", { name: "Recent", exact: true })
      .click();
    await expect(
      collaboratorPicker.getByRole("option", {
        name: new RegExp(E2E_CONFLICT_OWNER_THEME_FIXTURE.name),
      }),
    ).toHaveCount(0);
    await sessions.secondPage.keyboard.press("Escape");

    await sessions.secondPage.reload();
    await waitForStableSlideStage(
      sessions.secondEditor.locator('[data-slide-canvas="true"]').first(),
    );
    await expect
      .poll(() => readFrame(sessions.secondEditor), { timeout: 15_000 })
      .toEqual(serverFrame);
    await expect
      .poll(() => readThemeMarker(sessions.secondEditor), { timeout: 15_000 })
      .toContain("rgb(124, 58, 237)");
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
  } finally {
    await sessions.secondContext.close();
  }
};

const conflictTests = [
  {
    title:
      "Keep my version overwrites the newer server deck and persists on reload",
    run: keepMineConflictTest,
  },
  {
    title:
      "Use server version discards stale local edits, clears history, and persists on reload",
    run: useServerConflictTest,
  },
] as const;

test.describe("slide deck conflict recovery", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed the deterministic profile",
  );
  test.setTimeout(120_000);

  const orderedTests =
    process.env.E2E_CONFLICT_TEST_ORDER === "reverse"
      ? [...conflictTests].reverse()
      : conflictTests;
  for (const conflictTest of orderedTests) {
    test(conflictTest.title, conflictTest.run);
  }
});
