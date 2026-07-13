/**
 * Direct contracts for `loadDashboardViewModel` (#1945).
 *
 * Covers the loader's wiring: that it always runs dashboard-load maintenance
 * before reading state, scopes the onboarding-flag lookup and the visual
 * count to the acting user via `accessibleDocumentWhere`, derives
 * `hasVisuals` strictly from `visualCount > 0`, defaults a missing user row's
 * `onboardingDismissed` to `false`, and hands every resolved input to the
 * real `buildDashboardViewModel` (translator + `computeOnboardingState`) so
 * the assembled view model reflects genuine onboarding-gating logic rather
 * than a mocked passthrough.
 *
 * `loader.ts` imports `server-only` (throws outside a Server Component
 * build), `@/lib/document/list` (`listDashboardDocumentsForUser`, which
 * issues its own unrelated prisma queries), and `@/lib/document/trash`
 * (`runDashboardLoadMaintenance`, which can execute raw deletes/`$executeRaw`
 * against the real DB via the maintenance purge-lock singleton). Following
 * the module-hooks pattern already used by
 * `src/lib/document-editor/loader.test.ts`, this stubs those three
 * specifiers; `prisma.user.findUnique` / `prisma.visual.count` are
 * monkey-patched directly (the two prisma calls the loader itself issues).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, it, type TestContext } from "node:test";

import { accessibleDocumentWhere } from "@/lib/access-query";
import { prisma } from "@/lib/prisma";

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

declare global {
  var __dashboardTestDocumentList: {
    documents: unknown[];
    availableTags: unknown[];
    listCapped: boolean;
    hasDocuments: boolean;
  };
  var __dashboardTestListCalls: string[];
  var __dashboardTestMaintenanceCalls: number;
}

globalThis.__dashboardTestDocumentList = {
  documents: [],
  availableTags: [],
  listCapped: false,
  hasDocuments: false,
};
globalThis.__dashboardTestListCalls = [];
globalThis.__dashboardTestMaintenanceCalls = 0;

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const SERVER_ONLY_STUB = "server-only:dashboard-loader-test";
const DOCUMENT_LIST_STUB = "lib-document-list:dashboard-loader-test";
const DOCUMENT_TRASH_STUB = "lib-document-trash:dashboard-loader-test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: SERVER_ONLY_STUB, shortCircuit: true };
    }
    if (specifier === "@/lib/document/list") {
      return { url: DOCUMENT_LIST_STUB, shortCircuit: true };
    }
    if (specifier === "@/lib/document/trash") {
      return { url: DOCUMENT_TRASH_STUB, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === SERVER_ONLY_STUB) {
      return { format: "commonjs", source: "", shortCircuit: true };
    }
    if (url === DOCUMENT_LIST_STUB) {
      return {
        format: "commonjs" as const,
        source: `module.exports = {
  listDashboardDocumentsForUser: async (userId) => {
    globalThis.__dashboardTestListCalls.push(userId);
    return globalThis.__dashboardTestDocumentList;
  },
};`,
        shortCircuit: true,
      };
    }
    if (url === DOCUMENT_TRASH_STUB) {
      return {
        format: "commonjs" as const,
        source: `module.exports = {
  runDashboardLoadMaintenance: async () => {
    globalThis.__dashboardTestMaintenanceCalls += 1;
    return { purgedCount: 0 };
  },
};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

type LoaderModule = typeof import("./loader");
let loadDashboardViewModel: LoaderModule["loadDashboardViewModel"];

before(async () => {
  const mod = await import("./loader");
  loadDashboardViewModel = mod.loadDashboardViewModel;
});

function mutablePrisma(): Record<string, unknown> {
  return prisma as unknown as Record<string, unknown>;
}

function replacePrismaProperty(t: TestContext, key: string, value: unknown) {
  const target = mutablePrisma();
  const original = target[key];
  target[key] = value;
  t.after(() => {
    target[key] = original;
  });
}

function trackedCalls<T>(implementation: (...args: unknown[]) => T): {
  fn: (...args: unknown[]) => T;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  return {
    calls,
    fn: (...args: unknown[]) => {
      calls.push(args);
      return implementation(...args);
    },
  };
}

beforeEach(() => {
  globalThis.__dashboardTestDocumentList = {
    documents: [],
    availableTags: [],
    listCapped: false,
    hasDocuments: false,
  };
  globalThis.__dashboardTestListCalls = [];
  globalThis.__dashboardTestMaintenanceCalls = 0;
});

describe("loadDashboardViewModel", () => {
  it("always runs dashboard-load maintenance exactly once before reading any state", async (t) => {
    replacePrismaProperty(t, "user", {
      findUnique: async () => ({ onboardingDismissed: false }),
    });
    replacePrismaProperty(t, "visual", { count: async () => 0 });

    await loadDashboardViewModel({
      userId: "user-1",
      userEmail: "ada@example.com",
      locale: "en",
    });

    assert.equal(globalThis.__dashboardTestMaintenanceCalls, 1);
  });

  it("scopes the onboarding-flag lookup and visual count to the acting user", async (t) => {
    const findUnique = trackedCalls(async () => ({
      onboardingDismissed: false,
    }));
    replacePrismaProperty(t, "user", { findUnique: findUnique.fn });
    const visualCount = trackedCalls(async () => 0);
    replacePrismaProperty(t, "visual", { count: visualCount.fn });

    await loadDashboardViewModel({
      userId: "user-42",
      userEmail: "grace@example.com",
      locale: "en",
    });

    assert.equal(findUnique.calls.length, 1);
    const [userArgs] = findUnique.calls[0] as [
      { where: { id: string }; select: Record<string, unknown> },
    ];
    assert.deepEqual(userArgs.where, { id: "user-42" });
    assert.equal("onboardingDismissed" in userArgs.select, true);

    assert.equal(visualCount.calls.length, 1);
    const [visualArgs] = visualCount.calls[0] as [
      { where: { document: unknown } },
    ];
    assert.deepEqual(
      visualArgs.where.document,
      accessibleDocumentWhere("user-42"),
    );

    assert.deepEqual(globalThis.__dashboardTestListCalls, ["user-42"]);
  });

  it("defaults onboardingDismissed to false when the user row is missing", async (t) => {
    replacePrismaProperty(t, "user", { findUnique: async () => null });
    replacePrismaProperty(t, "visual", { count: async () => 0 });
    globalThis.__dashboardTestDocumentList = {
      documents: [],
      availableTags: [],
      listCapped: false,
      hasDocuments: false,
    };

    const viewModel = await loadDashboardViewModel({
      userId: "ghost-user",
      userEmail: "ghost@example.com",
      locale: "en",
    });

    // Missing user row -> not dismissed -> checklist shows for a fresh user.
    assert.equal(viewModel.onboarding.show, true);
  });

  it("derives hasVisuals strictly from visualCount > 0 and reflects it in the onboarding steps", async (t) => {
    replacePrismaProperty(t, "user", {
      findUnique: async () => ({ onboardingDismissed: false }),
    });
    replacePrismaProperty(t, "visual", { count: async () => 3 });
    globalThis.__dashboardTestDocumentList = {
      documents: [],
      availableTags: [],
      listCapped: false,
      hasDocuments: true,
    };

    const viewModel = await loadDashboardViewModel({
      userId: "user-1",
      userEmail: "ada@example.com",
      locale: "en",
    });

    assert.equal(viewModel.onboarding.show, true);
    const visualStep = viewModel.onboarding.steps.find(
      (step) => step.id === "generate-visual",
    );
    const docStep = viewModel.onboarding.steps.find(
      (step) => step.id === "create-doc",
    );
    assert.equal(visualStep?.done, true);
    assert.equal(docStep?.done, true);
  });

  it("suppresses the onboarding checklist entirely once dismissed, regardless of step completion", async (t) => {
    replacePrismaProperty(t, "user", {
      findUnique: async () => ({ onboardingDismissed: true }),
    });
    replacePrismaProperty(t, "visual", { count: async () => 0 });
    globalThis.__dashboardTestDocumentList = {
      documents: [],
      availableTags: [],
      listCapped: false,
      hasDocuments: false,
    };

    const viewModel = await loadDashboardViewModel({
      userId: "user-1",
      userEmail: "ada@example.com",
      locale: "en",
    });

    assert.equal(viewModel.onboarding.show, false);
    assert.deepEqual(viewModel.onboarding.steps, []);
  });

  it("passes the document list's documents/tags/listCapped straight through to the view model", async (t) => {
    replacePrismaProperty(t, "user", {
      findUnique: async () => ({ onboardingDismissed: true }),
    });
    replacePrismaProperty(t, "visual", { count: async () => 0 });
    const documents = [{ id: "doc-1", title: "Roadmap" }];
    const availableTags = [{ id: "tag-1", name: "Plan" }];
    globalThis.__dashboardTestDocumentList = {
      documents,
      availableTags,
      listCapped: true,
      hasDocuments: true,
    };

    const viewModel = await loadDashboardViewModel({
      userId: "user-1",
      userEmail: "ada@example.com",
      locale: "en",
    });

    assert.deepEqual(viewModel.documents, documents);
    assert.deepEqual(viewModel.availableTags, availableTags);
    assert.equal(viewModel.listCapped, true);
    assert.equal(typeof viewModel.title, "string");
    assert.ok(viewModel.subtitle.includes("ada@example.com"));
  });
});
