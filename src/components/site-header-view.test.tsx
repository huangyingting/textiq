/**
 * Direct contract coverage for `SiteHeaderView`
 * (`src/components/site-header-view.tsx`, #1965) — the pure view-model→JSX
 * composition that decides which nav/utility elements appear across the
 * desktop nav, the mobile top bar, and the mobile drawer, for both the
 * authenticated and guest branches.
 *
 * `site-header.test.tsx` already covers `SiteHeader`'s own
 * loader→`SiteHeaderView` wiring (identity match only — it explicitly
 * defers `SiteHeaderView`'s internal markup to "outside this file's
 * scope"), so this is `SiteHeaderView`'s first direct behavioral coverage.
 *
 * This mounts the *real* `ShellNavLinks` and `shell-utility-slots.tsx`
 * exports (`ShellCreditsSlot`/`ShellKeyboardShortcutsSlot`/
 * `ShellLanguageSwitcherSlot`/`ShellUserMenuSlot`) so the actual
 * composition/gating logic in both this file *and* its immediate
 * `shell-*` dependents (also targets of #1965) is exercised together. The
 * remaining children are leaf, stateful UI already covered by their own
 * dedicated test files and unrelated to this file's own composition
 * contract, so they're stubbed via `@/test/module-stub`:
 * `KeyboardShortcuts`, `LanguageSwitcher`, `ThemeModeButton`,
 * `MobileNavMenu`/`MobileNavNonClosing` (rendered as passthrough wrappers so
 * their children are still inspectable), and `SignOutButton` (whose
 * production import chain pulls in `@/auth`/next-auth, irrelevant here).
 *
 * `ShellCreditsSlot`'s desktop variant renders a real `Tooltip`
 * (`createPortal`-based), so this uses `withPortalDom`/`mountWithPortalDom`
 * (`@/test/portal-dom`) throughout rather than a plain mount.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createElement } from "react";

// Imported *before* `next/link`-dependent modules below: it polyfills a
// no-op `IntersectionObserver` before `next/link`'s `use-intersection`
// module evaluates its `hasIntersectionObserver` constant (computed once,
// at first import), which otherwise falls back to a `requestIdleCallback`
// shim referencing the browser-only `self` global.
import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import Link from "next/link";

import { stubModule } from "@/test/module-stub";
import type { AppShellViewModel } from "@/lib/app-shell/view-model";

stubModule(
  "@/components/keyboard-shortcuts",
  `const { createElement } = require("react");
module.exports = {
  KeyboardShortcuts: (props) =>
    createElement("span", {
      "data-stub": "keyboard-shortcuts",
      "data-listens-global": String(props.listenForGlobalShortcut),
    }),
};`,
);

stubModule(
  "@/components/language-switcher",
  `const { createElement } = require("react");
module.exports = {
  LanguageSwitcher: () =>
    createElement("span", { "data-stub": "language-switcher" }),
};`,
);

stubModule(
  "@/components/sign-out-button",
  `const { createElement } = require("react");
module.exports = {
  SignOutButton: () =>
    createElement("button", { "data-stub": "sign-out-button" }, "Sign out"),
};`,
);

stubModule(
  "@/components/theme-mode-button",
  `const { createElement } = require("react");
module.exports = {
  ThemeModeButton: (props) =>
    createElement("button", {
      "data-stub": "theme-mode-button",
      "data-variant": props.variant,
    }),
};`,
);

stubModule(
  "@/components/mobile-nav-menu",
  `const { createElement } = require("react");
module.exports = {
  MobileNavMenu: (props) =>
    createElement(
      "div",
      { "data-stub": "mobile-nav-menu" },
      props.children,
    ),
  MobileNavNonClosing: (props) =>
    createElement(
      "div",
      { "data-stub": "mobile-nav-non-closing", className: props.className },
      props.children,
    ),
};`,
);

let SiteHeaderView: typeof import("./site-header-view").SiteHeaderView;

before(async () => {
  ({ SiteHeaderView } = await import("./site-header-view"));
});

function baseViewModel(
  overrides: Partial<AppShellViewModel> = {},
): AppShellViewModel {
  return {
    brandLabel: "TextIQ",
    auth: { isAuthenticated: true },
    displayIdentity: {
      name: "Ada Lovelace",
      email: "ada@example.com",
      displayName: "Ada Lovelace",
      avatarInitial: "A",
    },
    planCreditSummary: {
      plan: "plus",
      planLabel: "Plus",
      balance: 240,
      creditsPerPeriod: 500,
      unlimited: false,
      countLabel: "240",
      title: "240 credits remaining",
      href: "/app/settings/billing",
    },
    navItems: [
      {
        id: "documents",
        href: "/app",
        label: "Documents",
        emphasis: "default",
      },
      {
        id: "workspaces",
        href: "/app/workspaces",
        label: "Workspaces",
        emphasis: "default",
      },
    ],
    enabledUtilities: {
      languageSwitcher: true,
      keyboardShortcuts: true,
      credits: true,
      userMenu: true,
    },
    ...overrides,
  };
}

const GUEST_VIEW_MODEL = baseViewModel({
  auth: { isAuthenticated: false },
  displayIdentity: null,
  planCreditSummary: null,
  navItems: [
    { id: "login", href: "/login", label: "Log in", emphasis: "default" },
    { id: "signup", href: "/signup", label: "Sign up", emphasis: "primary" },
  ],
  enabledUtilities: {
    languageSwitcher: true,
    keyboardShortcuts: false,
    credits: false,
    userMenu: false,
  },
});

test("brandLabel renders as a Link to '/' regardless of auth state", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(
      createElement(SiteHeaderView, { viewModel: baseViewModel() }),
    );
    const brand = renderer.root
      .findAllByType(Link)
      .find((link) => link.props.href === "/");
    assert.ok(brand, "expected the brand Link");
    assert.equal(brand?.props.children, "TextIQ");
  });
});

test("authenticated: desktop nav renders nav links, credits, keyboard shortcuts, theme, language, and user-menu slots, in that order", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(
      createElement(SiteHeaderView, { viewModel: baseViewModel() }),
    );
    const nav = renderer.root.find(
      (node) =>
        typeof node.type === "string" &&
        node.type === "nav" &&
        (node.props.className as string).includes("hidden"),
    );
    const stubs = nav.findAll(
      (node) =>
        typeof node.props["data-stub"] === "string" || node.type === Link,
    );
    // documents/workspaces nav links (2) + credits Link (1) + keyboard
    // shortcuts stub + theme stub + language stub = 6, followed by the
    // user menu (real UserMenu, not a data-stub marker, asserted below).
    const kinds = stubs.map((node) =>
      node.type === Link ? "link" : (node.props["data-stub"] as string),
    );
    assert.deepEqual(kinds, [
      "link",
      "link",
      "link",
      "keyboard-shortcuts",
      "theme-mode-button",
      "language-switcher",
    ]);
    assert.equal(
      nav.findByProps({ "data-stub": "keyboard-shortcuts" }).props[
        "data-listens-global"
      ],
      "true",
    );
    // The user menu toggle (real UserMenu) follows the language slot.
    const userMenuToggle = nav.findByProps({ "aria-label": "User menu" });
    assert.ok(userMenuToggle);
  });
});

test("authenticated: mobile top bar shows the user menu first, then a MobileNavMenu drawer wrapping nav links, credits, a divider, theme, language, and shortcuts", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(
      createElement(SiteHeaderView, { viewModel: baseViewModel() }),
    );
    const mobileBar = renderer.root.find(
      (node) =>
        (typeof node.type === "string" &&
          (node.props.className as string | undefined)?.includes(
            "md:hidden",
          )) ??
        false,
    );
    assert.ok(mobileBar.findByProps({ "aria-label": "User menu" }));

    const drawer = mobileBar.findByProps({ "data-stub": "mobile-nav-menu" });
    const navLinksInDrawer = drawer.findAllByType(Link);
    // documents/workspaces nav links (2) + the credits Link (1).
    assert.equal(navLinksInDrawer.length, 3);

    const nonClosing = drawer.findByProps({
      "data-stub": "mobile-nav-non-closing",
    });
    const nonClosingStubs = nonClosing.findAll(
      (node) =>
        node !== nonClosing && typeof node.props["data-stub"] === "string",
    );
    assert.deepEqual(
      nonClosingStubs.map((node) => node.props["data-stub"]),
      ["theme-mode-button", "language-switcher", "keyboard-shortcuts"],
    );
    assert.equal(
      nonClosing.findByProps({ "data-stub": "keyboard-shortcuts" }).props[
        "data-listens-global"
      ],
      "false",
    );
  });
});

test("guest: desktop nav shows theme + language before the nav links, with no credits/shortcuts/user-menu slots", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(
      createElement(SiteHeaderView, { viewModel: GUEST_VIEW_MODEL }),
    );
    const nav = renderer.root.find(
      (node) =>
        typeof node.type === "string" &&
        node.type === "nav" &&
        (node.props.className as string).includes("hidden"),
    );
    const stubs = nav.findAll(
      (node) =>
        typeof node.props["data-stub"] === "string" || node.type === Link,
    );
    const kinds = stubs.map((node) =>
      node.type === Link ? "link" : (node.props["data-stub"] as string),
    );
    assert.deepEqual(kinds, [
      "theme-mode-button",
      "language-switcher",
      "link",
      "link",
    ]);
    assert.throws(() => nav.findByProps({ "aria-label": "User menu" }));
  });
});

test("guest: mobile inline bar shows theme + language before the nav links, with no MobileNavMenu drawer", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(
      createElement(SiteHeaderView, { viewModel: GUEST_VIEW_MODEL }),
    );
    const mobileBar = renderer.root.find(
      (node) =>
        (typeof node.type === "string" &&
          (node.props.className as string | undefined)?.includes(
            "md:hidden",
          )) ??
        false,
    );
    assert.throws(() =>
      mobileBar.findByProps({ "data-stub": "mobile-nav-menu" }),
    );
    const themeStub = mobileBar.findByProps({
      "data-stub": "theme-mode-button",
    });
    assert.equal(themeStub.props["data-variant"], "mobileInline");
    const links = mobileBar.findAllByType(Link);
    assert.deepEqual(
      links.map((link) => link.props.href),
      ["/login", "/signup"],
    );
  });
});

test("disabling enabledUtilities flags suppresses their slots while auth stays authenticated", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(
      createElement(SiteHeaderView, {
        viewModel: baseViewModel({
          enabledUtilities: {
            languageSwitcher: false,
            keyboardShortcuts: false,
            credits: false,
            userMenu: false,
          },
        }),
      }),
    );
    const nav = renderer.root.find(
      (node) =>
        typeof node.type === "string" &&
        node.type === "nav" &&
        (node.props.className as string).includes("hidden"),
    );
    assert.equal(
      nav.findAll((node) => node.props["data-stub"] === "keyboard-shortcuts")
        .length,
      0,
    );
    assert.equal(
      nav.findAll((node) => node.props["data-stub"] === "language-switcher")
        .length,
      0,
    );
    // Only the two nav links remain as `Link`s (no credits Link).
    assert.equal(nav.findAllByType(Link).length, 2);
    assert.throws(() => nav.findByProps({ "aria-label": "User menu" }));
  });
});

test("desktop and mobile-drawer theme buttons receive their own distinct variant prop", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(
      createElement(SiteHeaderView, { viewModel: baseViewModel() }),
    );
    const themeButtons = renderer.root.findAllByProps({
      "data-stub": "theme-mode-button",
    });
    assert.deepEqual(
      themeButtons.map((node) => node.props["data-variant"]).sort(),
      ["desktop", "mobileDrawer"],
    );
  });
});
