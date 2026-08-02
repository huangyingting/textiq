/**
 * Direct render coverage for the App Router root layout (`layout.tsx`)
 * (#1948).
 *
 * `RootLayout` pulls in `next/font/google` (which only works under the Next
 * SWC compiler — the plain npm package has no callable `Inter` export, see
 * `next/font/google`'s own module), two CSS side-effect imports Node's ESM
 * loader can't parse, and request-scoped cookie reads for locale/theme (which
 * throw outside a real Next request scope). Those dependencies are stubbed
 * via the `node:module` `registerHooks` pattern
 * already used by `src/app/app/trash/actions.test.ts` and
 * `src/app/app/settings/page.test.tsx`. `@/components/site-header` is also
 * stubbed: it transitively imports `@/lib/app-shell/loader`, which carries
 * `import "server-only"` (throws immediately outside a Server Component
 * build) and its own auth/billing/DB wiring is covered directly by
 * `src/components/site-header.test.tsx`.
 *
 * Every other child (`HeaderGate`, `MobileViewportSync`, `ThemeProvider`,
 * `LocaleProvider`, `OverlayProvider`, `SiteHeader`) is imported for real —
 * `RootLayout` is invoked directly (not rendered through React) so none of
 * their hook-bearing/async bodies ever execute; only the returned,
 * un-rendered element tree is inspected, mirroring
 * `renderSettingsAccountView`'s `collectElements` traversal in
 * `settings/page.test.tsx`. `SiteHeader` itself transitively imports
 * `@/lib/app-shell/loader`, which carries `import "server-only"` (throws
 * immediately on import outside a Server Component build); `server-only` is
 * stubbed to an empty module — same fix `settings/page.test.tsx` uses —
 * purely so the real `SiteHeader` function reference can be imported and
 * compared by identity. Its own auth/billing/DB wiring is covered directly
 * by `src/components/site-header.test.tsx`.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

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

type LayoutTestState = {
  locale: string;
  fontCalls: unknown[];
  themeCookie: string | undefined;
};

const globalForLayout = globalThis as typeof globalThis & {
  __layoutTestState: LayoutTestState;
};

globalForLayout.__layoutTestState = {
  locale: "en",
  fontCalls: [],
  themeCookie: undefined,
};

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-layout-test:";
const INTER_STUB_VARIABLE = "--font-inter-stub";

const stubbedModules = new Map<string, string>([
  [
    "next/font/google",
    `
      export function Inter(options) {
        globalThis.__layoutTestState.fontCalls.push(options);
        return { variable: ${JSON.stringify(INTER_STUB_VARIABLE)} };
      }
    `,
  ],
  ["./globals.css", ""],
  ["./slide-fonts.css", ""],
  [
    "next/headers",
    `
      export async function cookies() {
        return {
          get() {
            const value = globalThis.__layoutTestState.themeCookie;
            return value === undefined ? undefined : { value };
          }
        };
      }
    `,
  ],
  [
    "@/lib/i18n/server",
    `
      export async function getLocale() {
        return globalThis.__layoutTestState.locale;
      }
    `,
  ],
  ["server-only", ""],
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

type LayoutModule = typeof import("./layout");
type SiteHeaderModule = typeof import("@/components/site-header");
type HeaderGateModule = typeof import("@/components/header-gate");
type MobileViewportSyncModule =
  typeof import("@/components/mobile-viewport-sync");
type ThemeProviderModule = typeof import("@/components/theme-provider");
type LocaleProviderModule = typeof import("@/lib/i18n/locale-context");
type UiModule = typeof import("@/components/ui");

let RootLayout: LayoutModule["default"];
let metadata: LayoutModule["metadata"];
let viewport: LayoutModule["viewport"];
let SiteHeader: SiteHeaderModule["SiteHeader"];
let HeaderGate: HeaderGateModule["HeaderGate"];
let MobileViewportSync: MobileViewportSyncModule["MobileViewportSync"];
let ThemeProvider: ThemeProviderModule["ThemeProvider"];
let LocaleProvider: LocaleProviderModule["LocaleProvider"];
let OverlayProvider: UiModule["OverlayProvider"];

before(async () => {
  const [
    layoutMod,
    siteHeaderMod,
    headerGateMod,
    mvsMod,
    themeMod,
    localeMod,
    uiMod,
  ] = await Promise.all([
    import("./layout"),
    import("@/components/site-header"),
    import("@/components/header-gate"),
    import("@/components/mobile-viewport-sync"),
    import("@/components/theme-provider"),
    import("@/lib/i18n/locale-context"),
    import("@/components/ui"),
  ]);
  RootLayout = layoutMod.default;
  metadata = layoutMod.metadata;
  viewport = layoutMod.viewport;
  SiteHeader = siteHeaderMod.SiteHeader;
  HeaderGate = headerGateMod.HeaderGate;
  MobileViewportSync = mvsMod.MobileViewportSync;
  ThemeProvider = themeMod.ThemeProvider;
  LocaleProvider = localeMod.LocaleProvider;
  OverlayProvider = uiMod.OverlayProvider;
});

type ElementLike = ReactElement<Record<string, unknown>>;

/**
 * Flattens a JSX tree by walking `.props.children` without ever invoking a
 * component function — safe for client components, async Server Components,
 * and anything using hooks, since nothing here actually renders.
 */
function flatten(node: ReactNode): ElementLike[] {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (!isValidElement(node)) return [];
  const element = node as ElementLike;
  const props = element.props as { children?: ReactNode };
  return [element, ...flatten(props.children)];
}

function childrenOf(element: ElementLike): ReactNode {
  return (element.props as { children?: ReactNode }).children;
}

describe("RootLayout", () => {
  test("exposes the marketing metadata title/description", () => {
    assert.equal(String(metadata.metadataBase), "http://localhost:4000/");
    assert.equal(metadata.title, "TextIQ — Text to Visuals");
    assert.match(
      String(metadata.description),
      /AI-generated, editable visuals/,
    );
  });

  test("exposes the mobile-safe viewport contract", () => {
    assert.deepEqual(viewport, {
      width: "device-width",
      initialScale: 1,
      viewportFit: "cover",
    });
  });

  test("threads the resolved locale into both <html lang> and LocaleProvider", async () => {
    globalForLayout.__layoutTestState.locale = "fr";
    const marker = (<div data-marker="children-marker" />) as ElementLike;
    const tree = (await RootLayout({
      children: marker,
    })) as ElementLike;

    assert.equal(tree.type, "html");
    assert.equal(tree.props.lang, "fr");

    const localeProvider = flatten(tree).find(
      (element) => element.type === LocaleProvider,
    );
    assert.ok(localeProvider, "expected a LocaleProvider element");
    assert.equal(localeProvider!.props.initialLocale, "fr");
  });

  test("renders the default theme mode on <html>", async () => {
    globalForLayout.__layoutTestState.locale = "en";
    globalForLayout.__layoutTestState.themeCookie = undefined;
    const tree = (await RootLayout({
      children: null,
    })) as ElementLike;

    assert.equal(tree.props["data-theme"], "system");
    assert.equal(tree.props.suppressHydrationWarning, true);
    assert.ok(String(tree.props.className).includes(INTER_STUB_VARIABLE));
    assert.match(String(tree.props.className), /antialiased/);
    assert.match(String(tree.props.className), /motion-reduce:scroll-auto/);
  });

  test("renders a valid persisted theme on <html> and passes it to ThemeProvider", async () => {
    globalForLayout.__layoutTestState.themeCookie = "dark";
    const tree = (await RootLayout({ children: null })) as ElementLike;

    assert.equal(tree.props["data-theme"], "dark");
    const themeProvider = flatten(tree).find(
      (element) => element.type === ThemeProvider,
    );
    assert.ok(themeProvider, "expected ThemeProvider in <body>");
    assert.equal(themeProvider!.props.initialMode, "dark");
  });

  test("calls Inter exactly once at module scope with the expected subset config", () => {
    // `const inter = Inter(...)` runs once at module evaluation (in
    // `before()`), not per-render, so this asserts against the call
    // recorded at import time rather than triggering a fresh call.
    assert.deepEqual(globalForLayout.__layoutTestState.fontCalls, [
      { variable: "--font-inter", subsets: ["latin"] },
    ]);
  });

  test("composes providers in order: ThemeProvider > LocaleProvider > OverlayProvider > HeaderGate > SiteHeader, alongside children", async () => {
    const marker = (<div data-marker="children-marker" />) as ElementLike;
    const tree = (await RootLayout({
      children: marker,
    })) as ElementLike;

    const body = flatten(tree).find((element) => element.type === "body");
    assert.ok(body, "expected a <body> element");
    const bodyChildren = flatten(childrenOf(body!));

    const mobileViewportSync = bodyChildren.find(
      (element) => element.type === MobileViewportSync,
    );
    assert.ok(mobileViewportSync, "expected MobileViewportSync in <body>");

    const themeProvider = bodyChildren.find(
      (element) => element.type === ThemeProvider,
    );
    assert.ok(themeProvider, "expected ThemeProvider in <body>");

    const localeProvider = flatten(childrenOf(themeProvider!)).find(
      (element) => element.type === LocaleProvider,
    );
    assert.ok(localeProvider, "expected LocaleProvider inside ThemeProvider");

    const overlayProvider = flatten(childrenOf(localeProvider!)).find(
      (element) => element.type === OverlayProvider,
    );
    assert.ok(
      overlayProvider,
      "expected OverlayProvider inside LocaleProvider",
    );

    const overlayChildren = flatten(childrenOf(overlayProvider!));
    const headerGate = overlayChildren.find(
      (element) => element.type === HeaderGate,
    );
    assert.ok(headerGate, "expected HeaderGate inside OverlayProvider");

    const siteHeader = flatten(childrenOf(headerGate!)).find(
      (element) => element.type === SiteHeader,
    );
    assert.ok(siteHeader, "expected SiteHeader inside HeaderGate");

    // The page `children` must be present as a sibling of HeaderGate inside
    // OverlayProvider (rendered below the header), not swallowed by it.
    assert.ok(
      overlayChildren.some(
        (element) => element.props["data-marker"] === "children-marker",
      ),
      "expected the page children to be present inside OverlayProvider",
    );
  });
});
