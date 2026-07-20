import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACCEPTED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  formatValidationError,
  maxBytesForMime,
  resolveImportMime,
  validateImportFile,
} from "./validate";

// ── resolveImportMime ───────────────────────────────────────────────────────

test("resolveImportMime accepts known MIME types directly", () => {
  assert.equal(resolveImportMime("text/markdown", "doc.md"), "text/markdown");
  assert.equal(resolveImportMime("text/html", "page.html"), "text/html");
  assert.equal(
    resolveImportMime(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "doc.docx",
    ),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(
    resolveImportMime("application/pdf", "report.pdf"),
    "application/pdf",
  );
});

test("resolveImportMime falls back to file extension for octet-stream", () => {
  assert.equal(
    resolveImportMime("application/octet-stream", "doc.docx"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(
    resolveImportMime("application/octet-stream", "slides.pptx"),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
  assert.equal(
    resolveImportMime("application/octet-stream", "report.pdf"),
    "application/pdf",
  );
});

test("resolveImportMime falls back to file extension for empty browser MIME", () => {
  assert.equal(resolveImportMime("", "report.pdf"), "application/pdf");
});

test("resolveImportMime rejects conflicting specific MIME despite supported extension", () => {
  assert.equal(resolveImportMime("image/png", "report.pdf"), null);
});

test("resolveImportMime returns null for unsupported types and extensions", () => {
  assert.equal(resolveImportMime("image/png", "photo.png"), null);
  assert.equal(resolveImportMime("application/octet-stream", "data.xyz"), null);
  assert.equal(resolveImportMime("text/csv", "sheet.csv"), null);
});

test("resolveImportMime is case-insensitive for extensions", () => {
  assert.equal(
    resolveImportMime("application/octet-stream", "DOC.DOCX"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(
    resolveImportMime("application/octet-stream", "file.PDF"),
    "application/pdf",
  );
});

test("resolveImportMime strips MIME type parameters (e.g. charset)", () => {
  assert.equal(
    resolveImportMime("text/html; charset=utf-8", "page.html"),
    "text/html",
  );
});

// ── validateImportFile ──────────────────────────────────────────────────────

test("validateImportFile accepts valid markdown file", () => {
  const result = validateImportFile("text/markdown", "notes.md", 1024);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mime, "text/markdown");
  }
});

test("validateImportFile accepts valid PDF file", () => {
  const result = validateImportFile("application/pdf", "report.pdf", 512000);
  assert.equal(result.ok, true);
});

test("validateImportFile rejects oversized files", () => {
  const result = validateImportFile(
    "application/pdf",
    "big.pdf",
    MAX_UPLOAD_BYTES + 1,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "file_too_large");
    if (result.error.code === "file_too_large") {
      assert.equal(result.error.maxBytes, MAX_UPLOAD_BYTES);
      assert.ok(result.error.actualBytes > MAX_UPLOAD_BYTES);
    }
  }
});

test("validateImportFile rejects exactly at the limit (allowed)", () => {
  const result = validateImportFile(
    "application/pdf",
    "ok.pdf",
    MAX_UPLOAD_BYTES,
  );
  assert.equal(result.ok, true);
});

test("validateImportFile enforces the tighter per-type limit for text formats", () => {
  const textMax = maxBytesForMime("text/plain");
  assert.ok(textMax < MAX_UPLOAD_BYTES);

  const atLimit = validateImportFile("text/plain", "ok.md", textMax);
  assert.equal(atLimit.ok, true);

  const overLimit = validateImportFile("text/markdown", "big.md", textMax + 1);
  assert.equal(overLimit.ok, false);
  if (!overLimit.ok) {
    assert.equal(overLimit.error.code, "file_too_large");
    if (overLimit.error.code === "file_too_large") {
      assert.equal(overLimit.error.maxBytes, textMax);
    }
  }
});

test("validateImportFile reports unsupported_type before checking size", () => {
  // An unsupported type that is also oversized is reported as unsupported.
  const result = validateImportFile(
    "image/jpeg",
    "huge.jpg",
    MAX_UPLOAD_BYTES * 2,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unsupported_type");
  }
});

test("validateImportFile rejects unsupported MIME type with no matching extension", () => {
  const result = validateImportFile("image/jpeg", "photo.jpg", 1024);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unsupported_type");
    if (result.error.code === "unsupported_type") {
      // accepted list must include the expected types
      assert.ok(result.error.accepted.includes("text/markdown"));
      assert.ok(result.error.accepted.includes("application/pdf"));
    }
  }
});

test("validateImportFile resolves via extension when MIME is octet-stream", () => {
  const result = validateImportFile(
    "application/octet-stream",
    "presentation.pptx",
    4096,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(
      result.mime,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  }
});

test("validateImportFile rejects conflicting specific MIME before extension fallback", () => {
  const result = validateImportFile("image/png", "report.pdf", 1024);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unsupported_type");
  }
});

// ── formatValidationError ───────────────────────────────────────────────────

test("formatValidationError returns friendly message for unsupported type", () => {
  const msg = formatValidationError({
    code: "unsupported_type",
    accepted: ACCEPTED_MIME_TYPES,
  });
  assert.ok(msg.toLowerCase().includes("unsupported"));
  assert.ok(
    msg.toLowerCase().includes(".md") ||
      msg.toLowerCase().includes("markdown") ||
      msg.toLowerCase().includes(".docx"),
  );
});

test("formatValidationError returns friendly message for oversized file", () => {
  const msg = formatValidationError({
    code: "file_too_large",
    maxBytes: MAX_UPLOAD_BYTES,
    actualBytes: MAX_UPLOAD_BYTES + 1,
  });
  assert.ok(
    msg.toLowerCase().includes("large") || msg.toLowerCase().includes("size"),
  );
  assert.ok(msg.includes("20"));
});
