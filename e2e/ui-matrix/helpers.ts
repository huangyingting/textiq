import { expect, type Page } from "@playwright/test";

import { login } from "../helpers/auth";
import { profileDocPath, profileOwnerCredentials } from "../helpers/profile";

export async function loginAsProfileOwner(page: Page, afterLoginPath?: string) {
  await login(page, profileOwnerCredentials(), afterLoginPath);
}

export async function openProfileDocument(page: Page) {
  await loginAsProfileOwner(page, profileDocPath());
  await expect(
    page.getByRole("textbox", { name: "Document body" }),
    "ui-matrix: document editor body surface should render",
  ).toBeVisible({ timeout: 60_000 });
}

export async function expectNoPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return async () => {
    expect(
      errors,
      "ui-matrix: no browser console/page errors expected",
    ).toEqual([]);
  };
}
