import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, test } from "node:test";

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

type ImportActionsTestState = {
  requireDocumentActionContext: (
    documentId: string,
    capability: string,
  ) => Promise<{ user: { id: string } }>;
  processImportUpload: (
    file: File,
    options: { subjectHash: string; deadlineAt: number },
  ) => Promise<
    | { ok: true; markdown: string }
    | {
        ok: false;
        error: { code: string; status: number; message: string };
      }
  >;
  processImportUploadCalls: Array<{
    file: File;
    options: { subjectHash: string; deadlineAt: number };
  }>;
};

const globalForImportActions = globalThis as typeof globalThis & {
  __importActionsTestState: ImportActionsTestState;
};

function createDefaultState(): ImportActionsTestState {
  return {
    requireDocumentActionContext: async () => ({ user: { id: "user-1" } }),
    processImportUpload: async () => ({ ok: true, markdown: "# Imported" }),
    processImportUploadCalls: [],
  };
}

globalForImportActions.__importActionsTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-import-actions-test:";
const stubbedModules = new Map<string, string>([
  ["server-only", ""],
  [
    "./document-context",
    `
      export async function requireDocumentActionContext(...args) {
        return globalThis.__importActionsTestState.requireDocumentActionContext(...args);
      }
    `,
  ],
  [
    "@/lib/import/upload-service",
    `
      export async function processImportUpload(file, options) {
        globalThis.__importActionsTestState.processImportUploadCalls.push({ file, options });
        return globalThis.__importActionsTestState.processImportUpload(file, options);
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

type ImportActionsModule = typeof import("./import-actions");
let parseDocumentImportForEditor: ImportActionsModule["parseDocumentImportForEditor"];

before(async () => {
  const mod = await import("./import-actions");
  parseDocumentImportForEditor = mod.parseDocumentImportForEditor;
});

beforeEach(() => {
  globalForImportActions.__importActionsTestState = createDefaultState();
});

test("parseDocumentImportForEditor returns parsed markdown on success", async () => {
  const file = new File([Buffer.from("# Imported")], "doc.md", {
    type: "text/markdown",
  });

  const result = await parseDocumentImportForEditor("doc-1", file);

  assert.deepEqual(result, {
    ok: true,
    data: { markdown: "# Imported" },
  });
  assert.equal(
    globalForImportActions.__importActionsTestState.processImportUploadCalls
      .length,
    1,
  );
  const call =
    globalForImportActions.__importActionsTestState.processImportUploadCalls[0];
  assert.equal(call?.file.name, "doc.md");
  assert.equal(call?.options.subjectHash, "user-1");
  assert.ok(Number.isFinite(call?.options.deadlineAt));
});

test("parseDocumentImportForEditor passes through typed import failures", async () => {
  globalForImportActions.__importActionsTestState.processImportUpload =
    async () => ({
      ok: false,
      error: {
        code: "malformed",
        status: 422,
        message: "Could not parse the file.",
      },
    });
  const file = new File([Buffer.from("bad")], "bad.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  const result = await parseDocumentImportForEditor("doc-1", file);

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "malformed",
      status: 422,
      message: "Could not parse the file.",
    },
  });
});
