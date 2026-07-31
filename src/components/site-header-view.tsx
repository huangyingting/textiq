import Link from "next/link";

import {
  MobileNavMenu,
  MobileNavNonClosing,
} from "@/components/mobile-nav-menu";
import { ShellNavLinks } from "@/components/shell-nav-links";
import {
  ShellCreditsSlot,
  ShellKeyboardShortcutsSlot,
  ShellLanguageSwitcherSlot,
  ShellUserMenuSlot,
} from "@/components/shell-utility-slots";
import { ThemeModeButton } from "@/components/theme-mode-button";
import type { ShellAction } from "@/lib/app-shell/chrome";
import type { AppShellViewModel } from "@/lib/app-shell/view-model";

export function SiteHeaderView({
  viewModel,
}: {
  viewModel: AppShellViewModel;
}) {
  const {
    auth,
    brandLabel,
    displayIdentity,
    enabledUtilities,
    navItems,
    planCreditSummary,
  } = viewModel;
  const languageAction: ShellAction = {
    id: "language",
    auth: "all",
    slot: (
      <ShellLanguageSwitcherSlot enabled={enabledUtilities.languageSwitcher} />
    ),
  };
  const desktopShortcutAction: ShellAction = {
    id: "keyboard-shortcuts",
    auth: "authenticated",
    closeDrawerOnClick: false,
    slot: (
      <ShellKeyboardShortcutsSlot
        enabled={enabledUtilities.keyboardShortcuts}
      />
    ),
  };
  const mobileShortcutAction: ShellAction = {
    id: "keyboard-shortcuts",
    auth: "authenticated",
    closeDrawerOnClick: false,
    slot: (
      <ShellKeyboardShortcutsSlot
        enabled={enabledUtilities.keyboardShortcuts}
        listenForGlobalShortcut={false}
      />
    ),
  };
  const userAction: ShellAction = {
    id: "user-menu",
    auth: "authenticated",
    slot: (
      <ShellUserMenuSlot
        enabled={enabledUtilities.userMenu}
        identity={displayIdentity}
      />
    ),
  };

  return (
    <header className="relative z-header flex w-full items-center justify-between overflow-x-clip border-b border-ds-border-strong bg-ds-surface-base/80 px-4 py-3 backdrop-blur sm:px-6">
      <Link
        href="/"
        className="shrink-0 text-base font-semibold tracking-tight text-ds-text-primary"
      >
        {brandLabel}
      </Link>

      <nav className="hidden items-center gap-3 md:flex">
        {auth.isAuthenticated ? (
          <>
            <ShellNavLinks items={navItems} variant="desktop" />
            <ShellCreditsSlot
              enabled={enabledUtilities.credits}
              summary={planCreditSummary}
              variant="desktop"
            />
            {desktopShortcutAction.slot}
            <ThemeModeButton variant="desktop" />
            {languageAction.slot}
            {userAction.slot}
          </>
        ) : (
          <>
            <ThemeModeButton variant="desktop" />
            {languageAction.slot}
            <ShellNavLinks items={navItems} variant="desktop" />
          </>
        )}
      </nav>

      <div className="flex items-center gap-1 md:hidden">
        {auth.isAuthenticated ? (
          <>
            {userAction.slot}

            <MobileNavMenu>
              <ShellNavLinks items={navItems} variant="mobileDrawer" />
              <ShellCreditsSlot
                enabled={enabledUtilities.credits}
                summary={planCreditSummary}
                variant="mobileDrawer"
              />

              <div className="my-2 border-t border-ds-border-strong" />

              <MobileNavNonClosing className="flex flex-col gap-0.5">
                <ThemeModeButton variant="mobileDrawer" />
                {languageAction.slot}
                {mobileShortcutAction.slot}
              </MobileNavNonClosing>
            </MobileNavMenu>
          </>
        ) : (
          <>
            <ThemeModeButton variant="mobileInline" />
            {languageAction.slot}
            <ShellNavLinks items={navItems} variant="mobileInline" />
          </>
        )}
      </div>
    </header>
  );
}
