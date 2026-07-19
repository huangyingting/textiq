import type { Messages, Translator } from "@/lib/i18n";

type StringMessageKey = {
  [K in keyof Messages]: Messages[K] extends string ? K : never;
}[keyof Messages];

export type ShellNavItemId =
  "documents" | "workspaces" | "brands" | "login" | "signup";

export type ShellNavItemEmphasis = "default" | "primary";

export interface ShellNavItem {
  id: ShellNavItemId;
  href: string;
  label: string;
  emphasis: ShellNavItemEmphasis;
}

interface ShellNavRegistryItem {
  id: ShellNavItemId;
  href: string;
  labelKey: StringMessageKey;
  audience: "authenticated" | "anonymous";
  emphasis?: ShellNavItemEmphasis;
}

export const SHELL_NAV_REGISTRY: readonly ShellNavRegistryItem[] = [
  {
    id: "documents",
    href: "/app",
    labelKey: "header.nav.documents",
    audience: "authenticated",
  },
  {
    id: "workspaces",
    href: "/app/workspaces",
    labelKey: "header.nav.workspaces",
    audience: "authenticated",
  },
  {
    id: "brands",
    href: "/app/brands",
    labelKey: "header.nav.brands",
    audience: "authenticated",
  },
  {
    id: "login",
    href: "/login",
    labelKey: "header.nav.login",
    audience: "anonymous",
  },
  {
    id: "signup",
    href: "/signup",
    labelKey: "header.nav.signup",
    audience: "anonymous",
    emphasis: "primary",
  },
];

export function resolveShellNavItems(
  isAuthenticated: boolean,
  t: Translator,
): ShellNavItem[] {
  const audience = isAuthenticated ? "authenticated" : "anonymous";
  return SHELL_NAV_REGISTRY.filter((item) => item.audience === audience).map(
    (item) => ({
      id: item.id,
      href: item.href,
      label: t(item.labelKey),
      emphasis: item.emphasis ?? "default",
    }),
  );
}
