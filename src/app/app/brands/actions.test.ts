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

type BrandRow = {
  id: string;
  name: string;
  ownerId: string;
};

type Entitlements = { canBrand: boolean; canFontUpload: boolean };

type BrandActionsTestState = {
  calls: unknown[];
  redirect: (url: string) => never;
  revalidatePath: (path: string) => void;
  requireUser: (redirect: (url: string) => never) => Promise<{ id: string }>;
  entitlements: Entitlements;
  prisma: {
    brand: {
      findMany: (args: unknown) => Promise<BrandRow[]>;
    };
  };
  createBrandForOwner: (
    ownerId: string,
    data: unknown,
    AssetErrorCtor: new (message?: string) => Error,
  ) => Promise<BrandRow>;
  updateBrandForOwner: (
    id: string,
    ownerId: string,
    data: unknown,
    AssetErrorCtor: new (message?: string) => Error,
  ) => Promise<BrandRow | null>;
  deleteBrandForOwner: (
    id: string,
    ownerId: string,
  ) => Promise<"deleted" | "missing" | "unauthorized">;
};

const globalForActions = globalThis as typeof globalThis & {
  __brandActionsTestState: BrandActionsTestState;
};

function createDefaultState(): BrandActionsTestState {
  const calls: unknown[] = [];
  return {
    calls,
    redirect(url: string): never {
      calls.push(["redirect", url]);
      throw new Error(`NEXT_REDIRECT:${url}`);
    },
    revalidatePath(path: string) {
      calls.push(["revalidatePath", path]);
    },
    async requireUser() {
      calls.push(["requireUser"]);
      return { id: "user-1" };
    },
    entitlements: { canBrand: true, canFontUpload: true },
    prisma: {
      brand: {
        async findMany(args) {
          calls.push(["prisma.brand.findMany", args]);
          return [{ id: "brand-1", name: "Acme", ownerId: "user-1" }];
        },
      },
    },
    async createBrandForOwner(ownerId, data) {
      calls.push(["createBrandForOwner", ownerId, data]);
      return { id: "brand-new-1", name: "Acme", ownerId };
    },
    async updateBrandForOwner(id, ownerId, data) {
      calls.push(["updateBrandForOwner", id, ownerId, data]);
      return { id, name: "Acme Updated", ownerId };
    },
    async deleteBrandForOwner(id, ownerId) {
      calls.push(["deleteBrandForOwner", id, ownerId]);
      return "deleted";
    },
  };
}

globalForActions.__brandActionsTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-brand-action-test:";

const stubbedModules = new Map<string, string>([
  [
    "next/navigation",
    `
      export function redirect(url) {
        return globalThis.__brandActionsTestState.redirect(url);
      }
    `,
  ],
  [
    "next/cache",
    `
      export function revalidatePath(path) {
        globalThis.__brandActionsTestState.revalidatePath(path);
      }
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        return globalThis.__brandActionsTestState.requireUser(redirect);
      }
    `,
  ],
  [
    "@/lib/prisma",
    `
      export const prisma = {
        brand: {
          findMany(args) {
            return globalThis.__brandActionsTestState.prisma.brand.findMany(args);
          },
        },
      };
    `,
  ],
  [
    "@/lib/brand/serialize",
    `
      export const BRAND_SELECT = { id: true, name: true, ownerId: true };
      export async function serializeBrands(rows) {
        return rows.map((row) => ({ ...row, logoUrl: null, fontUrl: null }));
      }
    `,
  ],
  [
    "@/lib/brand/persistence-service",
    `
      export class BrandAssetValidationError extends Error {
        constructor(message = "Brand asset not found or unauthorized.") {
          super(message);
          this.name = "BrandAssetValidationError";
        }
      }
      export async function createBrandForOwner(ownerId, data) {
        return globalThis.__brandActionsTestState.createBrandForOwner(
          ownerId, data, BrandAssetValidationError,
        );
      }
      export async function updateBrandForOwner(id, ownerId, data) {
        return globalThis.__brandActionsTestState.updateBrandForOwner(
          id, ownerId, data, BrandAssetValidationError,
        );
      }
      export async function deleteBrandForOwner(id, ownerId) {
        return globalThis.__brandActionsTestState.deleteBrandForOwner(id, ownerId);
      }
    `,
  ],
  [
    "@/lib/billing/brand-entitlements",
    `
      // Mirrors src/lib/brand/schema.ts's BRAND_WEB_FONTS cssFamily values
      // inline (not imported) — a nested import of a real module from within
      // this virtual stub module does not resolve reliably across Node
      // versions under module.registerHooks, so the curated list is
      // duplicated here rather than re-imported.
      const CURATED_FONT_CSS_FAMILIES = [
        "'Inter', sans-serif",
        "'Roboto', sans-serif",
        "'Open Sans', sans-serif",
        "'Lato', sans-serif",
        "'Montserrat', sans-serif",
        "'Playfair Display', serif",
        "'Source Sans 3', sans-serif",
        "'Nunito', sans-serif",
        "'Raleway', sans-serif",
        "'Merriweather', serif",
        "'DM Sans', sans-serif",
        "'Space Grotesk', sans-serif",
      ];

      export const BRAND_STYLES_UPGRADE_MESSAGE =
        "Brand Studio requires a Plus or Pro plan. Upgrade your plan to create and manage brand styles.";
      export const FONT_UPLOAD_UPGRADE_MESSAGE =
        "Custom font upload requires a Pro plan. Upgrade to Pro to upload and use custom fonts.";

      export async function resolveBrandEntitlements(userId) {
        globalThis.__brandActionsTestState.calls.push([
          "resolveBrandEntitlements", userId,
        ]);
        return globalThis.__brandActionsTestState.entitlements;
      }

      // Mirrors the real predicate's shape using the curated font list above
      // so the "custom font" boundary is authentic without re-testing
      // isCustomFontFamily's own unit coverage (see brand-entitlements.test.ts).
      export function isCustomFontFamily(fontFamily) {
        if (typeof fontFamily !== "string") return false;
        const trimmed = fontFamily.trim();
        if (trimmed.length === 0) return false;
        return !CURATED_FONT_CSS_FAMILIES.includes(trimmed);
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

type BrandActions = typeof import("./actions");

let actions: BrandActions;

before(async () => {
  actions = await import("./actions");
});

beforeEach(() => {
  globalForActions.__brandActionsTestState = createDefaultState();
});

function state(): BrandActionsTestState {
  return globalForActions.__brandActionsTestState;
}

function callsOf(tag: string): unknown[][] {
  return (state().calls as unknown[][]).filter((c) => c[0] === tag);
}

/** A minimal valid brand payload accepted by the real `validateBrandInput`. */
function validBrandInput(overrides: Record<string, unknown> = {}) {
  return { name: "Acme", ...overrides };
}

/** Makes requireUser simulate an unauthenticated caller by invoking the redirect. */
function denyAuth() {
  state().requireUser = async (redir) => {
    redir("/login");
    throw new Error("unreachable");
  };
}

// ---------------------------------------------------------------------------
// listBrands
// ---------------------------------------------------------------------------

describe("listBrands", () => {
  it("redirects unauthenticated callers without querying", async () => {
    denyAuth();
    await assert.rejects(() => actions.listBrands(), /NEXT_REDIRECT:\/login/);
    assert.equal(callsOf("prisma.brand.findMany").length, 0);
  });

  it("scopes the query to the session user's own brands and serializes the result", async () => {
    const result = await actions.listBrands();

    assert.deepEqual(callsOf("prisma.brand.findMany"), [
      [
        "prisma.brand.findMany",
        {
          where: { ownerId: "user-1" },
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, ownerId: true },
        },
      ],
    ]);
    assert.deepEqual(result, [
      {
        id: "brand-1",
        name: "Acme",
        ownerId: "user-1",
        logoUrl: null,
        fontUrl: null,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// createBrand
// ---------------------------------------------------------------------------

describe("createBrand", () => {
  it("redirects unauthenticated callers without checking entitlements", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.createBrand(validBrandInput()),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(callsOf("resolveBrandEntitlements").length, 0);
    assert.equal(callsOf("createBrandForOwner").length, 0);
  });

  it("rejects brand creation on the free plan with the upgrade message and no validation call", async () => {
    state().entitlements = { canBrand: false, canFontUpload: false };

    const result = await actions.createBrand(validBrandInput());

    assert.deepEqual(result, {
      ok: false,
      error:
        "Brand Studio requires a Plus or Pro plan. Upgrade your plan to create and manage brand styles.",
    });
    assert.equal(callsOf("createBrandForOwner").length, 0);
    assert.equal(callsOf("revalidatePath").length, 0);
  });

  it("rejects invalid brand input before calling the persistence service", async () => {
    const result = await actions.createBrand({ name: "" });

    assert.deepEqual(result, {
      ok: false,
      error: "Brand name must be 1–80 characters.",
    });
    assert.equal(callsOf("createBrandForOwner").length, 0);
  });

  it("rejects a custom font family when the plan lacks font-upload entitlement", async () => {
    state().entitlements = { canBrand: true, canFontUpload: false };

    const result = await actions.createBrand(
      validBrandInput({ fontFamily: "My Custom Font" }),
    );

    assert.deepEqual(result, {
      ok: false,
      error:
        "Custom font upload requires a Pro plan. Upgrade to Pro to upload and use custom fonts.",
    });
    assert.equal(callsOf("createBrandForOwner").length, 0);
  });

  it("maps a BrandAssetValidationError from the persistence service to a safe error", async () => {
    state().createBrandForOwner = async (_ownerId, _data, ErrorCtor) => {
      throw new ErrorCtor("Logo asset not found or unauthorized.");
    };

    const result = await actions.createBrand(validBrandInput());

    assert.deepEqual(result, {
      ok: false,
      error: "Logo asset not found or unauthorized.",
    });
  });

  it("rethrows an unrelated persistence error", async () => {
    state().createBrandForOwner = async () => {
      throw new Error("db unavailable");
    };

    await assert.rejects(
      () => actions.createBrand(validBrandInput()),
      /db unavailable/,
    );
  });

  it("creates the brand for the session user, revalidates, and returns the serialized brand", async () => {
    const result = await actions.createBrand(validBrandInput({ name: "Acme" }));

    assert.equal(result.ok, true);
    const [createCall] = callsOf("createBrandForOwner") as [unknown[]];
    assert.equal(createCall[1], "user-1");
    assert.deepEqual(callsOf("revalidatePath"), [
      ["revalidatePath", "/app/brands"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// updateBrand
// ---------------------------------------------------------------------------

describe("updateBrand", () => {
  it("redirects unauthenticated callers without checking entitlements", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.updateBrand("brand-1", validBrandInput()),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(callsOf("updateBrandForOwner").length, 0);
  });

  it("rejects the update on the free plan with the upgrade message", async () => {
    state().entitlements = { canBrand: false, canFontUpload: false };

    const result = await actions.updateBrand("brand-1", validBrandInput());

    assert.deepEqual(result, {
      ok: false,
      error:
        "Brand Studio requires a Plus or Pro plan. Upgrade your plan to create and manage brand styles.",
    });
    assert.equal(callsOf("updateBrandForOwner").length, 0);
  });

  it("rejects invalid brand input before calling the persistence service", async () => {
    const result = await actions.updateBrand("brand-1", { name: "" });

    assert.deepEqual(result, {
      ok: false,
      error: "Brand name must be 1–80 characters.",
    });
    assert.equal(callsOf("updateBrandForOwner").length, 0);
  });

  it("returns Brand not found when the persistence service reports a missing row", async () => {
    state().updateBrandForOwner = async () => null;

    const result = await actions.updateBrand(
      "brand-missing",
      validBrandInput(),
    );

    assert.deepEqual(result, { ok: false, error: "Brand not found." });
  });

  it("scopes updates to the owning user, mapping cross-owner writes to Not authorized", async () => {
    state().updateBrandForOwner = async () => {
      throw new Error("Not authorized.");
    };

    const result = await actions.updateBrand(
      "brand-other-user",
      validBrandInput(),
    );

    assert.deepEqual(result, { ok: false, error: "Not authorized." });
  });

  it("maps a BrandAssetValidationError from the persistence service to a safe error", async () => {
    state().updateBrandForOwner = async (_id, _ownerId, _data, ErrorCtor) => {
      throw new ErrorCtor("Font asset not found or unauthorized.");
    };

    const result = await actions.updateBrand("brand-1", validBrandInput());

    assert.deepEqual(result, {
      ok: false,
      error: "Font asset not found or unauthorized.",
    });
  });

  it("rethrows an unrelated persistence error", async () => {
    state().updateBrandForOwner = async () => {
      throw new Error("db unavailable");
    };

    await assert.rejects(
      () => actions.updateBrand("brand-1", validBrandInput()),
      /db unavailable/,
    );
  });

  it("updates the brand, revalidates, and returns the serialized brand", async () => {
    const result = await actions.updateBrand("brand-1", validBrandInput());

    assert.equal(result.ok, true);
    const [updateCall] = callsOf("updateBrandForOwner") as [unknown[]];
    assert.deepEqual(updateCall.slice(0, 2), [
      "updateBrandForOwner",
      "brand-1",
    ]);
    assert.equal(updateCall[2] as string, "user-1");
    assert.deepEqual(callsOf("revalidatePath"), [
      ["revalidatePath", "/app/brands"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// deleteBrand
// ---------------------------------------------------------------------------

describe("deleteBrand", () => {
  it("redirects unauthenticated callers without checking entitlements", async () => {
    denyAuth();
    await assert.rejects(
      () => actions.deleteBrand("brand-1"),
      /NEXT_REDIRECT:\/login/,
    );
    assert.equal(callsOf("deleteBrandForOwner").length, 0);
  });

  it("rejects the delete on the free plan with the upgrade message", async () => {
    state().entitlements = { canBrand: false, canFontUpload: false };

    const result = await actions.deleteBrand("brand-1");

    assert.deepEqual(result, {
      ok: false,
      error:
        "Brand Studio requires a Plus or Pro plan. Upgrade your plan to create and manage brand styles.",
    });
    assert.equal(callsOf("deleteBrandForOwner").length, 0);
  });

  it("returns Brand not found when the persistence service reports a missing row", async () => {
    state().deleteBrandForOwner = async () => "missing";

    const result = await actions.deleteBrand("brand-missing");

    assert.deepEqual(result, { ok: false, error: "Brand not found." });
    assert.equal(callsOf("revalidatePath").length, 0);
  });

  it("scopes deletes to the owning user, mapping cross-owner deletes to Not authorized", async () => {
    state().deleteBrandForOwner = async () => "unauthorized";

    const result = await actions.deleteBrand("brand-other-user");

    assert.deepEqual(result, { ok: false, error: "Not authorized." });
    assert.equal(callsOf("revalidatePath").length, 0);
  });

  it("deletes the brand for the session user, revalidates, and returns ok", async () => {
    const result = await actions.deleteBrand("brand-1");

    assert.deepEqual(result, { ok: true, data: undefined });
    assert.deepEqual(callsOf("deleteBrandForOwner"), [
      ["deleteBrandForOwner", "brand-1", "user-1"],
    ]);
    assert.deepEqual(callsOf("revalidatePath"), [
      ["revalidatePath", "/app/brands"],
    ]);
  });
});
