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
  profileOwnerCredentials,
  profileViewerCredentials,
} from "../helpers/profile";
import {
  waitForDocumentAutosaveAfter,
  waitForDocumentEditorReady,
} from "../helpers/readiness";

type AuthenticatedSession = {
  context: BrowserContext;
  page: Page;
};

async function openAuthenticatedSession(
  browser: Browser,
  credentials: Credentials,
  path: string,
): Promise<AuthenticatedSession> {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL as string,
  });
  const page = await context.newPage();
  try {
    await login(page, credentials, path);
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

function commentDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Inline comments" });
}

function anchorBlock(body: Locator, anchorText: string): Locator {
  return body.locator(":scope > *").filter({ hasText: anchorText }).first();
}

async function waitForViewerDocumentReady(page: Page): Promise<Locator> {
  const body = page.getByRole("textbox", { name: "Document body" });
  await expect(body).toBeVisible({ timeout: 30_000 });
  await expect(body).toHaveAttribute("contenteditable", "false");
  await expect(
    page.getByRole("status").filter({ hasText: /^Live$/ }),
  ).toBeVisible({ timeout: 30_000 });
  return body;
}

async function hoverAnchorAndOpen(
  page: Page,
  body: Locator,
  anchorText: string,
): Promise<Locator> {
  const block = anchorBlock(body, anchorText);
  await expect(block).toBeVisible();
  await expect(block).toHaveAttribute("data-lexical-block-id", /.+/);
  const [bodyBox, blockBox] = await Promise.all([
    body.boundingBox(),
    block.boundingBox(),
  ]);
  expect(bodyBox).not.toBeNull();
  expect(blockBox).not.toBeNull();
  if (!bodyBox || !blockBox) {
    throw new Error("Comment anchor geometry is unavailable.");
  }

  await page.mouse.move(
    bodyBox.x + bodyBox.width + 12,
    blockBox.y + blockBox.height / 2,
  );
  const addComment = page.getByRole("button", {
    name: "Add comment to this paragraph",
  });
  await expect(addComment).toBeVisible();
  await addComment.click();
  const dialog = commentDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openOnlyComment(page: Page): Promise<Locator> {
  const marker = page.getByRole("button", { name: "1 comment" });
  await expect(marker).toBeVisible({ timeout: 20_000 });
  await marker.click();
  const dialog = commentDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("UI matrix: document comments lifecycle", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run document comment lifecycle coverage",
  );
  test.setTimeout(180_000);

  test("owner and viewer complete the persisted comment lifecycle", async ({
    browser,
    page,
  }) => {
    const fixture = E2E_PROFILE_FIXTURE.documentCommentLifecycle;
    const documentPath = `/app/documents/${fixture.id}`;

    await login(page, profileOwnerCredentials(), documentPath);
    let ownerBody = await waitForDocumentEditorReady(page);
    await expect(ownerBody.getByText(fixture.content)).toBeVisible();
    const initialAnchorId = await anchorBlock(
      ownerBody,
      fixture.content,
    ).getAttribute("data-lexical-block-id");
    expect(initialAnchorId).not.toBeNull();

    let dialog = await hoverAnchorAndOpen(page, ownerBody, fixture.content);
    const newComment = dialog.getByRole("textbox", {
      name: "Inline comment",
    });
    await expect(newComment).toHaveAttribute("maxlength", "5000");
    await newComment.fill(`  ${fixture.ownerComment}  `);
    await dialog.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "1 comment" })).toBeVisible({
      timeout: 20_000,
    });

    dialog = await openOnlyComment(page);
    await dialog
      .getByRole("button", { name: "Edit comment by E2E Owner" })
      .click();
    const ownerEdit = dialog.getByRole("textbox", {
      name: "Edit comment by E2E Owner",
    });
    await ownerEdit.fill(`  ${fixture.editedOwnerComment}  `);
    await dialog
      .getByRole("button", { name: "Save comment by E2E Owner" })
      .click();
    await expect(dialog.getByText(fixture.editedOwnerComment)).toBeVisible();
    await expect(dialog.getByText(fixture.ownerComment)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close inline comment" }).click();
    await waitForDocumentAutosaveAfter(page, () =>
      ownerBody.fill(fixture.editedContent),
    );
    await expect(ownerBody.getByText(fixture.editedContent)).toBeVisible();
    await expect(anchorBlock(ownerBody, fixture.editedContent)).toHaveAttribute(
      "data-lexical-block-id",
      initialAnchorId!,
    );
    await expect(page.getByRole("button", { name: "1 comment" })).toBeVisible();

    await page.reload();
    ownerBody = await waitForDocumentEditorReady(page);
    await expect(ownerBody.getByText(fixture.editedContent)).toBeVisible();
    await expect(anchorBlock(ownerBody, fixture.editedContent)).toHaveAttribute(
      "data-lexical-block-id",
      initialAnchorId!,
    );
    dialog = await openOnlyComment(page);
    await expect(dialog.getByText(fixture.editedOwnerComment)).toBeVisible();
    await dialog.getByRole("button", { name: "Close inline comment" }).click();

    const viewerSession = await openAuthenticatedSession(
      browser,
      profileViewerCredentials(),
      documentPath,
    );
    try {
      let viewerBody = await waitForViewerDocumentReady(viewerSession.page);
      await expect(viewerBody.getByText(fixture.editedContent)).toBeVisible();
      dialog = await openOnlyComment(viewerSession.page);
      await expect(
        dialog.getByRole("button", { name: "Edit comment by E2E Owner" }),
      ).toHaveCount(0);
      await expect(
        dialog.getByRole("button", { name: "Delete comment by E2E Owner" }),
      ).toHaveCount(0);

      await dialog
        .getByRole("button", { name: "Reply to comment by E2E Owner" })
        .click();
      await dialog
        .getByRole("textbox", { name: "Inline comment" })
        .fill(fixture.viewerReply);
      await dialog.getByRole("button", { name: "Reply", exact: true }).click();
      await expect(dialog.getByText(fixture.viewerReply)).toBeVisible();

      await dialog
        .getByRole("button", { name: "Edit reply by E2E Viewer" })
        .click();
      await dialog
        .getByRole("textbox", { name: "Edit reply by E2E Viewer" })
        .fill(fixture.editedViewerReply);
      await dialog
        .getByRole("button", { name: "Save reply by E2E Viewer" })
        .click();
      await expect(dialog.getByText(fixture.editedViewerReply)).toBeVisible();
      await expect(dialog.getByText(fixture.viewerReply)).toHaveCount(0);

      await dialog
        .getByRole("button", { name: "Resolve comment by E2E Owner" })
        .click();
      await expect(
        dialog.getByRole("button", { name: "Reopen comment by E2E Owner" }),
      ).toBeVisible();
      await expect(dialog.getByText("0 open · 1 resolved")).toBeVisible();
      await dialog
        .getByRole("button", { name: "Close inline comment" })
        .click();

      await viewerSession.page.reload();
      viewerBody = await waitForViewerDocumentReady(viewerSession.page);
      await expect(
        viewerSession.page.getByRole("button", { name: "1 comment" }),
      ).toHaveCount(0);
      dialog = await hoverAnchorAndOpen(
        viewerSession.page,
        viewerBody,
        fixture.editedContent,
      );
      await expect(dialog.getByText("0 open · 1 resolved")).toBeVisible();
      await expect(dialog.getByText(fixture.editedViewerReply)).toBeVisible();
      await dialog
        .getByRole("button", { name: "Reopen comment by E2E Owner" })
        .click();
      await expect(
        viewerSession.page.getByRole("button", { name: "1 comment" }),
      ).toBeVisible({ timeout: 20_000 });

      await dialog
        .getByRole("button", { name: "Delete reply by E2E Viewer" })
        .click();
      await dialog
        .getByRole("button", {
          name: "Cancel deleting reply by E2E Viewer",
        })
        .click();
      await expect(dialog.getByText(fixture.editedViewerReply)).toBeVisible();
      await dialog
        .getByRole("button", { name: "Delete reply by E2E Viewer" })
        .click();
      await dialog
        .getByRole("button", {
          name: "Confirm delete reply by E2E Viewer",
        })
        .click();
      await expect(dialog.getByText(fixture.editedViewerReply)).toHaveCount(0);
      await dialog
        .getByRole("button", { name: "Close inline comment" })
        .click();

      await viewerSession.page.reload();
      await waitForViewerDocumentReady(viewerSession.page);
      dialog = await openOnlyComment(viewerSession.page);
      await expect(dialog.getByText(fixture.editedOwnerComment)).toBeVisible();
      await expect(dialog.getByText(fixture.editedViewerReply)).toHaveCount(0);
      await dialog
        .getByRole("button", { name: "Close inline comment" })
        .click();
    } finally {
      await viewerSession.context.close();
    }

    await page.reload();
    ownerBody = await waitForDocumentEditorReady(page);
    dialog = await openOnlyComment(page);
    await dialog
      .getByRole("button", { name: "Delete comment by E2E Owner" })
      .click();
    await dialog
      .getByRole("button", { name: "Cancel deleting comment by E2E Owner" })
      .click();
    await expect(dialog.getByText(fixture.editedOwnerComment)).toBeVisible();
    await dialog
      .getByRole("button", { name: "Delete comment by E2E Owner" })
      .click();
    await dialog
      .getByRole("button", { name: "Confirm delete comment by E2E Owner" })
      .click();
    await expect(dialog.getByText(fixture.editedOwnerComment)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close inline comment" }).click();

    await page.reload();
    ownerBody = await waitForDocumentEditorReady(page);
    await expect(page.getByRole("button", { name: "1 comment" })).toHaveCount(
      0,
    );
    dialog = await hoverAnchorAndOpen(page, ownerBody, fixture.editedContent);
    await expect(dialog.getByText(fixture.editedOwnerComment)).toHaveCount(0);
  });
});
