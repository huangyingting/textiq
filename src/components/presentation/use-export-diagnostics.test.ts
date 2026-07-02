import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { makeDiagnostic } from "@/lib/presentation/diagnostics";
import type { ResolvedDeckRenderTree } from "@/lib/presentation/render-tree";

import { createExportDiagnosticsMemo } from "./use-export-diagnostics";

function mockRenderTree(id: string): ResolvedDeckRenderTree {
  return { id } as unknown as ResolvedDeckRenderTree;
}

describe("createExportDiagnosticsMemo", () => {
  test("reuses computed diagnostics across unrelated renders", () => {
    let buildSpecCalls = 0;
    const renderTree = mockRenderTree("stable");
    const resolveDiagnostics = createExportDiagnosticsMemo((_tree) => {
      buildSpecCalls += 1;
      return {
        diagnostics: [
          makeDiagnostic(
            "unsupported-export-feature",
            "warning",
            "Unsupported feature",
          ),
          makeDiagnostic("missing-asset", "warning", "Missing asset"),
          makeDiagnostic(
            "theme-decoration-export-fallback",
            "warning",
            "Decoration fallback",
          ),
        ],
      };
    });

    const diagnosticsFirst = resolveDiagnostics(renderTree);
    const diagnosticsSecond = resolveDiagnostics(renderTree);

    assert.equal(buildSpecCalls, 1);
    assert.strictEqual(diagnosticsSecond, diagnosticsFirst);
    assert.deepEqual(
      diagnosticsFirst.map((diagnostic) => diagnostic.code),
      ["unsupported-export-feature", "theme-decoration-export-fallback"],
    );
  });

  test("rebuilds diagnostics when render-tree identity changes", () => {
    let buildSpecCalls = 0;
    const renderTreeA = mockRenderTree("a");
    const renderTreeB = mockRenderTree("b");
    const resolveDiagnostics = createExportDiagnosticsMemo((_tree) => {
      buildSpecCalls += 1;
      return {
        diagnostics: [
          makeDiagnostic(
            "unsupported-export-feature",
            "warning",
            `Build #${buildSpecCalls}`,
          ),
        ],
      };
    });

    const diagnosticsA = resolveDiagnostics(renderTreeA);
    const diagnosticsARepeat = resolveDiagnostics(renderTreeA);
    const diagnosticsB = resolveDiagnostics(renderTreeB);

    assert.equal(buildSpecCalls, 2);
    assert.strictEqual(diagnosticsARepeat, diagnosticsA);
    assert.notStrictEqual(diagnosticsB, diagnosticsA);
    assert.equal(diagnosticsB[0]?.message, "Build #2");
  });
});
