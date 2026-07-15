import { expect, type Page, test } from "@playwright/test";

import { login } from "../helpers/auth";
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
  const response = await page.request.post("/api/import", {
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
    await login(page, profileOwnerCredentials());

    // --- Navigate (fail message distinguishes navigation) -----------------
    await page.goto("/app");
    await expect(page, "navigate: workspace did not load").toHaveURL(/\/app/);

    // --- Import (parse + create) ------------------------------------------
    // The hidden file input drives `ImportDocumentButton`; setting files on it
    // triggers the same POST /api/import → createDocumentFromImport flow a user
    // gets by clicking "Import document" and choosing a file.
    const fileInput = page.getByLabel("Import a document file");
    await expect(
      fileInput,
      "parse: import file input not found on dashboard",
    ).toHaveCount(1);

    await fileInput.setInputFiles({
      name: "import-roundtrip.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(SAMPLE_MARKDOWN, "utf8"),
    });

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
  });

  test("imports DOCX, renders blocks, and persists content across reload @required-profile", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials());

    await page.goto("/app");
    await expect(page, "navigate: workspace did not load").toHaveURL(/\/app/);

    const fileInput = page.getByLabel("Import a document file");
    await expect(
      fileInput,
      "parse: import file input not found on dashboard",
    ).toHaveCount(1);

    await fileInput.setInputFiles({
      name: DOCX_ROUNDTRIP_FIXTURE.fileName,
      mimeType: DOCX_ROUNDTRIP_FIXTURE.mimeType,
      buffer: await createDocxRoundtripFixture(),
    });

    await page.waitForURL(/\/app\/documents\/[^/]+/, {
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
  });

  test("workspace import by owner persists across reload @required-profile", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials());
    const fixture = workspaceImportFixture("Owner");
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
      label: "workspace owner import",
      heading: fixture.heading,
      paragraph: fixture.paragraph,
      firstBullet: fixture.firstBullet,
    });
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
  }) => {
    await login(page, profileViewerCredentials());
    const blockedTitle = `viewer-blocked-${Date.now()}`;
    const response = await page.request.post("/api/import", {
      multipart: {
        target: "workspace",
        workspaceId: E2E_PROFILE_FIXTURE.workspaceId,
        file: {
          name: `${blockedTitle}.md`,
          mimeType: "text/markdown",
          buffer: Buffer.from(
            `# ${blockedTitle}\n\nviewer should be blocked\n`,
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

    await page.goto(`/app/workspaces/${E2E_PROFILE_FIXTURE.workspaceId}`);
    await expect(
      page.getByText(blockedTitle, { exact: true }),
      "forbidden workspace import must not create a new document row",
    ).toHaveCount(0);
  });

  test("rejects an unsupported file type with a graceful error", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials());

    // The create-only import route validates unsupported payloads for signed-in
    // users before persistence.
    const response = await page.request.post("/api/import", {
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
