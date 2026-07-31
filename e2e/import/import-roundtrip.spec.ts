import { expect, type Page, test } from "@playwright/test";

import { login } from "../helpers/auth";
import { credentialGatedRequest } from "../helpers/credential-gate";
import {
  createDocxRoundtripFixture,
  DOCX_ROUNDTRIP_FIXTURE,
} from "../helpers/docx-fixture";
import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileEditorCredentials,
  profileOwnerCredentials,
  profileViewerCredentials,
} from "../helpers/profile";
import {
  waitForDocumentAutosaveAfter,
  waitForDocumentEditorReady,
} from "../helpers/readiness";
import { IMPORT_MAX_UPLOAD_BYTES } from "../../src/lib/import/format-registry";

/**
 * Document import round-trip E2E coverage (Epic #517, issue #519).
 *
 * Exercises the real import flow end to end:
 *   1. Import representative Markdown through the dashboard UI
 *      (`ImportDocumentButton` → `POST /api/import` → `createDocumentFromImport`
 *      → redirect to the editor).
 *   2. Verify the resulting document opens in the editor with the expected text
 *      and block structure (headings + bullet list).
 *   3. Reload the editor and verify durable persistence of the imported
 *      content.
 *   4. Negative case: an unsupported/unreadable upload yields a graceful error
 *      (HTTP 415) rather than a crash.
 *
 * These specs run ONLY under the deterministic E2E profile (`E2E_PROFILE=1`,
 * `npm run test:e2e:profile` against `npm run db:seed:e2e`). Without the profile
 * they skip cleanly so the credential-less fast gate stays green.
 *
 * DOCX coverage uses a deterministic in-test OOXML fixture generated from
 * stable XML parts so the browser path is covered without committing an opaque
 * binary blob.
 */

/** Representative Markdown exercising headings, paragraph, and a bullet list. */
const SAMPLE_MARKDOWN = [
  "# Import Roundtrip Heading",
  "",
  "An imported paragraph of body text.",
  "",
  "- First imported bullet",
  "- Second imported bullet",
  "",
].join("\n");
const IMPORT_NAVIGATION_TIMEOUT_MS = 120_000;
const EDITOR_READY_TIMEOUT_MS = 60_000;

async function verifyImportedContentSurvivesReload({
  page,
  heading,
  paragraph,
  firstBullet,
  label,
}: {
  page: Page;
  heading: string;
  paragraph: string;
  firstBullet: string;
  label: string;
}): Promise<void> {
  await page.reload();
  const editor = page.getByLabel("Document body");
  await expect(
    editor,
    `persist: editor body missing after ${label} reload`,
  ).toBeVisible({ timeout: EDITOR_READY_TIMEOUT_MS });
  await expect(
    editor.getByText(heading),
    `persist: ${label} heading missing after reload`,
  ).toBeVisible({ timeout: EDITOR_READY_TIMEOUT_MS });
  await expect(
    editor.getByText(paragraph),
    `persist: ${label} paragraph missing after reload`,
  ).toBeVisible();
  await expect(
    editor.locator("li", { hasText: firstBullet }),
    `persist: ${label} bullet list item missing after reload`,
  ).toBeVisible();
}

function parseImportSuccessPayload(payload: unknown): {
  documentId: string;
  documentPath: string;
} {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("import payload must be an object");
  }
  if (Reflect.get(payload, "ok") !== true) {
    throw new Error("import payload must be a success result");
  }

  const documentId = Reflect.get(payload, "documentId");
  const documentPath = Reflect.get(payload, "documentPath");
  if (typeof documentId !== "string" || documentId.trim().length === 0) {
    throw new Error("import success payload is missing documentId");
  }
  if (typeof documentPath !== "string" || documentPath.trim().length === 0) {
    throw new Error("import success payload is missing documentPath");
  }

  return { documentId, documentPath };
}

function parseImportFailurePayload(payload: unknown): {
  code: string;
  status: number;
  message: string;
} {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("import payload must be an object");
  }
  if (Reflect.get(payload, "ok") !== false) {
    throw new Error("import payload must be a failure result");
  }

  const error = Reflect.get(payload, "error");
  if (typeof error !== "object" || error === null) {
    throw new Error("import failure payload is missing error");
  }

  const code = Reflect.get(error, "code");
  const status = Reflect.get(error, "status");
  const message = Reflect.get(error, "message");
  if (typeof code !== "string" || code.trim().length === 0) {
    throw new Error("import failure payload is missing code");
  }
  if (typeof status !== "number" || !Number.isFinite(status)) {
    throw new Error("import failure payload is missing status");
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new Error("import failure payload is missing message");
  }

  return { code, status, message };
}

function workspaceImportFixture(name: string): {
  fileName: string;
  heading: string;
  paragraph: string;
  firstBullet: string;
  markdown: string;
} {
  const heading = `${name} Workspace Import Heading`;
  const paragraph = `${name} workspace import paragraph text.`;
  const firstBullet = `${name} workspace bullet one`;
  const secondBullet = `${name} workspace bullet two`;
  const fileName = `${name.toLowerCase().replace(/\s+/g, "-")}-workspace-import.md`;

  return {
    fileName,
    heading,
    paragraph,
    firstBullet,
    markdown: [
      `# ${heading}`,
      "",
      paragraph,
      "",
      `- ${firstBullet}`,
      `- ${secondBullet}`,
      "",
    ].join("\n"),
  };
}

async function importWorkspaceMarkdown({
  page,
  fileName,
  markdown,
}: {
  page: Page;
  fileName: string;
  markdown: string;
}): Promise<{ documentId: string; documentPath: string }> {
  const response = await credentialGatedRequest(page).post("/api/import", {
    multipart: {
      target: "workspace",
      workspaceId: E2E_PROFILE_FIXTURE.workspaceId,
      file: {
        name: fileName,
        mimeType: "text/markdown",
        buffer: Buffer.from(markdown, "utf8"),
      },
    },
  });
  expect(response.status(), "workspace import should succeed").toBe(200);
  const payload = await response.json();
  return parseImportSuccessPayload(payload);
}

async function chooseDashboardImportFile(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  const importButton = page.getByRole("button", { name: "Import document" });
  await expect(
    importButton,
    "parse: import button not ready on dashboard",
  ).toBeEnabled();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await importButton.click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(file);
}

test.describe("document import round-trip", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(360_000);

  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run import round-trip",
  );

  test("imports Markdown, renders blocks, and persists content across reload @required-profile", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await login(page, profileOwnerCredentials());

    // --- Navigate (fail message distinguishes navigation) -----------------
    await page.goto("/app");
    await expect(page, "navigate: workspace did not load").toHaveURL(/\/app/);

    // --- Failure + retry --------------------------------------------------
    let importRequestCount = 0;
    let releaseSuccessfulImport!: () => void;
    const successfulImportGate = new Promise<void>((resolve) => {
      releaseSuccessfulImport = resolve;
    });
    await page.route("**/api/import", async (route) => {
      importRequestCount += 1;
      if (importRequestCount === 1) {
        await route.fulfill({
          status: 502,
          contentType: "text/plain",
          body: "not-json",
        });
        return;
      }
      if (importRequestCount === 2) {
        await route.abort("failed");
        return;
      }
      if (importRequestCount === 3) {
        await successfulImportGate;
        await route.continue();
        return;
      }
      await route.abort("failed");
    });

    await chooseDashboardImportFile(page, {
      name: "oversized-import.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(IMPORT_MAX_UPLOAD_BYTES + 1),
    });
    const oversizedError = page.getByRole("alert").filter({
      hasText: "File is too large",
    });
    await expect(oversizedError).toContainText("20 MB");
    expect(importRequestCount).toBe(0);

    let retryChooserPromise = page.waitForEvent("filechooser");
    await oversizedError.getByRole("button", { name: "retry" }).click();
    let retryChooser = await retryChooserPromise;
    await retryChooser.setFiles({
      name: "import-roundtrip.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(SAMPLE_MARKDOWN, "utf8"),
    });
    const malformedError = page.getByRole("alert").filter({
      hasText: "invalid import response",
    });
    await expect(malformedError).toBeVisible();

    retryChooserPromise = page.waitForEvent("filechooser");
    await malformedError.getByRole("button", { name: "retry" }).click();
    retryChooser = await retryChooserPromise;
    await retryChooser.setFiles({
      name: "import-roundtrip.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(SAMPLE_MARKDOWN, "utf8"),
    });
    const importError = page.getByRole("alert").filter({
      hasText: "Could not reach the server",
    });
    await expect(importError).toContainText("Could not reach the server");

    retryChooserPromise = page.waitForEvent("filechooser");
    await importError.getByRole("button", { name: "retry" }).click();
    retryChooser = await retryChooserPromise;
    await retryChooser.setFiles({
      name: "import-roundtrip.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(SAMPLE_MARKDOWN, "utf8"),
    });

    const dashboardImportButton = page.getByRole("button", {
      name: "Import document",
    });
    await expect(dashboardImportButton).toBeDisabled();
    await expect(dashboardImportButton).toContainText("Importing…");

    // A second input change while the durable create is pending must not
    // dispatch another request, even though the hidden input remains mounted.
    await page.getByLabel("Import a document file").setInputFiles({
      name: "duplicate-import.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Duplicate import must be ignored\n", "utf8"),
    });
    const requestCountBeforeRelease = importRequestCount;
    releaseSuccessfulImport();
    expect(requestCountBeforeRelease).toBe(3);

    // --- Create + navigate to the new editor ------------------------------
    await page.waitForURL(/\/app\/documents\/[^/]+/, {
      timeout: IMPORT_NAVIGATION_TIMEOUT_MS,
    });

    const editor = page.getByLabel("Document body");
    await expect(
      editor,
      "navigate: editor body not visible after import",
    ).toBeVisible({ timeout: EDITOR_READY_TIMEOUT_MS });

    // --- Verify imported text + block structure ---------------------------
    await expect(
      editor.getByText("Import Roundtrip Heading"),
      "parse: imported heading text missing",
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      editor.getByText("An imported paragraph of body text."),
      "parse: imported paragraph missing",
    ).toBeVisible();
    await expect(
      editor.locator("li", { hasText: "First imported bullet" }),
      "parse: imported bullet list item missing",
    ).toBeVisible();

    await verifyImportedContentSurvivesReload({
      page,
      label: "Markdown import",
      heading: "Import Roundtrip Heading",
      paragraph: "An imported paragraph of body text.",
      firstBullet: "First imported bullet",
    });

    // --- In-editor replace confirmation ----------------------------------
    const editorBody = await waitForDocumentEditorReady(page);
    const editorImportButton = page
      .getByRole("group", { name: "Edit document" })
      .getByRole("button", { name: "Import", exact: true });
    const previousBodyOverflow = await page.evaluate(
      () => document.body.style.overflow,
    );
    const replacementFile = {
      name: "replacement.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Replacement Import Heading\n\nReplacement body text.\n",
        "utf8",
      ),
    };

    const openReplacementDialog = async () => {
      const chooserPromise = page.waitForEvent("filechooser", {
        timeout: 10_000,
      });
      await editorImportButton.focus();
      await page.keyboard.press("Enter");
      const chooser = await chooserPromise;
      await chooser.setFiles(replacementFile);
      const dialog = page.getByRole("dialog", {
        name: "Replace document content?",
      });
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      return dialog;
    };

    let replaceDialog = await openReplacementDialog();
    const cancelImport = replaceDialog.getByRole("button", { name: "Cancel" });
    const confirmImport = replaceDialog.getByRole("button", {
      name: "Replace",
    });
    await expect(cancelImport).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe("hidden");

    await page.keyboard.press("Tab");
    await expect(confirmImport).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(cancelImport).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(confirmImport).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(replaceDialog).toBeHidden();
    await expect(editorImportButton).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe(previousBodyOverflow);
    await expect(
      editorBody.getByText("Import Roundtrip Heading"),
    ).toBeVisible();

    await page.setViewportSize({ width: 375, height: 667 });
    replaceDialog = await openReplacementDialog();
    const mobileDialogBox = await replaceDialog.boundingBox();
    expect(mobileDialogBox).not.toBeNull();
    expect(mobileDialogBox!.x).toBeGreaterThanOrEqual(8);
    expect(mobileDialogBox!.y).toBeGreaterThanOrEqual(8);
    expect(mobileDialogBox!.x + mobileDialogBox!.width).toBeLessThanOrEqual(
      367,
    );
    expect(mobileDialogBox!.y + mobileDialogBox!.height).toBeLessThanOrEqual(
      659,
    );
    await page
      .locator('[data-floating-panel="true"] > [aria-hidden="true"]')
      .click({ position: { x: 4, y: 4 } });
    await expect(replaceDialog).toBeHidden();
    await expect(editorImportButton).toBeFocused();
    await expect(
      editorBody.getByText("Import Roundtrip Heading"),
    ).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 720 });
    replaceDialog = await openReplacementDialog();
    await waitForDocumentAutosaveAfter(page, () =>
      replaceDialog.getByRole("button", { name: "Replace" }).click(),
    );
    await expect(
      editorBody.getByText("Replacement Import Heading"),
    ).toBeVisible();
    await expect(editorBody.getByText("Replacement body text.")).toBeVisible();
    await expect(editorBody.getByText("Import Roundtrip Heading")).toHaveCount(
      0,
    );

    await page.reload();
    const reloadedEditorBody = await waitForDocumentEditorReady(page);
    await expect(
      reloadedEditorBody.getByText("Replacement Import Heading"),
    ).toBeVisible();
    await expect(
      reloadedEditorBody.getByText("Replacement body text."),
    ).toBeVisible();
    await expect(
      reloadedEditorBody.getByText("Import Roundtrip Heading"),
    ).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test("imports DOCX, renders blocks, and persists content across reload @required-profile", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials());

    await page.goto("/app");
    await expect(page, "navigate: workspace did not load").toHaveURL(/\/app/);

    const apiStartedAt = performance.now();
    const importResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/import",
    );
    await chooseDashboardImportFile(page, {
      name: DOCX_ROUNDTRIP_FIXTURE.fileName,
      mimeType: DOCX_ROUNDTRIP_FIXTURE.mimeType,
      buffer: await createDocxRoundtripFixture(),
    });
    const importResponse = await importResponsePromise;
    expect(importResponse.status(), "DOCX import API should succeed").toBe(200);
    const importResult = parseImportSuccessPayload(await importResponse.json());
    const apiDurationMs = Math.round(performance.now() - apiStartedAt);

    const documentStartedAt = performance.now();
    await page.waitForURL(importResult.documentPath, {
      timeout: IMPORT_NAVIGATION_TIMEOUT_MS,
    });

    const editor = page.getByLabel("Document body");
    await expect(
      editor,
      "navigate: editor body not visible after DOCX import",
    ).toBeVisible({ timeout: EDITOR_READY_TIMEOUT_MS });

    await expect(
      editor.getByText(DOCX_ROUNDTRIP_FIXTURE.heading),
      "parse: imported DOCX heading text missing",
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      editor.getByText(DOCX_ROUNDTRIP_FIXTURE.paragraph),
      "parse: imported DOCX paragraph missing",
    ).toBeVisible();
    await expect(
      editor.locator("li", { hasText: DOCX_ROUNDTRIP_FIXTURE.bullets[0] }),
      "parse: imported DOCX bullet list item missing",
    ).toBeVisible();

    await verifyImportedContentSurvivesReload({
      page,
      label: "DOCX import",
      heading: DOCX_ROUNDTRIP_FIXTURE.heading,
      paragraph: DOCX_ROUNDTRIP_FIXTURE.paragraph,
      firstBullet: DOCX_ROUNDTRIP_FIXTURE.bullets[0],
    });
    const documentDurationMs = Math.round(
      performance.now() - documentStartedAt,
    );
    console.log(
      `[e2e-evidence] DOCX API ${apiDurationMs}ms; document navigation/render/reload ${documentDurationMs}ms`,
    );
  });

  test("workspace import by owner persists across reload @required-profile", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await login(page, profileOwnerCredentials());
    const fixture = workspaceImportFixture("Owner");
    await page.goto(`/app/workspaces/${E2E_PROFILE_FIXTURE.workspaceId}`);
    await expect(page.getByText("Loading documents...")).toHaveCount(0);

    let importRequestCount = 0;
    let releaseImport!: () => void;
    const importGate = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });
    await page.route("**/api/import", async (route) => {
      importRequestCount += 1;
      if (importRequestCount === 1) {
        await importGate;
        await route.continue();
        return;
      }
      await route.abort("failed");
    });

    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/import",
    );
    const importButton = page.getByRole("button", {
      name: "Import document",
    });
    const chooserPromise = page.waitForEvent("filechooser");
    await importButton.click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: fixture.fileName,
      mimeType: "text/markdown",
      buffer: Buffer.from(fixture.markdown, "utf8"),
    });
    await expect(importButton).toBeDisabled();
    await expect(importButton).toContainText("Importing…");

    await page
      .getByLabel("Import a document file into workspace")
      .setInputFiles({
        name: "duplicate-workspace-import.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Duplicate workspace import\n", "utf8"),
      });
    const requestCountBeforeRelease = importRequestCount;
    releaseImport();
    expect(requestCountBeforeRelease).toBe(1);

    const response = await responsePromise;
    expect(response.status(), "workspace UI import should succeed").toBe(200);
    const imported = parseImportSuccessPayload(await response.json());
    await page.waitForURL(imported.documentPath, {
      timeout: IMPORT_NAVIGATION_TIMEOUT_MS,
    });

    const editor = page.getByLabel("Document body");
    await expect(editor).toBeVisible({ timeout: EDITOR_READY_TIMEOUT_MS });
    await expect(editor.getByText(fixture.heading)).toBeVisible({
      timeout: 15_000,
    });
    await expect(editor.getByText(fixture.paragraph)).toBeVisible();
    await expect(
      editor.locator("li", { hasText: fixture.firstBullet }),
    ).toBeVisible();

    await verifyImportedContentSurvivesReload({
      page,
      label: "workspace owner import",
      heading: fixture.heading,
      paragraph: fixture.paragraph,
      firstBullet: fixture.firstBullet,
    });
    expect(pageErrors).toEqual([]);
  });

  test("workspace import by editor persists across reload @required-profile", async ({
    page,
  }) => {
    await login(page, profileEditorCredentials());
    const fixture = workspaceImportFixture("Editor");
    const imported = await importWorkspaceMarkdown({
      page,
      fileName: fixture.fileName,
      markdown: fixture.markdown,
    });

    await page.goto(imported.documentPath);
    const editor = page.getByLabel("Document body");
    await expect(editor).toBeVisible({ timeout: EDITOR_READY_TIMEOUT_MS });
    await expect(editor.getByText(fixture.heading)).toBeVisible({
      timeout: 15_000,
    });
    await expect(editor.getByText(fixture.paragraph)).toBeVisible();
    await expect(
      editor.locator("li", { hasText: fixture.firstBullet }),
    ).toBeVisible();

    await verifyImportedContentSurvivesReload({
      page,
      label: "workspace editor import",
      heading: fixture.heading,
      paragraph: fixture.paragraph,
      firstBullet: fixture.firstBullet,
    });
  });

  test("workspace import by viewer is forbidden and creates zero documents @required-profile", async ({
    page,
  }, testInfo) => {
    await login(page, profileViewerCredentials());
    const blockedFileStem = [
      "viewer-blocked-import",
      testInfo.project.name,
      testInfo.parallelIndex,
      testInfo.repeatEachIndex,
      testInfo.retry,
    ].join("-");
    const persistedTitle = blockedFileStem.replace(/[-_]/g, " ");
    const workspacePath = `/app/workspaces/${E2E_PROFILE_FIXTURE.workspaceId}`;

    await page.goto(workspacePath);
    await expect(page.getByText("Loading documents...")).toHaveCount(0);
    const persistedTitleCountBefore = await page
      .getByText(persistedTitle, { exact: true })
      .count();

    const response = await credentialGatedRequest(page).post("/api/import", {
      multipart: {
        target: "workspace",
        workspaceId: E2E_PROFILE_FIXTURE.workspaceId,
        file: {
          name: `${blockedFileStem}.md`,
          mimeType: "text/markdown",
          buffer: Buffer.from(
            `# ${persistedTitle}\n\nviewer should be blocked\n`,
            "utf8",
          ),
        },
      },
    });
    expect(response.status()).toBe(403);
    const payload = await response.json();
    const failure = parseImportFailurePayload(payload);
    expect(failure.code).toBe("forbidden");
    expect(failure.status).toBe(403);

    await page.reload();
    await expect(page.getByText("Loading documents...")).toHaveCount(0);
    await expect(
      page.getByText(persistedTitle, { exact: true }),
      "forbidden workspace import must not change the normalized-title row count",
    ).toHaveCount(persistedTitleCountBefore);
  });

  test("rejects an unsupported file type with a graceful error", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials());

    // The create-only import route validates unsupported payloads for signed-in
    // users before persistence.
    const response = await credentialGatedRequest(page).post("/api/import", {
      multipart: {
        target: "personal",
        file: {
          name: "not-a-document.xyz",
          mimeType: "application/octet-stream",
          buffer: Buffer.from("nonsense-binary-content", "utf8"),
        },
      },
    });

    expect(
      response.status(),
      "parse: unsupported upload should be rejected with 415",
    ).toBe(415);
    const body = await response.json();
    const failure = parseImportFailurePayload(body);
    expect(
      failure.message,
      "parse: unsupported upload should return an error message",
    ).toBeTruthy();
  });
});
