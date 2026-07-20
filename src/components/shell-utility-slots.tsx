import Link from "next/link";

import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { Tooltip } from "@/components/ui";
import {
  UserMenu,
  UserMenuItemIcon,
  USER_MENU_ITEM_CLASS,
} from "@/components/user-menu";
import type {
  ShellDisplayIdentity,
  ShellPlanCreditSummary,
} from "@/lib/app-shell/view-model";

export function ShellLanguageSwitcherSlot({ enabled }: { enabled: boolean }) {
  return enabled ? <LanguageSwitcher /> : null;
}

export function ShellKeyboardShortcutsSlot({ enabled }: { enabled: boolean }) {
  return enabled ? <KeyboardShortcuts /> : null;
}

export function ShellCreditsSlot({
  enabled,
  summary,
  variant,
}: {
  enabled: boolean;
  summary: ShellPlanCreditSummary | null;
  variant: "desktop" | "mobileDrawer";
}) {
  if (!enabled || !summary) {
    return null;
  }

  const className =
    variant === "desktop"
      ? "flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-ds-text-secondary transition hover:bg-ds-surface-sunken hover:text-ds-text-primary"
      : "flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-ds-text-secondary transition hover:bg-ds-surface-sunken hover:text-ds-text-primary";

  const link = (
    <Link href={summary.href} aria-label={summary.title} className={className}>
      <span className="tabular-nums">{summary.countLabel}</span>
      <span className="text-ds-text-muted">credits</span>
    </Link>
  );

  return variant === "desktop" ? (
    <Tooltip label={summary.title} side="bottom">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

export function ShellUserMenuSlot({
  enabled,
  identity,
}: {
  enabled: boolean;
  identity: ShellDisplayIdentity | null;
}) {
  if (!enabled || !identity) {
    return null;
  }

  return (
    <UserMenu name={identity.name} email={identity.email}>
      <Link
        href="/app/settings/billing"
        role="menuitem"
        className={USER_MENU_ITEM_CLASS}
      >
        <UserMenuItemIcon type="billing" />
        Billing &amp; Plan
      </Link>
      <SignOutButton
        role="menuitem"
        className={USER_MENU_ITEM_CLASS}
        leadingIcon={<UserMenuItemIcon type="sign-out" />}
      />
    </UserMenu>
  );
}
