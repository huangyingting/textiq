import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildProductTelemetryEvent,
  bucketBytes,
  bucketCount,
  bucketDurationMs,
  classifyFileType,
  configureProductTelemetrySink,
  emitProductTelemetry,
  PRODUCT_EVENT_DEFINITIONS,
  reasonFromStatus,
} from "./product";

describe("product telemetry taxonomy", () => {
  test("keeps only event-allowed privacy-safe scalar fields", () => {
    const event = buildProductTelemetryEvent(
      "product.import.succeeded",
      {
        fileType: "pdf",
        fileSizeBucket: "100kb-1mb",
        durationBucket: "500ms-1s",
        surface: "toolbar",
        filename: "private-plan.pdf",
        contentJson: "SECRET DOCUMENT TEXT",
      } as Record<string, string>,
      new Date("2026-06-25T00:00:00.000Z"),
    );

    assert.equal(event.eventName, "product.import.succeeded");
    assert.equal(event.timestamp, "2026-06-25T00:00:00.000Z");
    assert.deepEqual(event.fields, {
      fileType: "pdf",
      fileSizeBucket: "100kb-1mb",
      durationBucket: "500ms-1s",
      surface: "toolbar",
    });
    assert.ok(!JSON.stringify(event).includes("private-plan"));
    assert.ok(!JSON.stringify(event).includes("SECRET"));
  });

  test("defines stable product event names", () => {
    for (const eventName of Object.keys(PRODUCT_EVENT_DEFINITIONS)) {
      assert.match(eventName, /^product\.[a-z]+(?:\.[a-z]+)+$/);
    }
  });
});

describe("product telemetry emitter", () => {
  test("defaults to no-op and never throws", () => {
    assert.doesNotThrow(() =>
      emitProductTelemetry("product.export.started", {
        exportKind: "document",
        outputFormat: "pdf",
      }),
    );
  });

  test("uses a configured pluggable sink", () => {
    const events: unknown[] = [];
    const restore = configureProductTelemetrySink((event) => {
      events.push(event);
    });
    try {
      emitProductTelemetry("product.editor.undo", {
        surface: "slide-editor",
        slideCount: 3,
      });
    } finally {
      restore();
    }
    assert.equal(events.length, 1);
    assert.equal(
      (events[0] as { eventName: string }).eventName,
      "product.editor.undo",
    );
  });

  test("swallows synchronous sink throws without propagating to callers", () => {
    const sinkError = new Error("telemetry sink failed synchronously");
    const restore = configureProductTelemetrySink(() => {
      throw sinkError;
    });
    try {
      assert.doesNotThrow(() =>
        emitProductTelemetry("product.editor.command.failed", {
          commandName: "align-left",
          durationBucket: "lt100ms",
          failureReason: "validation",
          status: 400,
          surface: "slide-editor",
        }),
      );
    } finally {
      restore();
    }
  });

  test("swallows async sink rejections without an unhandled rejection", async () => {
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    const sinkError = new Error("telemetry sink failed asynchronously");
    let sinkCalls = 0;
    const restore = configureProductTelemetrySink(() => {
      sinkCalls += 1;
      return Promise.reject(sinkError);
    });
    try {
      assert.doesNotThrow(() =>
        emitProductTelemetry("product.export.failed", {
          exportKind: "document",
          outputFormat: "pdf",
          failureReason: "server",
          status: 500,
        }),
      );
      assert.doesNotThrow(() =>
        emitProductTelemetry("product.export.failed", {
          exportKind: "document",
          outputFormat: "pdf",
          failureReason: "timeout",
          status: 504,
        }),
      );
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    } finally {
      restore();
      process.off("unhandledRejection", onUnhandledRejection);
    }

    assert.equal(sinkCalls, 2);
    assert.deepEqual(unhandledRejections, []);
  });
});

describe("product telemetry bucketing", () => {
  test("buckets durations, bytes, counts, statuses, and file types", () => {
    assert.equal(bucketDurationMs(75), "lt100ms");
    assert.equal(bucketDurationMs(12_000), "10s-30s");
    assert.equal(bucketBytes(0), "zero");
    assert.equal(bucketBytes(150 * 1024), "100kb-1mb");
    assert.equal(bucketCount(7), "6-10");
    assert.equal(reasonFromStatus(429), "rate_limit");
    assert.equal(reasonFromStatus(504), "timeout");
    assert.equal(
      classifyFileType({ name: "confidential roadmap.pdf", type: "" }),
      "pdf",
    );
    assert.equal(
      classifyFileType({ name: "raw-secrets.exe", type: "" }),
      "unknown",
    );
  });
});
