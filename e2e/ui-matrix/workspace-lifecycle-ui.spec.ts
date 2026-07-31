import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { login, type Credentials } from "../helpers/auth";
import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileEditorCredentials,
  profileOwnerCredentials,
  profileViewerCredentials,
} from "../helpers/profile";

type AuthenticatedSession = {
  context: BrowserContext;
  page: Page;
};

async function openAuthenticatedSession(
  browser: Browser,
  credentials: Credentials,
): Promise<AuthenticatedSession> {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL as string,
  });
  const page = await context.newPage();
  try {
    await login(page, credentials, "/app/workspaces");
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

function memberRow(page: Page, email: string): Locator {
  return page
    .locator("li")
    .filter({ has: page.getByText(email, { exact: true }) })
    .first();
}

function workspaceLink(page: Page, name: string): Locator {
  return page.getByRole("link", { name: new RegExp(name, "i") }).first();
}

async function createInvite(
  page: Page,
  role: "EDITOR" | "VIEWER",
  options: { expiry?: string; maxUses?: string } = {},
): Promise<string> {
  await page.getByLabel("Invite member role").selectOption(role);
  await page
    .getByLabel("Invite link expiry")
    .selectOption(options.expiry ?? "0");
  const maxUses = page.getByLabel("Maximum uses (leave blank for unlimited)");
  await maxUses.fill(options.maxUses ?? "");
  await page.getByRole("button", { name: "Create invite link" }).click();

  const roleLabel = role === "EDITOR" ? "Editor" : "Viewer";
  const invite = page.getByLabel(`Invite link for ${roleLabel}`).first();
  await expect(invite).toHaveValue(/\/app\/join\//, { timeout: 20_000 });
  return invite.inputValue();
}

test.describe("UI matrix: workspace lifecycle", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run workspace lifecycle coverage",
  );
  test.setTimeout(180_000);

  test("owner, editor, and viewer complete the workspace lifecycle", async ({
    browser,
    page,
  }) => {
    const fixture = E2E_PROFILE_FIXTURE.workspaceLifecycle;
    const owner = profileOwnerCredentials();
    const editor = profileEditorCredentials();
    const viewer = profileViewerCredentials();

    await login(page, owner, "/app/workspaces");
    await page.getByRole("button", { name: "New workspace" }).click();
    let dialog = page.getByRole("dialog", { name: "Create workspace" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Workspace name").fill("cancelled workspace");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "New workspace" }).click();
    dialog = page.getByRole("dialog", { name: "Create workspace" });
    await dialog.getByLabel("Workspace name").fill("   ");
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Workspace name is required.",
    );

    await dialog.getByLabel("Workspace name").fill(fixture.initialName);
    await Promise.all([
      page.waitForURL(/\/app\/workspaces\/[^/]+$/, {
        waitUntil: "commit",
      }),
      dialog.getByRole("button", { name: "Create", exact: true }).click(),
    ]);
    const workspacePath = new URL(page.url()).pathname;
    expect(workspacePath).toMatch(/^\/app\/workspaces\/[^/]+$/);
    await expect(
      page.getByRole("heading", { name: fixture.initialName }),
    ).toBeVisible();

    await page.getByLabel("Workspace name").fill(`  ${fixture.renamedName}  `);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByRole("heading", { name: fixture.renamedName }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("Workspace name")).toHaveValue(
      fixture.renamedName,
    );

    const revokedInvite = await createInvite(page, "VIEWER", { expiry: "1" });
    await page
      .getByRole("button", { name: "Revoke invite link" })
      .first()
      .click();
    await expect(page.getByLabel("Invite link for Viewer")).toHaveCount(0);

    const viewerSession = await openAuthenticatedSession(browser, viewer);
    const editorSession = await openAuthenticatedSession(browser, editor);
    try {
      await viewerSession.page.goto(revokedInvite);
      await expect(
        viewerSession.page.getByRole("heading", {
          name: "Invite no longer valid",
        }),
      ).toBeVisible();
      await expect(
        viewerSession.page.getByText(
          "This invite link has been revoked by a workspace owner.",
        ),
      ).toBeVisible();

      const viewerInvite = await createInvite(page, "VIEWER");
      await viewerSession.page.goto(viewerInvite);
      await expect(viewerSession.page).toHaveURL(workspacePath);
      await expect(memberRow(viewerSession.page, viewer.email)).toContainText(
        "Viewer",
      );
      await expect(
        viewerSession.page.getByRole("button", { name: "Leave", exact: true }),
      ).toBeVisible();

      const editorInvite = await createInvite(page, "EDITOR", {
        maxUses: "1",
      });
      await editorSession.page.goto(editorInvite);
      await expect(editorSession.page).toHaveURL(workspacePath);
      await expect(memberRow(editorSession.page, editor.email)).toContainText(
        "Editor",
      );

      await page.reload();
      await expect(memberRow(page, viewer.email)).toContainText("Viewer");
      await expect(memberRow(page, editor.email)).toContainText("Editor");
      await expect(page.getByText(/1\/1 used/)).toBeVisible();

      await page
        .getByRole("button", { name: `Remove ${viewer.email}` })
        .click();
      await expect(memberRow(page, viewer.email)).toHaveCount(0);
      await viewerSession.page.goto(workspacePath);
      await expect(
        viewerSession.page.getByRole("heading", { name: "Page not found" }),
      ).toBeVisible();
      await expect(
        viewerSession.page.getByRole("heading", {
          name: fixture.renamedName,
        }),
      ).toHaveCount(0);
      await viewerSession.page.goto("/app/workspaces");
      await expect(
        workspaceLink(viewerSession.page, fixture.renamedName),
      ).toHaveCount(0);

      const makeOwner = page.getByRole("button", {
        name: `Make ${editor.email} the owner`,
      });
      await makeOwner.click();
      let transferDialog = page.getByRole("dialog", {
        name: "Transfer ownership?",
      });
      await expect(transferDialog).toBeVisible();
      await transferDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(transferDialog).toHaveCount(0);

      await makeOwner.click();
      transferDialog = page.getByRole("dialog", {
        name: "Transfer ownership?",
      });
      await transferDialog
        .getByRole("button", { name: "Transfer ownership" })
        .click();
      await expect(memberRow(page, editor.email)).toContainText("Owner", {
        timeout: 20_000,
      });
      await expect(memberRow(page, owner.email)).toContainText("Editor");
      await expect(page.getByLabel("Workspace name")).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Invite links" }),
      ).toHaveCount(0);

      await editorSession.page.reload();
      await expect(editorSession.page.getByLabel("Workspace name")).toHaveValue(
        fixture.renamedName,
      );
      await expect(
        editorSession.page.getByRole("heading", { name: "Invite links" }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Leave", exact: true }).click();
      let leaveDialog = page.getByRole("dialog", {
        name: "Leave this workspace?",
      });
      await leaveDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(leaveDialog).toHaveCount(0);
      await page.getByRole("button", { name: "Leave", exact: true }).click();
      leaveDialog = page.getByRole("dialog", {
        name: "Leave this workspace?",
      });
      await Promise.all([
        page.waitForURL(/\/app\/workspaces$/),
        leaveDialog.getByRole("button", { name: "Leave workspace" }).click(),
      ]);
      await expect(workspaceLink(page, fixture.renamedName)).toHaveCount(0);

      await editorSession.page
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      let deleteDialog = editorSession.page.getByRole("dialog", {
        name: "Delete this workspace?",
      });
      await deleteDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(deleteDialog).toHaveCount(0);
      await editorSession.page
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      deleteDialog = editorSession.page.getByRole("dialog", {
        name: "Delete this workspace?",
      });
      await Promise.all([
        editorSession.page.waitForURL(/\/app\/workspaces$/),
        deleteDialog.getByRole("button", { name: "Delete workspace" }).click(),
      ]);
      await expect(
        workspaceLink(editorSession.page, fixture.renamedName),
      ).toHaveCount(0);
    } finally {
      await Promise.all([
        viewerSession.context.close(),
        editorSession.context.close(),
      ]);
    }
  });
});
