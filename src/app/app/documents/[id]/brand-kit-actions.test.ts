/**
 * Server-action boundary coverage for `saveBrandKitDraft` (#1904).
 *
 * `compileBrandKitDraft` (schema validation, deterministic compile) and
 * `persistCompiledBrandKitDraft` (Prisma persistence, workspace-capability
 * authorization) are underlying service-level concerns already exercised by
 * `compiler.test.ts` and are out of scope here. This file stubs both via
 * `node:module` hooks (same DI convention as `server-actions.test.ts`) to
 * isolate the action's own boundary logic:
 *
 *  - a failed compile short-circuits before any auth check or persistence
 *  - a stale compiled-package mismatch (id or version) is rejected before
 *    auth/persistence, so the client is forced to recompile against the
 *    server's current draft state
 *  - only once compiled cleanly and matching does the action authenticate
 *    the user and delegate to persistence with the exact draft/user id
 *  - an unauthenticated caller is rejected before persistence runs
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, it } from "node:test";

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

type CompileResult =
  | {
      ok: true;
      draft: Record<string, unknown>;
      package: { id: string; version: string };
      diagnostics: unknown[];
    }
  | { ok: false; diagnostics: unknown[] };

type BrandKitTestState = {
  calls: unknown[];
  redirect: (...args: unknown[]) => never;
  compileBrandKitDraft: (draft: unknown) => CompileResult;
  requireUser: (redirect: unknown) => Promise<{ id: string }>;
  persistCompiledBrandKitDraft: (opts: {
    draftInput: unknown;
    userId: string;
  }) => Promise<unknown>;
};

const globalForBrandKit = globalThis as typeof globalThis & {
  __brandKitActionsTestState: BrandKitTestState;
};

function createState(): BrandKitTestState {
  const calls: unknown[] = [];
  return {
    calls,
    redirect() {
      throw new Error("NEXT_REDIRECT");
    },
    compileBrandKitDraft(draft) {
      calls.push(["compileBrandKitDraft", draft]);
      return {
        ok: true,
        draft: draft as Record<string, unknown>,
        package: { id: "pkg-1", version: "1.0.0" },
        diagnostics: [],
      };
    },
    async requireUser() {
      calls.push(["requireUser"]);
      return { id: "user-1" };
    },
    async persistCompiledBrandKitDraft(opts) {
      calls.push(["persistCompiledBrandKitDraft", opts]);
      return {
        ok: true,
        draftId: "draft-row-1",
        packageId: "pkg-1",
        packageVersion: "1.0.0",
        package: { id: "pkg-1", version: "1.0.0" },
        catalogEntry: {
          package: { id: "pkg-1", version: "1.0.0" },
          source: "custom",
          createdAt: "2026-02-03T04:05:06.000Z",
        },
        diagnostics: [],
      };
    },
  };
}

globalForBrandKit.__brandKitActionsTestState = createState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-brand-kit-action-test:";
const stubbedModules = new Map<string, string>([
  [
    "next/navigation",
    `
      export function redirect(...args) {
        return globalThis.__brandKitActionsTestState.redirect(...args);
      }
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser(...args) {
        return globalThis.__brandKitActionsTestState.requireUser(...args);
      }
    `,
  ],
  [
    "@/lib/presentation/brand-kit/compiler",
    `
      export function compileBrandKitDraft(...args) {
        return globalThis.__brandKitActionsTestState.compileBrandKitDraft(...args);
      }
    `,
  ],
  [
    "@/lib/presentation/brand-kit/persistence",
    `
      export async function persistCompiledBrandKitDraft(...args) {
        return globalThis.__brandKitActionsTestState.persistCompiledBrandKitDraft(...args);
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

let brandKitActions: typeof import("./brand-kit-actions");

before(async () => {
  brandKitActions = await import("./brand-kit-actions");
});

beforeEach(() => {
  globalForBrandKit.__brandKitActionsTestState = createState();
});

function state(): BrandKitTestState {
  return globalForBrandKit.__brandKitActionsTestState;
}

const draft = { id: "draft-1", slug: "acme" } as Parameters<
  typeof brandKitActions.saveBrandKitDraft
>[0];
const compiledPackage = { id: "pkg-1", version: "1.0.0" } as Parameters<
  typeof brandKitActions.saveBrandKitDraft
>[1];

describe("saveBrandKitDraft server action", () => {
  it("returns compile diagnostics without authenticating or persisting", async () => {
    state().compileBrandKitDraft = (draftArg) => {
      state().calls.push(["compileBrandKitDraft", draftArg]);
      return {
        ok: false,
        diagnostics: [
          {
            severity: "error",
            code: "required-string",
            message: "name is required",
            path: "name",
          },
        ],
      };
    };

    const result = await brandKitActions.saveBrandKitDraft(
      draft,
      compiledPackage,
    );

    assert.deepEqual(result, {
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "required-string",
          message: "name is required",
          path: "name",
        },
      ],
    });
    assert.deepEqual(state().calls, [["compileBrandKitDraft", draft]]);
  });

  it("rejects a stale compiled package id before authenticating or persisting", async () => {
    const result = await brandKitActions.saveBrandKitDraft(draft, {
      id: "different-pkg",
      version: "1.0.0",
    } as typeof compiledPackage);

    assert.deepEqual(result, {
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "stale-compiled-package",
          message:
            "Compiled preview is stale. Revalidate the draft before saving.",
          path: "draft",
        },
      ],
    });
    assert.deepEqual(state().calls, [["compileBrandKitDraft", draft]]);
  });

  it("rejects a stale compiled package version before authenticating or persisting", async () => {
    const result = await brandKitActions.saveBrandKitDraft(draft, {
      id: "pkg-1",
      version: "0.9.0",
    } as typeof compiledPackage);

    assert.equal(result.ok, false);
    assert.deepEqual(
      "diagnostics" in result ? result.diagnostics[0]?.code : undefined,
      "stale-compiled-package",
    );
    assert.deepEqual(state().calls, [["compileBrandKitDraft", draft]]);
  });

  it("authenticates and persists with the exact draft and user id once compiled and matching", async () => {
    const result = await brandKitActions.saveBrandKitDraft(
      draft,
      compiledPackage,
    );

    assert.deepEqual(result, {
      ok: true,
      draftId: "draft-row-1",
      packageId: "pkg-1",
      packageVersion: "1.0.0",
      package: { id: "pkg-1", version: "1.0.0" },
      catalogEntry: {
        package: { id: "pkg-1", version: "1.0.0" },
        source: "custom",
        createdAt: "2026-02-03T04:05:06.000Z",
      },
      diagnostics: [],
    });
    assert.deepEqual(state().calls, [
      ["compileBrandKitDraft", draft],
      ["requireUser"],
      ["persistCompiledBrandKitDraft", { draftInput: draft, userId: "user-1" }],
    ]);
  });

  it("propagates unauthenticated redirects without persisting", async () => {
    const redirectError = new Error("NEXT_REDIRECT");
    state().requireUser = async () => {
      state().calls.push(["requireUser"]);
      throw redirectError;
    };

    await assert.rejects(
      () => brandKitActions.saveBrandKitDraft(draft, compiledPackage),
      (error) => error === redirectError,
    );
    assert.deepEqual(state().calls, [
      ["compileBrandKitDraft", draft],
      ["requireUser"],
    ]);
  });
});
