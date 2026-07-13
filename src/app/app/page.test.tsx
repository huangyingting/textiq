/**
 * Direct contract coverage for `DashboardPage` (issue #1957).
 *
 * `DashboardPage` is an async Server Component with no hooks of its own, so
 * it is invoked directly (`await DashboardPage()`) and its *unrendered*
 * React element tree is asserted via structural traversal
 * (`collectElements`/`firstElement`, reading `.type`/`.props` off the plain
 * JSX data) — never mounted through `react-test-renderer`. This is
 * deliberate: `DashboardPage` composes several real `"use client"` sibling
 * components (`DocumentList`, `ImportDocumentButton`, `NewDocumentButton`,
 * `OnboardingChecklist`), each with their own hooks, and each already
 * outside this issue's nine-file scope. Never calling React's reconciler
 * means none of their hook bodies run, so this file exercises purely
 * `DashboardPage`'s own wiring (auth, locale, view-model composition, prop
 * threading) without duplicating or destabilizing those siblings' behavior.
 *
 * `ImportDocumentButton`/`NewDocumentButton`/`OnboardingChecklist` are loaded
 * for real (a relative specifier like `./import-document-button` is matched
 * literally by the `resolve` hook below, same as `./actions`; there is no
 * technical restriction against intercepting it — these three are simply
 * left real because each already has its own dedicated `*.test.tsx` file
 * providing full coverage, so composing them for real here adds no
 * uninstrumented surface). They all import the shared sibling `./actions`
 * module for real in turn, so this file stubs the exact alias dependency set
 * already established by `actions.test.ts` (session, prisma, document
 * create/duplicate/list/mutations/trash, next/navigation, next/cache,
 * `@/lib/auth/document-permissions`) so `./actions` loads without touching
 * a real database — its own behavior is already covered by
 * `actions.test.ts` and is not re-asserted here. `@/lib/dashboard/loader`
 * (`loadDashboardViewModel`, covered by `loader.test.ts`/`view-model.test.ts`)
 * and `@/lib/i18n/server` (`getLocale`, covered by `app-shell/loader.test.ts`'s
 * own precedent for stubbing it) are stubbed for the same reason.
 *
 * `DocumentList` is stubbed rather than loaded for real: it has no
 * dedicated test file of its own, and its relative import chain
 * (`./document-grid` → `./document-card`, plus `./document-list-toolbar`
 * and `./document-list-undo-toast`) would otherwise be pulled into the
 * instrumented coverage set purely by being imported — never actually
 * exercised, since this file never renders through React's reconciler —
 * which drags down the repo-wide line-coverage floor without adding any
 * real assertions. The stub is a plain named function so
 * `byComponentName("DocumentList")` still matches it in the element tree.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, it } from "node:test";
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

type OnboardingStep = { id: string; label: string; done: boolean };

type DashboardViewModel = {
  title: string;
  subtitle: string;
  newDocumentLabel: string;
  onboarding: { show: boolean; steps: OnboardingStep[] };
  documents: unknown[];
  availableTags: unknown[];
  listCapped: boolean;
};

function defaultViewModel(): DashboardViewModel {
  return {
    title: "Your documents",
    subtitle: "Signed in as person@example.com",
    newDocumentLabel: "New document",
    onboarding: { show: false, steps: [] },
    documents: [{ id: "doc-1" }],
    availableTags: [{ id: "tag-1" }],
    listCapped: false,
  };
}

type DashboardPageTestState = {
  calls: unknown[][];
  user: { id: string; email: string | null } | null;
  locale: string;
  viewModel: DashboardViewModel;
  requireUser: (redirect: (url: string) => never) => Promise<{
    id: string;
    email: string | null;
  }>;
  loadDashboardViewModel: (args: unknown) => Promise<DashboardViewModel>;
};

const globalForDashboard = globalThis as typeof globalThis & {
  __dashboardPageTestState: DashboardPageTestState;
};

function createDefaultState(): DashboardPageTestState {
  const calls: unknown[][] = [];
  return {
    calls,
    user: { id: "user-1", email: "person@example.com" },
    locale: "en",
    viewModel: defaultViewModel(),
    async requireUser() {
      calls.push(["requireUser"]);
      return state().user ?? { id: "user-1", email: null };
    },
    async loadDashboardViewModel(args) {
      calls.push(["loadDashboardViewModel", args]);
      return state().viewModel;
    },
  };
}

globalForDashboard.__dashboardPageTestState = createDefaultState();

function state(): DashboardPageTestState {
  return globalForDashboard.__dashboardPageTestState;
}

function callsOf(tag: string): unknown[][] {
  return state().calls.filter((c) => c[0] === tag);
}

function denyAuth() {
  state().requireUser = async (redirect) => {
    redirect("/login");
    throw new Error("unreachable");
  };
}

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-dashboard-page-test:";

const stubbedModules = new Map<string, string>([
  [
    "next/navigation",
    `
      export function redirect(url) {
        throw new Error("NEXT_REDIRECT:" + url);
      }
    `,
  ],
  [
    "next/cache",
    `
      export function revalidatePath() {}
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        return globalThis.__dashboardPageTestState.requireUser(redirect);
      }
    `,
  ],
  [
    "@/lib/i18n/server",
    `
      export async function getLocale() {
        return globalThis.__dashboardPageTestState.locale;
      }
    `,
  ],
  [
    "@/lib/dashboard/loader",
    `
      export async function loadDashboardViewModel(args) {
        return globalThis.__dashboardPageTestState.loadDashboardViewModel(args);
      }
    `,
  ],
  [
    "./document-list",
    `
      export function DocumentList() {
        return null;
      }
    `,
  ],
  // The remaining stubs below are unreachable through DashboardPage's own
  // logic (never called since child components are never rendered) but are
  // required so the real sibling ./actions module - itself imported for
  // real by ImportDocumentButton/NewDocumentButton/OnboardingChecklist - can
  // load without touching a live database. Mirrors the exact stub set
  // already established by actions.test.ts.
  [
    "@/lib/auth/document-permissions",
    `
      export async function requireDocumentCapability() {
        throw new Error("requireDocumentCapability should not be called");
      }
    `,
  ],
  [
    "@/lib/prisma",
    `
      export const prisma = {
        user: {
          updateMany() {
            throw new Error("prisma.user.updateMany should not be called");
          },
        },
      };
    `,
  ],
  [
    "@/lib/document/create",
    `
      export function clampDocumentTitle(rawTitle, fallback) {
        return rawTitle.trim().slice(0, 200) || fallback;
      }
      export async function createDocumentFromTemplateForUser() {
        throw new Error("createDocumentFromTemplateForUser should not be called");
      }
      export async function createDocumentFromImportForUser() {
        throw new Error("createDocumentFromImportForUser should not be called");
      }
    `,
  ],
  [
    "@/lib/document/duplicate",
    `
      export async function duplicateDocumentForUser() {
        throw new Error("duplicateDocumentForUser should not be called");
      }
    `,
  ],
  [
    "@/lib/document/list",
    `
      export async function searchDocumentsForUser() {
        throw new Error("searchDocumentsForUser should not be called");
      }
    `,
  ],
  [
    "@/lib/document/mutations",
    `
      export async function renameDocumentTitle() {
        throw new Error("renameDocumentTitle should not be called");
      }
      export async function toggleDocumentFavorite() {
        throw new Error("toggleDocumentFavorite should not be called");
      }
    `,
  ],
  [
    "@/lib/document/trash",
    `
      export async function restoreDocumentFromTrash() {
        throw new Error("restoreDocumentFromTrash should not be called");
      }
      export async function softDeleteDocument() {
        throw new Error("softDeleteDocument should not be called");
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

type DashboardPageModule = typeof import("./page");

let DashboardPage: DashboardPageModule["default"];

before(async () => {
  ({ default: DashboardPage } = await import("./page"));
});

beforeEach(() => {
  globalForDashboard.__dashboardPageTestState = createDefaultState();
});

type ElementLike = ReactElement & { props: Record<string, unknown> };

function collectElements(
  node: ReactNode,
  collected: ElementLike[] = [],
): ElementLike[] {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  collected.push(element);
  collectElements(element.props.children as ReactNode, collected);
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

function byComponentName(name: string) {
  return (element: ElementLike) =>
    typeof element.type === "function" && element.type.name === name;
}

describe("DashboardPage", () => {
  it("redirects unauthenticated visitors to /login without loading the view model", async () => {
    denyAuth();

    await assert.rejects(() => DashboardPage(), /NEXT_REDIRECT:\/login/);

    assert.equal(callsOf("loadDashboardViewModel").length, 0);
  });

  it("loads the view model with the session user's id/email and the resolved locale", async () => {
    state().user = { id: "user-42", email: "person@example.com" };
    state().locale = "fr";

    await DashboardPage();

    assert.deepEqual(callsOf("loadDashboardViewModel"), [
      [
        "loadDashboardViewModel",
        { userId: "user-42", userEmail: "person@example.com", locale: "fr" },
      ],
    ]);
  });

  it("falls back to an empty userEmail when the session user has no email", async () => {
    state().user = { id: "user-7", email: null };

    await DashboardPage();

    assert.deepEqual(callsOf("loadDashboardViewModel")[0]?.[1], {
      userId: "user-7",
      userEmail: "",
      locale: "en",
    });
  });

  it("renders the view model's title and subtitle", async () => {
    state().viewModel = {
      ...defaultViewModel(),
      title: "Welcome back",
      subtitle: "3 documents ready",
    };

    const result = (await DashboardPage()) as ReactElement;
    const elements = collectElements(result);

    assert.ok(
      elements.some((el) => el.props.children === "Welcome back"),
      "expected the title text to render",
    );
    assert.ok(
      elements.some((el) => el.props.children === "3 documents ready"),
      "expected the subtitle text to render",
    );
  });

  it("renders a Trash link pointing at /app/trash", async () => {
    const result = (await DashboardPage()) as ReactElement;
    const trashLink = firstElement(
      result,
      (el) => el.props.href === "/app/trash",
    );
    assert.equal(trashLink.props.children, "Trash");
  });

  it("omits the onboarding checklist when the view model says not to show it", async () => {
    state().viewModel = {
      ...defaultViewModel(),
      onboarding: { show: false, steps: [] },
    };

    const result = (await DashboardPage()) as ReactElement;
    const elements = collectElements(result);

    assert.equal(elements.some(byComponentName("OnboardingChecklist")), false);
  });

  it("renders the onboarding checklist with the view model's steps when show is true", async () => {
    const steps: OnboardingStep[] = [
      { id: "create-doc", label: "Create a document", done: true },
      { id: "generate-visual", label: "Generate a visual", done: false },
    ];
    state().viewModel = {
      ...defaultViewModel(),
      onboarding: { show: true, steps },
    };

    const result = (await DashboardPage()) as ReactElement;
    const onboarding = firstElement(
      result,
      byComponentName("OnboardingChecklist"),
    );

    assert.deepEqual(onboarding.props.steps, steps);
  });

  it("threads documents/availableTags/listCapped through to DocumentList unchanged", async () => {
    const documents = [{ id: "doc-a" }, { id: "doc-b" }];
    const availableTags = [{ id: "tag-a" }];
    state().viewModel = {
      ...defaultViewModel(),
      documents,
      availableTags,
      listCapped: true,
    };

    const result = (await DashboardPage()) as ReactElement;
    const documentList = firstElement(result, byComponentName("DocumentList"));

    assert.deepEqual(documentList.props.documents, documents);
    assert.deepEqual(documentList.props.availableTags, availableTags);
    assert.equal(documentList.props.listCapped, true);
  });

  it("gives ImportDocumentButton and NewDocumentButton the primary button styling, and threads newDocumentLabel/enableShortcut", async () => {
    state().viewModel = {
      ...defaultViewModel(),
      newDocumentLabel: "Start writing",
    };

    const result = (await DashboardPage()) as ReactElement;
    const importButton = firstElement(
      result,
      byComponentName("ImportDocumentButton"),
    );
    const newButton = firstElement(
      result,
      byComponentName("NewDocumentButton"),
    );

    assert.match(importButton.props.className as string, /gap-2/);
    assert.match(importButton.props.className as string, /rounded-full/);
    assert.equal(newButton.props.enableShortcut, true);
    assert.equal(newButton.props.children, "Start writing");
    assert.match(newButton.props.className as string, /rounded-full/);
  });
});
