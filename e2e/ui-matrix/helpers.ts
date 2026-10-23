import { expect, type Page } from "@playwright/test";

import { login } from "../helpers/auth";
import type { PresentationTestFixtureName } from "../helpers/presentation-fixtures";
import { waitForDocumentEditorReady } from "../helpers/readiness";
import {
  E2E_PROFILE_FIXTURE,
  profileDocPath,
  profileOwnerCredentials,
} from "../helpers/profile";

export async function loginAsProfileOwner(page: Page, afterLoginPath?: string) {
  await login(page, profileOwnerCredentials(), afterLoginPath);
}

export async function openProfileDocument(
  page: Page,
  fixtureName?: PresentationTestFixtureName,
) {
  await loginAsProfileOwner(page, profileDocPath(fixtureName));
  await waitForDocumentEditorReady(page);
  await expect(
    page.getByText(E2E_PROFILE_FIXTURE.documentBodyText),
    "ui-matrix: seeded document body text should hydrate into the editor",
  ).toBeVisible({ timeout: 60_000 });
}

export async function expectNoPageErrors(
  page: Page,
  shouldIgnoreConsoleError: (message: string) => boolean = () => false,
) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !shouldIgnoreConsoleError(message.text())
    ) {
      errors.push(message.text());
    }
  });
  return async () => {
    expect(
      errors,
      "ui-matrix: no browser console/page errors expected",
    ).toEqual([]);
  };
}
