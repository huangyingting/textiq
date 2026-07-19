/**
 * Server-action boundary coverage for `uploadSlideAsset` (Epic #374, #1904).
 *
 * The underlying validation/storage building blocks (`validateAssetUpload`,
 * `validateAssetMagicBytes`, `imageDimensionsFromBytes`,
 * `validateAssetDimensionsPolicy`, `buildAssetMeta`, `storeSlideAsset`) are
 * pure/service-level concerns already exercised by `upload-action.test.ts`
 * and the adapters' own test suites. This file stubs all of them via
 * `node:module` hooks (matching the DI convention in `server-actions.test.ts`)
 * so it can assert on the action's own boundary behavior instead:
 *
 *  - auth/ownership is checked before any validation runs
 *  - exact document-id scoping is threaded through unmodified
 *  - the validation pipeline short-circuits in order and never calls
 *    storage once a gate fails
 *  - the success response is assembled from the storage adapter's result
 *    with optional width/height fields included only when present
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

type Validation = { ok: true; mime: string } | { ok: false; error: unknown };
type OkOnly = { ok: true } | { ok: false; error: unknown };
type MetaResult =
  { ok: true; meta: Record<string, unknown> } | { ok: false; error: unknown };

type SlideAssetTestState = {
  calls: unknown[];
  requireDocumentActionContext: (
    documentId: string,
    capability: string,
  ) => Promise<unknown>;
  validateAssetUpload: (type: string, name: string, size: number) => Validation;
  formatAssetUploadError: (error: unknown) => string;
  validateAssetMagicBytes: (mime: string, buffer: Uint8Array) => OkOnly;
  imageDimensionsFromBytes: (
    mime: string,
    buffer: Uint8Array,
  ) => { widthPx?: number; heightPx?: number };
  validateAssetDimensionsPolicy: (
    policy: unknown,
    widthPx: number | undefined,
    heightPx: number | undefined,
  ) => OkOnly;
  calculateAssetChecksum: (buffer: Buffer) => string;
  buildAssetMeta: (opts: Record<string, unknown>) => MetaResult;
  storeSlideAsset: (opts: {
    documentId: string;
    buffer: Buffer;
    meta: Record<string, unknown>;
  }) => Promise<{ assetId: string; url: string; checksum: string }>;
};

const globalForSlideAsset = globalThis as typeof globalThis & {
  __slideAssetActionsTestState: SlideAssetTestState;
};

function createState(): SlideAssetTestState {
  const calls: unknown[] = [];
  return {
    calls,
    async requireDocumentActionContext(documentId, capability) {
      calls.push(["requireDocumentActionContext", documentId, capability]);
      return { user: { id: "user-1" }, authorization: { canEdit: true } };
    },
    validateAssetUpload(type, name, size) {
      calls.push(["validateAssetUpload", type, name, size]);
      return { ok: true, mime: "image/png" };
    },
    formatAssetUploadError(error) {
      calls.push(["formatAssetUploadError", error]);
      return "Formatted upload error.";
    },
    validateAssetMagicBytes(mime, buffer) {
      calls.push(["validateAssetMagicBytes", mime, buffer.length]);
      return { ok: true };
    },
    imageDimensionsFromBytes(mime, buffer) {
      calls.push(["imageDimensionsFromBytes", mime, buffer.length]);
      return { widthPx: 200, heightPx: 100 };
    },
    validateAssetDimensionsPolicy(_policy, widthPx, heightPx) {
      calls.push(["validateAssetDimensionsPolicy", widthPx, heightPx]);
      return { ok: true };
    },
    calculateAssetChecksum(buffer) {
      calls.push(["calculateAssetChecksum", buffer.length]);
      return "checksum-abc";
    },
    buildAssetMeta(opts) {
      calls.push(["buildAssetMeta", opts]);
      return {
        ok: true,
        meta: { mimeType: "image/png", checksum: "checksum-abc" },
      };
    },
    async storeSlideAsset(opts) {
      calls.push(["storeSlideAsset", opts.documentId, opts.meta]);
      return {
        assetId: "asset-1",
        url: "https://assets.test/asset-1",
        checksum: "checksum-abc",
      };
    },
  };
}

globalForSlideAsset.__slideAssetActionsTestState = createState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-slide-asset-action-test:";
const stubbedModules = new Map<string, string>([
  [
    "./document-context",
    `
      export async function requireDocumentActionContext(...args) {
        return globalThis.__slideAssetActionsTestState.requireDocumentActionContext(...args);
      }
    `,
  ],
  [
    "@/lib/assets/store",
    `
      export function calculateAssetChecksum(...args) {
        return globalThis.__slideAssetActionsTestState.calculateAssetChecksum(...args);
      }
    `,
  ],
  [
    "@/lib/assets/upload-policy",
    `
      export function validateAssetMagicBytes(...args) {
        return globalThis.__slideAssetActionsTestState.validateAssetMagicBytes(...args);
      }
      export function imageDimensionsFromBytes(...args) {
        return globalThis.__slideAssetActionsTestState.imageDimensionsFromBytes(...args);
      }
      export function validateAssetDimensionsPolicy(...args) {
        return globalThis.__slideAssetActionsTestState.validateAssetDimensionsPolicy(...args);
      }
    `,
  ],
  [
    "@/lib/slides/asset-upload",
    `
      export const SLIDE_ASSET_UPLOAD_POLICY = { name: "slide-asset-test-policy" };
      export function buildAssetMeta(...args) {
        return globalThis.__slideAssetActionsTestState.buildAssetMeta(...args);
      }
      export function formatAssetUploadError(...args) {
        return globalThis.__slideAssetActionsTestState.formatAssetUploadError(...args);
      }
      export function validateAssetUpload(...args) {
        return globalThis.__slideAssetActionsTestState.validateAssetUpload(...args);
      }
    `,
  ],
  [
    "@/lib/slides/asset-store",
    `
      export async function storeSlideAsset(...args) {
        return globalThis.__slideAssetActionsTestState.storeSlideAsset(...args);
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

let slideAssetActions: typeof import("./slide-asset-actions");

before(async () => {
  slideAssetActions = await import("./slide-asset-actions");
});

beforeEach(() => {
  globalForSlideAsset.__slideAssetActionsTestState = createState();
});

function state(): SlideAssetTestState {
  return globalForSlideAsset.__slideAssetActionsTestState;
}

function formDataWithFile(bytes = new Uint8Array([1, 2, 3]), name = "a.png") {
  const formData = new FormData();
  formData.set("file", new File([bytes], name, { type: "image/png" }));
  return formData;
}

describe("uploadSlideAsset server action", () => {
  it("checks edit access scoped to the exact document id before any validation", async () => {
    state().requireDocumentActionContext = async (documentId, capability) => {
      state().calls.push([
        "requireDocumentActionContext",
        documentId,
        capability,
      ]);
      throw new Error("permission denied");
    };

    await assert.rejects(
      () => slideAssetActions.uploadSlideAsset("doc-77", formDataWithFile()),
      /permission denied/,
    );

    assert.deepEqual(state().calls, [
      ["requireDocumentActionContext", "doc-77", "edit"],
    ]);
  });

  it("rejects when no file is present without validating or storing", async () => {
    const formData = new FormData();
    formData.set("file", "not-a-file");

    assert.deepEqual(
      await slideAssetActions.uploadSlideAsset("doc-1", formData),
      { ok: false, error: "No file provided." },
    );
    assert.deepEqual(state().calls, [
      ["requireDocumentActionContext", "doc-1", "edit"],
    ]);
  });

  it("stops at MIME/size validation before checksum, magic-byte, or storage checks", async () => {
    state().validateAssetUpload = (type, name, size) => {
      state().calls.push(["validateAssetUpload", type, name, size]);
      return {
        ok: false,
        error: { code: "type_rejected", accepted: ["image/png"] },
      };
    };

    const result = await slideAssetActions.uploadSlideAsset(
      "doc-1",
      formDataWithFile(),
    );

    assert.deepEqual(result, { ok: false, error: "Formatted upload error." });
    assert.deepEqual(
      state().calls.map((call) => (call as unknown[])[0]),
      [
        "requireDocumentActionContext",
        "validateAssetUpload",
        "formatAssetUploadError",
      ],
    );
  });

  it("stops at magic-byte validation before dimensions or storage", async () => {
    state().validateAssetMagicBytes = (mime, buffer) => {
      state().calls.push(["validateAssetMagicBytes", mime, buffer.length]);
      return { ok: false, error: { code: "signature_mismatch" } };
    };

    const result = await slideAssetActions.uploadSlideAsset(
      "doc-1",
      formDataWithFile(),
    );

    assert.deepEqual(result, { ok: false, error: "Formatted upload error." });
    assert.deepEqual(
      state().calls.map((call) => (call as unknown[])[0]),
      [
        "requireDocumentActionContext",
        "validateAssetUpload",
        "validateAssetMagicBytes",
        "formatAssetUploadError",
      ],
    );
  });

  it("stops at dimension policy validation before storage", async () => {
    state().validateAssetDimensionsPolicy = (_policy, widthPx, heightPx) => {
      state().calls.push(["validateAssetDimensionsPolicy", widthPx, heightPx]);
      return { ok: false, error: { code: "dimension_exceeded", maxPx: 4000 } };
    };

    const result = await slideAssetActions.uploadSlideAsset(
      "doc-1",
      formDataWithFile(),
    );

    assert.deepEqual(result, { ok: false, error: "Formatted upload error." });
    assert.deepEqual(
      state().calls.map((call) => (call as unknown[])[0]),
      [
        "requireDocumentActionContext",
        "validateAssetUpload",
        "validateAssetMagicBytes",
        "imageDimensionsFromBytes",
        "validateAssetDimensionsPolicy",
        "formatAssetUploadError",
      ],
    );
  });

  it("stops when metadata assembly fails, without calling storage", async () => {
    state().buildAssetMeta = (opts) => {
      state().calls.push(["buildAssetMeta", opts]);
      return { ok: false, error: { code: "checksum_missing" } };
    };

    const result = await slideAssetActions.uploadSlideAsset(
      "doc-1",
      formDataWithFile(),
    );

    assert.deepEqual(result, { ok: false, error: "Formatted upload error." });
    assert.deepEqual(
      state().calls.map((call) => (call as unknown[])[0]),
      [
        "requireDocumentActionContext",
        "validateAssetUpload",
        "validateAssetMagicBytes",
        "imageDimensionsFromBytes",
        "validateAssetDimensionsPolicy",
        "calculateAssetChecksum",
        "buildAssetMeta",
        "formatAssetUploadError",
      ],
    );
  });

  it("stores the validated asset scoped to the exact document id and returns dimensions when known", async () => {
    const result = await slideAssetActions.uploadSlideAsset(
      "doc-42",
      formDataWithFile(),
    );

    assert.deepEqual(result, {
      ok: true,
      data: {
        assetId: "asset-1",
        url: "https://assets.test/asset-1",
        widthPx: 200,
        heightPx: 100,
        mimeType: "image/png",
        contentHash: "checksum-abc",
      },
    });

    const storeCall = state().calls.find(
      (call) => (call as unknown[])[0] === "storeSlideAsset",
    ) as [string, string, Record<string, unknown>];
    assert.equal(storeCall[1], "doc-42");
    assert.deepEqual(storeCall[2], {
      mimeType: "image/png",
      checksum: "checksum-abc",
    });
  });

  it("omits width/height from the response when dimensions are unknown", async () => {
    state().imageDimensionsFromBytes = () => ({});

    const result = await slideAssetActions.uploadSlideAsset(
      "doc-1",
      formDataWithFile(),
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result, {
      ok: true,
      data: {
        assetId: "asset-1",
        url: "https://assets.test/asset-1",
        mimeType: "image/png",
        contentHash: "checksum-abc",
      },
    });
  });
});
