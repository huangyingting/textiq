/**
 * Direct contract coverage for the settings account page composition
 * (issue #1928).
 *
 * `renderSettingsAccountView` is the pure view-model -> markup decision
 * extracted from the async `SettingsPage` default export so the
 * email-verification badge/form gating, the connected-accounts
 * availability filter, and the password/profile/danger-zone form wiring
 * are unit-testable without exercising `requireUser`/
 * `loadSettingsAccountViewModel`, which require a live session and
 * database.
 *
 * `page.tsx` imports `@/lib/settings/loader`, which carries `import
 * "server-only"` and throws outside a Next.js Server Component build.
 * Following the module-hooks pattern already used by
 * `src/lib/document-editor/loader.test.ts` and
 * `src/lib/workspace/service.test.ts`, this stubs the `server-only`
 * specifier to an empty module before dynamically importing `./page`.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { SettingsAccountViewModel } from "@/lib/settings/view-model";

import { DeleteAccountForm } from "./delete-account-form";
import { EmailVerificationForm } from "./email-verification-form";
import { PasswordForm } from "./password-form";
import { ProfileForm } from "./profile-form";

type ModuleHooks = {
  registerHooks(hooks: {
    resolve(
      specifier: string,
      context: unknown,
      nextResolve: (specifier: string, context: unknown) => unknown,
    ): unknown;
    load(
      url: string,
      context: unknown,
      nextLoad: (url: string, context: unknown) => unknown,
    ): unknown;
  }): void;
};

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;
const serverOnlyStubUrl = "server-only:settings-page-test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: serverOnlyStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === serverOnlyStubUrl) {
      return { format: "commonjs", source: "", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

type PageModule = typeof import("./page");
let renderSettingsAccountView: PageModule["renderSettingsAccountView"];

before(async () => {
  const mod = await import("./page");
  renderSettingsAccountView = mod.renderSettingsAccountView;
});

type ElementLike = ReactElement<Record<string, unknown>>;

/**
 * Collects every element in the tree, expanding host (string-type) elements'
 * children so headings/badges/links are visible to assertions. Function
 * components are recorded as leaves — NOT invoked — because
 * ProfileForm/PasswordForm/EmailVerificationForm/DeleteAccountForm each call
 * `useActionState`/`useState`, which would throw "Invalid hook call" if
 * called directly outside of a real React render pass.
 */
function collectElements(node: ReactNode, collected: ElementLike[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  collected.push(element);
  if (typeof element.type === "function") {
    return collected;
  }
  const props = element.props as { children?: ReactNode };
  collectElements(props.children, collected);
  return collected;
}

function firstElement(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
): ElementLike {
  const element = collectElements(node).find(predicate);
  assert.ok(element, "expected a matching element");
  return element;
}

function buildViewModel(
  overrides: Partial<SettingsAccountViewModel> = {},
): SettingsAccountViewModel {
  return {
    profile: { initialName: "Ada", email: "ada@example.com" },
    emailVerification: {
      isVerified: false,
      badgeLabel: "Unverified",
      message: "Confirm ada@example.com to secure your account.",
    },
    password: {
      hasPassword: true,
      heading: "Change password",
      description: "Update the password you use to sign in.",
    },
    connectedAccounts: [
      {
        provider: "password",
        label: "Email & password",
        connected: true,
        available: true,
      },
      {
        provider: "google",
        label: "Google",
        connected: false,
        available: true,
      },
    ],
    links: {
      accountExport: "/api/account/export",
      billing: "/app/settings/billing",
      documents: "/app",
    },
    ...overrides,
  };
}

describe("renderSettingsAccountView", () => {
  test("wires ProfileForm with the view model's initialName and email", () => {
    const tree = renderSettingsAccountView(buildViewModel());
    const profile = firstElement(
      tree,
      (element) => element.type === ProfileForm,
    );
    assert.equal(profile.props.initialName, "Ada");
    assert.equal(profile.props.email, "ada@example.com");
  });

  test("wires PasswordForm with the view model's hasPassword flag and heading/description", () => {
    const tree = renderSettingsAccountView(
      buildViewModel({
        password: {
          hasPassword: false,
          heading: "Set a password",
          description: "Add a password so you can sign in with your email too.",
        },
      }),
    );
    const password = firstElement(
      tree,
      (element) => element.type === PasswordForm,
    );
    assert.equal(password.props.hasPassword, false);
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Set a password/);
    assert.match(
      html,
      /Add a password so you can sign in with your email too\./,
    );
  });

  test("wires DeleteAccountForm with the profile email", () => {
    const tree = renderSettingsAccountView(buildViewModel());
    const danger = firstElement(
      tree,
      (element) => element.type === DeleteAccountForm,
    );
    assert.equal(danger.props.email, "ada@example.com");
  });

  test("unverified: shows the unverified badge and renders EmailVerificationForm", () => {
    const tree = renderSettingsAccountView(
      buildViewModel({
        emailVerification: {
          isVerified: false,
          badgeLabel: "Unverified",
          message: "Confirm ada@example.com to secure your account.",
        },
      }),
    );
    firstElement(tree, (element) => element.type === EmailVerificationForm);
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Unverified/);
    assert.match(html, /Confirm ada@example\.com to secure your account\./);
  });

  test("verified: shows the verified badge and omits EmailVerificationForm", () => {
    const tree = renderSettingsAccountView(
      buildViewModel({
        emailVerification: {
          isVerified: true,
          badgeLabel: "Verified",
          message: "Your email ada@example.com is verified.",
        },
      }),
    );
    const forms = collectElements(tree).filter(
      (element) => element.type === EmailVerificationForm,
    );
    assert.equal(forms.length, 0);
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Verified/);
  });

  test("connected accounts: filters out unavailable providers and labels connection state", () => {
    const tree = renderSettingsAccountView(
      buildViewModel({
        connectedAccounts: [
          {
            provider: "password",
            label: "Email & password",
            connected: true,
            available: true,
          },
          {
            provider: "google",
            label: "Google",
            connected: false,
            available: false,
          },
        ],
      }),
    );
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Email &amp; password/);
    assert.doesNotMatch(html, />Google</);
  });

  test("connected accounts: shows 'Connected'/'Not connected' per the connected flag", () => {
    const tree = renderSettingsAccountView(
      buildViewModel({
        connectedAccounts: [
          {
            provider: "password",
            label: "Email & password",
            connected: true,
            available: true,
          },
          {
            provider: "google",
            label: "Google",
            connected: false,
            available: true,
          },
        ],
      }),
    );
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Connected/);
    assert.match(html, /Not connected/);
  });

  test("wires the data-export/billing/documents links from the view model", () => {
    const tree = renderSettingsAccountView(buildViewModel());
    const exportLink = firstElement(
      tree,
      (element) =>
        element.type === "a" && element.props.href === "/api/account/export",
    );
    assert.equal(exportLink.props.download, true);
    // `next/link`'s <Link> elements are function components (not "a" host
    // elements) until React actually renders them, so the billing/documents
    // hrefs are asserted against the fully rendered HTML instead.
    const html = renderToStaticMarkup(tree);
    assert.match(html, /href="\/app\/settings\/billing"/);
    assert.match(html, /href="\/app"/);
  });
});
