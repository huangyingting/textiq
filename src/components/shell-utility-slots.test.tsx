/**
 * Direct contract coverage for `ShellLanguageSwitcherSlot`/
 * `ShellKeyboardShortcutsSlot`/`ShellCreditsSlot`/`ShellUserMenuSlot`
 * (`src/components/shell-utility-slots.tsx`, #1965) — the enable/disable
 * gates `SiteHeaderView` composes into its desktop/mobile-drawer utility
 * rail.
 *
 * Nothing imports this file in any test today. `KeyboardShortcuts`
 * (already fully covered by `keyboard-shortcuts.test.tsx`) and
 * `LanguageSwitcher` (already fully covered by `language-switcher.test.tsx`)
 * are stubbed via `@/test/module-stub` so this file only asserts *whether*
 * `shell-utility-slots.tsx` renders them (its own `enabled` gate), not their
 * internals. `Tooltip` and `UserMenu` are used for real: `Tooltip` portals
 * to `document.body` (via `createPortal`), so this uses
 * `withPortalDom`/`mountWithPortalDom` (`@/test/portal-dom`) rather than a
 * plain mount; `UserMenu` has no portal of its own and is inert while
 * closed, so it renders safely under the same harness. `SignOutButton` is
 * stubbed because its production import chain (`@/auth`) pulls in
 * next-auth/Prisma wiring irrelevant to this file's own prop-forwarding
 * contract.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createElement } from "react";
import { act } from "react-test-renderer";

// Imported *before* `next/link` below: it polyfills a no-op
// `IntersectionObserver` before `next/link`'s `use-intersection` module
// evaluates its `hasIntersectionObserver` constant (computed once, at that
// module's first import), which otherwise falls back to a
// `requestIdleCallback` shim referencing the browser-only `self` global.
import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import Link from "next/link";

import { stubModule } from "@/test/module-stub";
import type {
  ShellDisplayIdentity,
  ShellPlanCreditSummary,
} from "@/lib/app-shell/view-model";

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
  SignOutButton: (props) =>
    createElement(
      "button",
      {
        "data-stub": "sign-out-button",
        role: props.role,
        className: props.className,
      },
      props.leadingIcon ?? null,
      "Sign out",
    ),
};`,
);

let ShellLanguageSwitcherSlot: typeof import("./shell-utility-slots").ShellLanguageSwitcherSlot;
let ShellKeyboardShortcutsSlot: typeof import("./shell-utility-slots").ShellKeyboardShortcutsSlot;
let ShellCreditsSlot: typeof import("./shell-utility-slots").ShellCreditsSlot;
let ShellUserMenuSlot: typeof import("./shell-utility-slots").ShellUserMenuSlot;
let UserMenu: typeof import("@/components/user-menu").UserMenu;
let Tooltip: typeof import("@/components/ui").Tooltip;

before(async () => {
  ({
    ShellLanguageSwitcherSlot,
    ShellKeyboardShortcutsSlot,
    ShellCreditsSlot,
    ShellUserMenuSlot,
  } = await import("./shell-utility-slots"));
  ({ UserMenu } = await import("@/components/user-menu"));
  ({ Tooltip } = await import("@/components/ui"));
});

const SUMMARY: ShellPlanCreditSummary = {
  plan: "plus",
  planLabel: "Plus",
  balance: 240,
  creditsPerPeriod: 500,
  unlimited: false,
  countLabel: "240",
  title: "240 credits remaining",
  href: "/app/settings/billing",
};

const IDENTITY: ShellDisplayIdentity = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  displayName: "Ada Lovelace",
  avatarInitial: "A",
};

test("ShellLanguageSwitcherSlot renders LanguageSwitcher when enabled, and nothing when disabled", () => {
  withPortalDom(() => {
    const shown = mountWithPortalDom(
      createElement(ShellLanguageSwitcherSlot, { enabled: true }),
    );
    assert.equal(
      shown.root.findAllByProps({ "data-stub": "language-switcher" }).length,
      1,
    );

    const hidden = mountWithPortalDom(
      createElement(ShellLanguageSwitcherSlot, { enabled: false }),
    );
    assert.equal(hidden.toJSON(), null);
  });
});

test("ShellKeyboardShortcutsSlot renders KeyboardShortcuts when enabled, and nothing when disabled", () => {
  withPortalDom(() => {
    const shown = mountWithPortalDom(
      createElement(ShellKeyboardShortcutsSlot, { enabled: true }),
    );
    assert.equal(
      shown.root.findAllByProps({ "data-stub": "keyboard-shortcuts" }).length,
      1,
    );
    assert.equal(
      shown.root.findByProps({ "data-stub": "keyboard-shortcuts" }).props[
        "data-listens-global"
      ],
      "true",
    );

    const triggerOnly = mountWithPortalDom(
      createElement(ShellKeyboardShortcutsSlot, {
        enabled: true,
        listenForGlobalShortcut: false,
      }),
    );
    assert.equal(
      triggerOnly.root.findByProps({ "data-stub": "keyboard-shortcuts" }).props[
        "data-listens-global"
      ],
      "false",
    );

    const hidden = mountWithPortalDom(
      createElement(ShellKeyboardShortcutsSlot, { enabled: false }),
    );
    assert.equal(hidden.toJSON(), null);
  });
});

test("ShellCreditsSlot renders nothing when disabled, even with a summary present", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(
      createElement(ShellCreditsSlot, {
        enabled: false,
        summary: SUMMARY,
        variant: "desktop",
      }),
    );
    assert.equal(renderer.toJSON(), null);
  });
});

test("ShellCreditsSlot renders nothing when enabled but summary is null", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(
      createElement(ShellCreditsSlot, {
        enabled: true,
        summary: null,
        variant: "desktop",
      }),
    );
    assert.equal(renderer.toJSON(), null);
  });
});

test("ShellCreditsSlot desktop variant wraps the credits Link in a Tooltip labeled with the summary title", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(
      createElement(ShellCreditsSlot, {
        enabled: true,
        summary: SUMMARY,
        variant: "desktop",
      }),
    );
    const tooltip = renderer.root.findByType(Tooltip);
    assert.equal(tooltip.props.label, "240 credits remaining");
    assert.equal(tooltip.props.side, "bottom");

    const link = renderer.root.findByType(Link);
    assert.equal(link.props.href, "/app/settings/billing");
    assert.equal(link.props["aria-label"], "240 credits remaining");
    assert.match(link.props.className as string, /h-9/);
  });
});

test("ShellCreditsSlot mobileDrawer variant renders the credits Link directly, without a Tooltip wrapper", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(
      createElement(ShellCreditsSlot, {
        enabled: true,
        summary: SUMMARY,
        variant: "mobileDrawer",
      }),
    );
    assert.equal(renderer.root.findAllByType(Tooltip).length, 0);
    const link = renderer.root.findByType(Link);
    assert.match(link.props.className as string, /h-10/);
  });
});

test("ShellUserMenuSlot renders nothing when disabled or when identity is null", () => {
  withPortalDom(() => {
    const disabled = mountWithPortalDom(
      createElement(ShellUserMenuSlot, { enabled: false, identity: IDENTITY }),
    );
    assert.equal(disabled.toJSON(), null);

    const noIdentity = mountWithPortalDom(
      createElement(ShellUserMenuSlot, { enabled: true, identity: null }),
    );
    assert.equal(noIdentity.toJSON(), null);
  });
});

test("ShellUserMenuSlot renders a real UserMenu with the identity's name/email, a Billing link, and the stubbed SignOutButton", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(
      createElement(ShellUserMenuSlot, { enabled: true, identity: IDENTITY }),
    );
    const userMenu = renderer.root.findByType(UserMenu);
    assert.equal(userMenu.props.name, "Ada Lovelace");
    assert.equal(userMenu.props.email, "ada@example.com");

    // UserMenu's dropdown (Billing link + children) only renders while
    // `open`; open it via its real toggle button before inspecting the
    // menu's content, exercising the actual UserMenu/ShellUserMenuSlot
    // composition end-to-end rather than reaching into closed-menu markup.
    const toggle = renderer.root.findByProps({ "aria-label": "User menu" });
    act(() => {
      (toggle.props.onClick as () => void)();
    });

    const billingLink = renderer.root
      .findAllByProps({ role: "menuitem" })
      .find((node) => node.props.href === "/app/settings/billing");
    assert.ok(billingLink, "expected a Billing & Plan menuitem link");
    assert.equal(billingLink?.props.href, "/app/settings/billing");

    const signOutStub = renderer.root.findByProps({
      "data-stub": "sign-out-button",
    });
    assert.equal(signOutStub.props.role, "menuitem");
  });
});

test("ShellUserMenuSlot forwards the identity's raw (untrimmed) name to UserMenu, leaving trimming to UserMenu itself", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(
      createElement(ShellUserMenuSlot, {
        enabled: true,
        identity: { ...IDENTITY, name: "  " },
      }),
    );
    const userMenu = renderer.root.findByType(UserMenu);
    assert.equal(userMenu.props.name, "  ");
    // UserMenu itself (real, unstubbed) trims blank names and falls back to
    // email for the visible label — confirms the slot forwards the raw name
    // as-is rather than pre-trimming it.
    const visibleName = renderer.root.findByProps({
      className: "hidden truncate sm:inline",
    });
    assert.equal(visibleName.children[0], "ada@example.com");
  });
});
