import { expect, test, type Page } from "@playwright/test";

import {
  APP_THEME_COOKIE_KEY,
  APP_THEME_MODES,
  APP_THEME_STORAGE_KEY,
  type AppThemeMode,
} from "@/lib/app-shell/theme";

import { e2eProfileEnabled } from "../helpers/profile";
import { expectNoPageErrors, loginAsProfileOwner } from "./helpers";

const THEME_LABEL: Record<AppThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
  ocean: "Ocean",
  mint: "Mint",
  rose: "Rose",
  amber: "Amber",
};

async function selectTheme(page: Page, mode: AppThemeMode): Promise<void> {
  const trigger = page.getByRole("button", { name: /^Theme:/ }).filter({
    visible: true,
  });
  await trigger.click();
  await page
    .getByRole("listbox", { name: /^Theme:/ })
    .getByRole("option", { name: THEME_LABEL[mode], exact: true })
    .getByRole("button")
    .click();
}

async function expectThemeState(page: Page, mode: AppThemeMode): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        ({ cookieKey, storageKey }) => ({
          cookie: document.cookie
            .split(";")
            .map((entry) => entry.trim())
            .find((entry) => entry.startsWith(`${cookieKey}=`)),
          dom: document.documentElement.dataset.theme,
          stored: window.localStorage.getItem(storageKey),
        }),
        {
          cookieKey: APP_THEME_COOKIE_KEY,
          storageKey: APP_THEME_STORAGE_KEY,
        },
      ),
    )
    .toEqual({
      cookie: `${APP_THEME_COOKIE_KEY}=${mode}`,
      dom: mode,
      stored: mode,
    });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        body: Math.max(
          0,
          document.body.scrollWidth - document.body.clientWidth,
        ),
        root: Math.max(
          0,
          document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      })),
    )
    .toEqual({ body: 0, root: 0 });
}

async function dispatchHelpShortcut(page: Page): Promise<void> {
  await page.keyboard.press("?");
}

test.describe("UI matrix: app shell", () => {
  test.setTimeout(120_000);

  test.beforeEach(() => {
    test.skip(
      !e2eProfileEnabled(),
      "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run app-shell coverage",
    );
  });

  test("desktop themes update every persistence channel and survive reload", async ({
    page,
  }) => {
    const assertNoPageErrors = await expectNoPageErrors(page);
    await loginAsProfileOwner(page, "/app/settings");

    for (const mode of APP_THEME_MODES) {
      await selectTheme(page, mode);
      await expectThemeState(page, mode);
      await expect(
        page.getByRole("button", {
          name: new RegExp(`^Theme: ${THEME_LABEL[mode]}`),
        }),
      ).toBeVisible();
    }

    await page.reload();
    await expectThemeState(page, "amber");
    await expect(
      page.getByRole("button", { name: "Theme: Amber" }),
    ).toBeVisible();
    await assertNoPageErrors();
  });

  test("desktop user and shortcut menus close accessibly and ignore typing", async ({
    page,
  }) => {
    const assertNoPageErrors = await expectNoPageErrors(page);
    await loginAsProfileOwner(page, "/app/settings");

    const userMenuTrigger = page.getByRole("button", { name: "User menu" });
    await userMenuTrigger.click();
    const userMenu = page.getByRole("menu");
    await expect(
      userMenu.getByRole("menuitem", { name: "Settings" }),
    ).toBeVisible();
    await expect(
      userMenu.getByRole("menuitem", { name: "Billing & Plan" }),
    ).toBeVisible();
    await expect(
      userMenu.getByRole("menuitem", { name: "Sign out" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(userMenu).toHaveCount(0);
    await expect(userMenuTrigger).toBeFocused();

    const shortcutTrigger = page.getByRole("button", {
      name: "Keyboard shortcuts",
    });
    await shortcutTrigger.click();
    const shortcutDialog = page.getByRole("dialog", {
      name: "Keyboard shortcuts",
    });
    await expect(shortcutDialog).toBeVisible();
    await expect(
      shortcutDialog.getByRole("button", { name: "Close" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(shortcutDialog).toHaveCount(0);
    await expect(shortcutTrigger).toBeFocused();

    const currentPassword = page.getByLabel("Current password");
    await currentPassword.focus();
    await currentPassword.press("?");
    await expect(shortcutDialog).toHaveCount(0);
    await expect(currentPassword).toHaveValue("?");
    await currentPassword.clear();

    await page.getByRole("heading", { name: "Settings" }).click();
    await dispatchHelpShortcut(page);
    await expect(shortcutDialog).toBeVisible();
    await dispatchHelpShortcut(page);
    await expect(shortcutDialog).toHaveCount(0);
    await assertNoPageErrors();
  });

  test("mobile drawer composes theme and shortcut overlays without duplicates or overflow", async ({
    page,
  }) => {
    const assertNoPageErrors = await expectNoPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsProfileOwner(page, "/app/settings");
    await expectNoHorizontalOverflow(page);

    const drawerTrigger = page.getByRole("button", {
      name: "Open navigation menu",
    });
    await drawerTrigger.click();
    const drawer = page.getByRole("dialog", { name: "Navigation menu" });
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole("button", { name: "Close navigation menu" }),
    ).toBeFocused();

    const themeTrigger = drawer.getByRole("button", { name: /^Theme:/ });
    await themeTrigger.click();
    await page
      .getByRole("listbox", { name: /^Theme:/ })
      .getByRole("option", { name: "Mint", exact: true })
      .getByRole("button")
      .click();
    await expectThemeState(page, "mint");
    await expect(drawer).toBeVisible();
    await expect(themeTrigger).toBeFocused();

    await dispatchHelpShortcut(page);
    const shortcutDialogs = page.getByRole("dialog", {
      name: "Keyboard shortcuts",
    });
    await expect(shortcutDialogs).toHaveCount(1);
    await expect(shortcutDialogs).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(shortcutDialogs).toHaveCount(0);
    await expect(drawer).toBeVisible();
    await expect(themeTrigger).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(drawerTrigger).toBeFocused();
    await expectNoHorizontalOverflow(page);
    await assertNoPageErrors();
  });
});
