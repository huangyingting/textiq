/**
 * Direct render coverage for the reset-password page's auth-redirect guard
 * and token absent/present branches (`page.tsx`) (#1948).
 *
 * Module-hook strategy (matching `src/app/forgot-password/page.test.tsx`):
 * `@/lib/session` and `next/navigation` are stubbed so the guard's
 * `getCurrentUser()` outcome is controllable and `redirect()` is observable
 * instead of throwing Next's internal `NEXT_REDIRECT` control-flow signal.
 * `./reset-password-form` is imported for real (already covered on its own
 * by `reset-password-form.test.tsx`) purely so the rendered tree's
 * composition can be asserted by identity.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, it } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ResetPasswordForm } from "./reset-password-form";

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

type ResetPasswordPageTestState = {
  calls: unknown[];
  currentUser: { id: string } | null;
  redirect: (url: string) => never;
};

const globalForPage = globalThis as typeof globalThis & {
  __resetPasswordPageTestState: ResetPasswordPageTestState;
};

function createDefaultState(): ResetPasswordPageTestState {
  const calls: unknown[] = [];
  return {
    calls,
    currentUser: null,
    redirect(url: string): never {
      calls.push(["redirect", url]);
      throw new Error(`NEXT_REDIRECT:${url}`);
    },
  };
}

globalForPage.__resetPasswordPageTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-reset-password-page-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/lib/session",
    `
      export async function getCurrentUser() {
        globalThis.__resetPasswordPageTestState.calls.push(["getCurrentUser"]);
        return globalThis.__resetPasswordPageTestState.currentUser;
      }
    `,
  ],
  [
    "next/navigation",
    `
      export function redirect(url) {
        return globalThis.__resetPasswordPageTestState.redirect(url);
      }
    `,
  ],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (stubbedModules.has(specifier)) {
      return {
        url: `${stubPrefix}${encodeURIComponent(specifier)}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(stubPrefix)) {
      const specifier = decodeURIComponent(url.slice(stubPrefix.length));
      return {
        format: "module",
        source: stubbedModules.get(specifier) ?? "",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

type PageModule = typeof import("./page");
type PageProps = Parameters<PageModule["default"]>[0];

let ResetPasswordPage: PageModule["default"];
let metadata: PageModule["metadata"];

before(async () => {
  const mod = await import("./page");
  ResetPasswordPage = mod.default;
  metadata = mod.metadata;
});

beforeEach(() => {
  globalForPage.__resetPasswordPageTestState = createDefaultState();
});

function state(): ResetPasswordPageTestState {
  return globalForPage.__resetPasswordPageTestState;
}

function propsWithToken(token?: string | string[]): PageProps {
  return { searchParams: Promise.resolve({ token }) };
}

type ElementLike = ReactElement<Record<string, unknown>>;

function flatten(node: ReactNode): ElementLike[] {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (!isValidElement(node)) return [];
  const element = node as ElementLike;
  const props = element.props as { children?: ReactNode };
  return [element, ...flatten(props.children)];
}

describe("ResetPasswordPage", () => {
  it("exposes the set-a-new-password page title", () => {
    assert.equal(metadata.title, "Set a new password — TextIQ");
  });

  it("redirects an already-authenticated user to /app before reading the token", async () => {
    state().currentUser = { id: "user-1" };

    await assert.rejects(
      () => ResetPasswordPage(propsWithToken("abc")),
      /NEXT_REDIRECT:\/app/,
    );

    assert.deepEqual(state().calls, [["getCurrentUser"], ["redirect", "/app"]]);
  });

  it("renders ResetPasswordForm with the token when present", async () => {
    state().currentUser = null;

    const tree = (await ResetPasswordPage(
      propsWithToken("reset-token-123"),
    )) as ElementLike;

    const form = flatten(tree).find(
      (element) => element.type === ResetPasswordForm,
    );
    assert.ok(form, "expected ResetPasswordForm to be rendered");
    assert.equal(form!.props.token, "reset-token-123");
  });

  it("uses the first value when the token search param repeats", async () => {
    state().currentUser = null;

    const tree = (await ResetPasswordPage(
      propsWithToken(["first-token", "second-token"]),
    )) as ElementLike;

    const form = flatten(tree).find(
      (element) => element.type === ResetPasswordForm,
    );
    assert.ok(form, "expected ResetPasswordForm to be rendered");
    assert.equal(form!.props.token, "first-token");
  });

  it("shows the invalid-link fallback (not the form) when the token is absent", async () => {
    state().currentUser = null;

    const tree = (await ResetPasswordPage(
      propsWithToken(undefined),
    )) as ElementLike;

    const flattened = flatten(tree);
    const form = flattened.find(
      (element) => element.type === ResetPasswordForm,
    );
    assert.equal(form, undefined, "did not expect ResetPasswordForm");

    const html = renderToStaticMarkup(tree);
    assert.match(
      html,
      /This reset link is invalid or incomplete\. Please request a new/,
    );
    assert.match(html, /href="\/forgot-password">Request a new link</);
  });

  it("shows the invalid-link fallback when the token is an empty string", async () => {
    state().currentUser = null;

    const tree = (await ResetPasswordPage(propsWithToken(""))) as ElementLike;
    const html = renderToStaticMarkup(tree);
    assert.match(html, /This reset link is invalid or incomplete/);
  });
});
