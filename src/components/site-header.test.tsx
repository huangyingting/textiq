/**
 * Direct coverage for `src/components/site-header.tsx` (#1948).
 *
 * `SiteHeader` is a two-line async Server Component whose only job is to
 * fetch the shell view model and hand it to `SiteHeaderView`. Its direct
 * dependency `@/lib/app-shell/loader` imports `"server-only"` (and, through
 * it, Prisma/session/i18n chains), so — following the pattern in
 * `src/app/app/settings/page.test.tsx` — this stubs only that loader module
 * via Node's module hooks and imports the *real* `SiteHeaderView` so the
 * rendered element's `type` can be compared by reference. No UI is rendered:
 * this test only asserts the loader/view wiring contract, not `SiteHeaderView`'s
 * internal markup (already outside this file's scope).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, it } from "node:test";

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

declare global {
  var __siteHeaderTestState:
    | {
        loadAppShellViewModelCalls: unknown[][];
        viewModel: Record<string, unknown>;
      }
    | undefined;
}

globalThis.__siteHeaderTestState = {
  loadAppShellViewModelCalls: [],
  viewModel: {},
};

const stubPrefix = "textiq-site-header-test:";
const stubbedModules = new Map<string, string>([
  [
    "@/lib/app-shell/loader",
    `
      export async function loadAppShellViewModel(...args) {
        globalThis.__siteHeaderTestState.loadAppShellViewModelCalls.push(args);
        return globalThis.__siteHeaderTestState.viewModel;
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

describe("SiteHeader", () => {
  let SiteHeader: typeof import("./site-header").SiteHeader;
  let SiteHeaderView: typeof import("./site-header-view").SiteHeaderView;

  before(async () => {
    ({ SiteHeader } = await import("./site-header"));
    ({ SiteHeaderView } = await import("./site-header-view"));
  });

  after(() => {
    delete globalThis.__siteHeaderTestState;
  });

  beforeEach(() => {
    const state = globalThis.__siteHeaderTestState;
    if (!state) throw new Error("test state missing");
    state.loadAppShellViewModelCalls = [];
    state.viewModel = {
      brandLabel: "TextIQ",
      auth: { isAuthenticated: true },
      displayIdentity: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        displayName: "Ada Lovelace",
        avatarInitial: "A",
      },
      planCreditSummary: null,
      navItems: [],
      enabledUtilities: {
        languageSwitcher: false,
        keyboardShortcuts: false,
        credits: false,
        userMenu: true,
      },
    };
  });

  it("loads the app-shell view model exactly once, with no arguments", async () => {
    await SiteHeader();
    const state = globalThis.__siteHeaderTestState;
    assert.equal(state?.loadAppShellViewModelCalls.length, 1);
    assert.deepEqual(state?.loadAppShellViewModelCalls[0], []);
  });

  it("renders a SiteHeaderView element (identity match with the real component)", async () => {
    const element = await SiteHeader();
    assert.equal(element.type, SiteHeaderView);
  });

  it("passes the loader's view model through to SiteHeaderView unchanged (same reference)", async () => {
    const state = globalThis.__siteHeaderTestState;
    const element = await SiteHeader();
    assert.equal(
      element.props.viewModel,
      state?.viewModel,
      "expected the exact object returned by loadAppShellViewModel to be forwarded",
    );
  });

  it("re-fetches the view model on every SiteHeader() call (no caching across renders)", async () => {
    await SiteHeader();
    await SiteHeader();
    const state = globalThis.__siteHeaderTestState;
    assert.equal(state?.loadAppShellViewModelCalls.length, 2);
  });
});
