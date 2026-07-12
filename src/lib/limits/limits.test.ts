import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DECK_JSON_MAX_BYTES,
  EXPORT_PREFLIGHT_MAX_SLIDES,
  GENERATED_DECK_MAX_SLIDES,
  IMPORT_MAX_BYTES_BY_MIME,
  IMPORT_MAX_UPLOAD_BYTES,
  INLINE_IMAGE_HARD_BYTES,
  LIMIT_INVENTORY,
  MAX_IMAGE_UPLOAD_BYTES as CENTRAL_MAX_IMAGE_UPLOAD_BYTES,
  SLIDE_ASSET_MAX_BYTES,
  SLIDE_ASSET_MAX_DIMENSION_PX,
  SLIDES_HARD_COUNT,
  TOTAL_IMAGE_BUDGET_BYTES,
} from "@/lib/limits";
import { MAX_DECK_SLIDES } from "@/lib/ai/deck-generation-options";
import { MAX_DECK_JSON_BYTES } from "@/lib/limits";
import {
  MAX_IMAGE_UPLOAD_BYTES,
  TOTAL_IMAGE_BUDGET_BYTES as IMAGE_ELEMENT_BUDGET_BYTES,
} from "@/lib/visual/image-element";
import {
  ASSET_MAX_BYTES,
  ASSET_MAX_DIMENSION_PX,
} from "@/lib/slides/asset-upload";
import { MAX_UPLOAD_BYTES, maxBytesForMime } from "@/lib/import/validate";
import {
  budgetExceededDiagnostic,
  checkBudget,
  checkLimit,
  formatBytesAsMb,
  type LimitDefinition,
} from "@/lib/limits/budgets";

describe("central limits boundary", () => {
  test("high-traffic validators import the same central hard caps", () => {
    assert.equal(MAX_DECK_JSON_BYTES, DECK_JSON_MAX_BYTES);
    assert.equal(MAX_DECK_SLIDES, GENERATED_DECK_MAX_SLIDES);

    assert.equal(MAX_UPLOAD_BYTES, IMPORT_MAX_UPLOAD_BYTES);
    assert.equal(
      maxBytesForMime("text/plain"),
      IMPORT_MAX_BYTES_BY_MIME["text/plain"],
    );
    assert.equal(
      maxBytesForMime("application/pdf"),
      IMPORT_MAX_BYTES_BY_MIME["application/pdf"],
    );

    assert.equal(ASSET_MAX_BYTES, SLIDE_ASSET_MAX_BYTES);
    assert.equal(ASSET_MAX_DIMENSION_PX, SLIDE_ASSET_MAX_DIMENSION_PX);

    assert.equal(EXPORT_PREFLIGHT_MAX_SLIDES, SLIDES_HARD_COUNT);
    assert.equal(IMAGE_ELEMENT_BUDGET_BYTES, TOTAL_IMAGE_BUDGET_BYTES);
    assert.equal(MAX_IMAGE_UPLOAD_BYTES, CENTRAL_MAX_IMAGE_UPLOAD_BYTES);
    assert.equal(TOTAL_IMAGE_BUDGET_BYTES, INLINE_IMAGE_HARD_BYTES);
  });

  test("inventory marks every entry as enforcement or warning-only", () => {
    assert.ok(LIMIT_INVENTORY.length >= 20);
    const ids = new Set<string>();
    for (const limit of LIMIT_INVENTORY) {
      assert.ok(limit.id);
      assert.ok(!ids.has(limit.id), `duplicate limit id ${limit.id}`);
      ids.add(limit.id);
      assert.ok(limit.value > 0);
      assert.ok(
        limit.enforcement === "enforced" || limit.enforcement === "warning",
      );
      assert.ok(limit.diagnostic.scope);
      assert.ok(limit.diagnostic.metric);
    }
  });
});

describe("checkBudget threshold table", () => {
  const metric = "table-metric";
  const warnAt = 100;
  const hardAt = 200;

  const cases: Array<{
    name: string;
    actual: number;
    exceeded: boolean;
    warned: boolean;
  }> = [
    { name: "below warning", actual: 50, exceeded: false, warned: false },
    {
      name: "equal to warnAt (boundary, not yet warned)",
      actual: warnAt,
      exceeded: false,
      warned: false,
    },
    { name: "inside warning band", actual: 150, exceeded: false, warned: true },
    {
      name: "equal to hardAt (boundary, warned but not exceeded)",
      actual: hardAt,
      exceeded: false,
      warned: true,
    },
    { name: "exceeded hard limit", actual: 201, exceeded: true, warned: false },
  ];

  for (const { name, actual, exceeded, warned } of cases) {
    test(name, () => {
      const result = checkBudget(metric, actual, warnAt, hardAt);
      assert.deepEqual(result, {
        metric,
        actual,
        warnAt,
        hardAt,
        exceeded,
        warned,
      });
    });
  }
});

describe("checkLimit", () => {
  function makeLimit(
    overrides: Partial<LimitDefinition> = {},
  ): LimitDefinition {
    return {
      id: "limit-under-test",
      description: "Limit used for enforcement primitive tests.",
      value: 200,
      unit: "bytes",
      enforcement: "enforced",
      diagnostic: { scope: "test-scope", metric: "test-metric" },
      ...overrides,
    };
  }

  test("uses the explicit warnAt when provided", () => {
    const limit = makeLimit({ warnAt: 100 });
    const result = checkLimit(limit, 150);

    assert.equal(result.warnAt, 100);
    assert.equal(result.hardAt, 200);
    assert.equal(result.warned, true);
    assert.equal(result.exceeded, false);
  });

  test("falls back to the hard limit value when warnAt is unset", () => {
    const limit = makeLimit();
    assert.equal(limit.warnAt, undefined);

    const belowValue = checkLimit(limit, 150);
    assert.equal(belowValue.warnAt, limit.value);
    assert.equal(belowValue.warned, false);
    assert.equal(belowValue.exceeded, false);

    const aboveValue = checkLimit(limit, 201);
    assert.equal(aboveValue.warnAt, limit.value);
    assert.equal(aboveValue.warned, false);
    assert.equal(aboveValue.exceeded, true);
  });

  test("carries the limit definition and a diagnostic identity derived from it", () => {
    const limit = makeLimit({ warnAt: 100 });
    const result = checkLimit(limit, 150);

    assert.equal(result.limit, limit);
    assert.deepEqual(result.diagnostic, {
      scope: limit.diagnostic.scope,
      metric: limit.diagnostic.metric,
      actual: 150,
      budget: limit.value,
    });
  });
});

describe("budgetExceededDiagnostic", () => {
  test("maps a limit check's diagnostic identity into a structured diagnostic", () => {
    const limit: LimitDefinition = {
      id: "diagnostic-limit",
      description: "Limit used to exercise the diagnostic mapper.",
      value: 500,
      unit: "count",
      enforcement: "enforced",
      diagnostic: { scope: "diagnostic-scope", metric: "diagnostic-metric" },
    };
    const result = checkLimit(limit, 600);

    const diagnostic = budgetExceededDiagnostic(result);

    assert.deepEqual(diagnostic, {
      code: "BUDGET_EXCEEDED",
      severity: "warning",
      scope: "diagnostic-scope",
      message: "Performance budget exceeded for diagnostic-metric.",
      meta: {
        metric: "diagnostic-metric",
        actual: 600,
        budget: 500,
      },
    });
  });
});

describe("formatBytesAsMb boundaries", () => {
  const oneMb = 1024 * 1024;

  const cases: Array<[string, number, number]> = [
    ["zero bytes", 0, 0],
    ["just under half a MB rounds down", oneMb * 0.49, 0],
    ["exactly one MB", oneMb, 1],
    ["half-MB remainder rounds up", oneMb * 1.5, 2],
    ["ten whole MB", oneMb * 10, 10],
  ];

  for (const [name, bytes, expected] of cases) {
    test(name, () => {
      assert.equal(formatBytesAsMb(bytes), expected);
    });
  }
});
