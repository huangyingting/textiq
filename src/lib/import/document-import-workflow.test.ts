import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import type {
  DocumentImportCreateActionPort,
  ImportedDocumentCreationPayload,
} from "@/lib/action-ports";
import { IMPORT_MAX_UPLOAD_BYTES } from "@/lib/limits/assets";

import {
  DOCUMENT_IMPORT_MAX_SIZE_LABEL,
  useDocumentImportCreationWorkflow,
} from "./document-import-workflow";

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const [message] = args;
  if (
    typeof message === "string" &&
    message.startsWith("react-test-renderer is deprecated")
  ) {
    return;
  }
  originalConsoleError(...args);
};

after(() => {
  console.error = originalConsoleError;
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function fakeFile(
  size: number,
  name = "test.pdf",
  type = "application/pdf",
): File {
  const file = new File([], name, { type });
  Object.defineProperty(file, "size", { value: size, configurable: true });
  return file;
}

type HookResult = ReturnType<typeof useDocumentImportCreationWorkflow>;

function renderWorkflow(input: {
  port?: DocumentImportCreateActionPort;
  onCreated?: (payload: ImportedDocumentCreationPayload) => void;
  target?: { kind: "personal" } | { kind: "workspace"; workspaceId: string };
}) {
  const hookRef: { current: HookResult | null } = { current: null };

  function Harness() {
    hookRef.current = useDocumentImportCreationWorkflow({
      onCreated: input.onCreated ?? (() => undefined),
      surface: "dashboard",
      target: input.target ?? { kind: "personal" },
      port: input.port,
    });
    return null;
  }

  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(Harness));
  });

  return {
    ref: hookRef,
    unmount: () => act(() => renderer.unmount()),
  };
}

test("client preflight: file at exactly IMPORT_MAX_UPLOAD_BYTES is not rejected", async () => {
  let importFileCalled = false;
  const port: DocumentImportCreateActionPort = {
    async importFile(_file, target) {
      importFileCalled = true;
      assert.equal(target.kind, "personal");
      return {
        ok: true,
        data: { documentId: "doc-1", documentPath: "/app/documents/doc-1" },
      };
    },
  };

  const { ref, unmount } = renderWorkflow({ port });

  await act(async () => {
    await ref.current!.processFile(fakeFile(IMPORT_MAX_UPLOAD_BYTES));
  });

  assert.equal(importFileCalled, true);
  assert.notEqual(ref.current!.state.status, "error");

  unmount();
});

test("client preflight: file at IMPORT_MAX_UPLOAD_BYTES + 1 is rejected before upload", async () => {
  let importFileCalled = false;
  const port: DocumentImportCreateActionPort = {
    async importFile() {
      importFileCalled = true;
      return {
        ok: true,
        data: { documentId: "doc-1", documentPath: "/app/documents/doc-1" },
      };
    },
  };

  const { ref, unmount } = renderWorkflow({ port });

  await act(async () => {
    await ref.current!.processFile(fakeFile(IMPORT_MAX_UPLOAD_BYTES + 1));
  });

  assert.equal(importFileCalled, false);
  assert.equal(ref.current!.state.status, "error");

  unmount();
});

test("client preflight: rejection message includes '20 MB' wording", async () => {
  const port: DocumentImportCreateActionPort = {
    async importFile() {
      return {
        ok: true,
        data: { documentId: "doc-1", documentPath: "/app/documents/doc-1" },
      };
    },
  };

  const { ref, unmount } = renderWorkflow({ port });

  await act(async () => {
    await ref.current!.processFile(fakeFile(IMPORT_MAX_UPLOAD_BYTES + 1));
  });

  assert.equal(ref.current!.state.status, "error");
  const state = ref.current!.state;
  if (state.status === "error") {
    assert.ok(
      state.message.includes(DOCUMENT_IMPORT_MAX_SIZE_LABEL),
      `error message "${state.message}" must include '${DOCUMENT_IMPORT_MAX_SIZE_LABEL}'`,
    );
  }

  unmount();
});

test("route response: malformed JSON is treated as a typed malformed_response error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("<not-json>", {
      status: 502,
      headers: { "content-type": "text/plain" },
    })) as typeof fetch;

  const { ref, unmount } = renderWorkflow({});
  try {
    await act(async () => {
      await ref.current!.processFile(
        fakeFile(1024, "notes.md", "text/markdown"),
      );
    });
    assert.equal(ref.current!.state.status, "error");
    if (ref.current!.state.status === "error") {
      assert.match(ref.current!.state.message, /invalid import response/i);
    }
  } finally {
    unmount();
    globalThis.fetch = originalFetch;
  }
});

test("route response: failure payload status mismatch is treated as malformed response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: "malformed",
          status: 422,
          message: "Could not parse file.",
        },
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    )) as typeof fetch;

  const { ref, unmount } = renderWorkflow({});
  try {
    await act(async () => {
      await ref.current!.processFile(
        fakeFile(1024, "notes.md", "text/markdown"),
      );
    });
    assert.equal(ref.current!.state.status, "error");
    if (ref.current!.state.status === "error") {
      assert.match(ref.current!.state.message, /invalid import response/i);
    }
  } finally {
    unmount();
    globalThis.fetch = originalFetch;
  }
});

test("route response: failure payload with a non-canonical code/status pair is treated as malformed response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: "malformed",
          status: 500,
          message: "Could not parse file.",
        },
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    )) as typeof fetch;

  const { ref, unmount } = renderWorkflow({});
  try {
    await act(async () => {
      await ref.current!.processFile(
        fakeFile(1024, "notes.md", "text/markdown"),
      );
    });
    assert.equal(ref.current!.state.status, "error");
    if (ref.current!.state.status === "error") {
      assert.match(ref.current!.state.message, /invalid import response/i);
    }
  } finally {
    unmount();
    globalThis.fetch = originalFetch;
  }
});

test("route response: flat create success payload is accepted", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        documentId: "doc-123",
        documentPath: "/app/documents/doc-123",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    )) as typeof fetch;

  const created: ImportedDocumentCreationPayload[] = [];
  const { ref, unmount } = renderWorkflow({
    onCreated: (payload) => created.push(payload),
  });
  try {
    await act(async () => {
      await ref.current!.processFile(
        fakeFile(1024, "notes.md", "text/markdown"),
      );
    });
    assert.deepEqual(created, [
      {
        documentId: "doc-123",
        documentPath: "/app/documents/doc-123",
      },
    ]);
    assert.equal(ref.current!.state.status, "idle");
  } finally {
    unmount();
    globalThis.fetch = originalFetch;
  }
});

test("creation workflow ignores a second file while durable import is pending", async () => {
  const importedNames: string[] = [];
  let resolveImport!: (
    value: Awaited<ReturnType<DocumentImportCreateActionPort["importFile"]>>,
  ) => void;
  const port: DocumentImportCreateActionPort = {
    importFile(file) {
      importedNames.push(file.name);
      return new Promise((resolve) => {
        resolveImport = resolve;
      });
    },
  };
  const created: ImportedDocumentCreationPayload[] = [];
  const { ref, unmount } = renderWorkflow({
    port,
    onCreated: (payload) => created.push(payload),
  });

  let firstImport!: Promise<void>;
  let duplicateImport!: Promise<void>;
  await act(async () => {
    firstImport = ref.current!.processFile(
      fakeFile(1024, "first.md", "text/markdown"),
    );
    duplicateImport = ref.current!.processFile(
      fakeFile(1024, "duplicate.md", "text/markdown"),
    );
    await Promise.resolve();
  });

  assert.deepEqual(importedNames, ["first.md"]);
  assert.equal(ref.current!.state.status, "uploading");

  await act(async () => {
    resolveImport({
      ok: true,
      data: { documentId: "doc-1", documentPath: "/app/documents/doc-1" },
    });
    await Promise.all([firstImport, duplicateImport]);
  });

  assert.deepEqual(created, [
    { documentId: "doc-1", documentPath: "/app/documents/doc-1" },
  ]);
  assert.equal(ref.current!.state.status, "idle");
  unmount();
});

test("creation workflow ignores a late import result after its surface unmounts", async () => {
  let resolveImport!: (
    value: Awaited<ReturnType<DocumentImportCreateActionPort["importFile"]>>,
  ) => void;
  const port: DocumentImportCreateActionPort = {
    importFile() {
      return new Promise((resolve) => {
        resolveImport = resolve;
      });
    },
  };
  const created: ImportedDocumentCreationPayload[] = [];
  const { ref, unmount } = renderWorkflow({
    port,
    onCreated: (payload) => created.push(payload),
  });

  let pendingImport!: Promise<void>;
  act(() => {
    pendingImport = ref.current!.processFile(
      fakeFile(1024, "late.md", "text/markdown"),
    );
  });
  unmount();

  await act(async () => {
    resolveImport({
      ok: true,
      data: { documentId: "doc-late", documentPath: "/app/documents/doc-late" },
    });
    await pendingImport;
  });

  assert.deepEqual(created, []);
});

test("creation workflow contains a thrown port error and becomes retryable", async () => {
  const port: DocumentImportCreateActionPort = {
    async importFile() {
      throw new Error("transport failed");
    },
  };
  const { ref, unmount } = renderWorkflow({ port });

  await act(async () => {
    await ref.current!.processFile(fakeFile(1024, "notes.md", "text/markdown"));
  });

  assert.equal(ref.current!.state.status, "error");
  if (ref.current!.state.status === "error") {
    assert.match(ref.current!.state.message, /Could not reach the server/);
  }
  unmount();
});
