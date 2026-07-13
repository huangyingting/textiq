/**
 * Direct render coverage for the forgot-password page's auth-redirect guard
 * (`page.tsx`) (#1948).
 *
 * Module-hook strategy (matching `src/app/app/settings/page.test.tsx` and
 * `src/app/app/trash/actions.test.ts`): `@/lib/session` and `next/navigation`
 * are stubbed so the guard's `getCurrentUser()` outcome is controllable and
 * `redirect()` is observable instead of throwing Next's internal
 * `NEXT_REDIRECT` control-flow signal. `./forgot-password-form` is imported
 * for real (a plain client component, already covered on its own by
 * `forgot-password-form.test.tsx`) purely so the rendered tree's composition
 * can be asserted by identity.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, it } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ForgotPasswordForm } from "./forgot-password-form";

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

type ForgotPasswordPageTestState = {
  calls: unknown[];
  currentUser: { id: string } | null;
  redirect: (url: string) => never;
};

const globalForPage = globalThis as typeof globalThis & {
  __forgotPasswordPageTestState: ForgotPasswordPageTestState;
};

function createDefaultState(): ForgotPasswordPageTestState {
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

globalForPage.__forgotPasswordPageTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-forgot-password-page-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/lib/session",
    `
      export async function getCurrentUser() {
        globalThis.__forgotPasswordPageTestState.calls.push(["getCurrentUser"]);
        return globalThis.__forgotPasswordPageTestState.currentUser;
      }
    `,
  ],
  [
    "next/navigation",
    `
      export function redirect(url) {
        return globalThis.__forgotPasswordPageTestState.redirect(url);
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

let ForgotPasswordPage: PageModule["default"];
let metadata: PageModule["metadata"];

before(async () => {
  const mod = await import("./page");
  ForgotPasswordPage = mod.default;
  metadata = mod.metadata;
});

beforeEach(() => {
  globalForPage.__forgotPasswordPageTestState = createDefaultState();
});

function state(): ForgotPasswordPageTestState {
  return globalForPage.__forgotPasswordPageTestState;
}

type ElementLike = ReactElement<Record<string, unknown>>;

function flatten(node: ReactNode): ElementLike[] {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (!isValidElement(node)) return [];
  const element = node as ElementLike;
  const props = element.props as { children?: ReactNode };
  return [element, ...flatten(props.children)];
}

describe("ForgotPasswordPage", () => {
  it("exposes the reset-password page title", () => {
    assert.equal(metadata.title, "Reset your password — TextIQ");
  });

  it("redirects an already-authenticated user to /app without rendering the form", async () => {
    state().currentUser = { id: "user-1" };

    await assert.rejects(() => ForgotPasswordPage(), /NEXT_REDIRECT:\/app/);

    assert.deepEqual(state().calls, [["getCurrentUser"], ["redirect", "/app"]]);
  });

  it("renders the ForgotPasswordForm for an unauthenticated visitor", async () => {
    state().currentUser = null;

    const tree = (await ForgotPasswordPage()) as ElementLike;

    const form = flatten(tree).find(
      (element) => element.type === ForgotPasswordForm,
    );
    assert.ok(form, "expected ForgotPasswordForm to be rendered");
    assert.deepEqual(state().calls, [["getCurrentUser"]]);
  });

  it("renders the heading/instructions copy for an unauthenticated visitor", async () => {
    state().currentUser = null;

    const tree = await ForgotPasswordPage();
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Forgot your password\?/);
    assert.match(
      html,
      /Enter your email and we&#x27;ll send you a link to set a new one\./,
    );
  });
});
