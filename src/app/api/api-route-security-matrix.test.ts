/**
 * Guard test: the API route security matrix must classify every route
 * (Epic #495, issue #509).
 *
 * Every HTTP route under `src/app/api/**​/route.ts` must have a row in
 * `docs/security/api-route-security-matrix.md`. This test globs the filesystem,
 * parses the matrix table, and fails if:
 *   - a filesystem route has no matrix row (you added a route without
 *     classifying it), or
 *   - the matrix lists a route that no longer exists on disk (a stale row).
 *
 * The effect: "add a public surface without documenting how it's gated" fails
 * CI. Routes that intentionally carry no app-level gate live in
 * {@link NO_APP_GATE_ALLOWLIST} so that decision stays explicit and reviewable.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = HERE; // this test lives at src/app/api/
const REPO_ROOT = resolve(API_DIR, "..", "..", "..");
const MATRIX_DOC = join(
  REPO_ROOT,
  "docs",
  "security",
  "api-route-security-matrix.md",
);

/**
 * Routes that legitimately have no app-level gate (only the framework/auth
 * handler). They still REQUIRE a matrix row — this set just records that the
 * "public by design" decision is intentional.
 */
const NO_APP_GATE_ALLOWLIST = new Set<string>(["auth/[...nextauth]"]);
const MATRIX_HEADERS = [
  "Route",
  "Classification",
  "Auth/session",
  "Rate limit",
  "Capability / share / entitlement / signature gate",
  "Denial status / body",
  "Response exception",
  "Owner",
  "Notes",
] as const;
const CLASSIFICATIONS = new Set([
  "public+rate-limited",
  "authenticated-session",
  "document-capability",
  "share-policy",
  "entitlement-gated",
  "webhook-signature",
  "internal-secret",
  "framework-auth",
]);
const RESPONSE_EXCEPTIONS = new Set([
  "None",
  "Binary/plain-text",
  "Framework delegated",
  "Provider contract",
  "Shared {error, code} body",
]);

type MatrixHeader = (typeof MATRIX_HEADERS)[number];
type MatrixRow = Record<MatrixHeader, string>;

function direntParentPath(entry: unknown): string {
  return (entry as unknown as { parentPath: string }).parentPath;
}

/** Recursively collect every `route.ts` file under `src/app/api`. */
function collectRouteKeys(): string[] {
  const keys: string[] = [];
  for (const entry of readdirSync(API_DIR, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || entry.name !== "route.ts") {
      continue;
    }
    // entry.parentPath is the directory holding route.ts.
    const parent = direntParentPath(entry);
    const rel = parent.slice(API_DIR.length).split(sep).filter(Boolean);
    keys.push(rel.join("/"));
  }
  return keys.sort();
}

function splitMarkdownRow(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim().replace(/`/g, ""));
}

/** Parse the route contracts from the matrix table. */
function parseMatrixRows(): MatrixRow[] {
  const md = readFileSync(MATRIX_DOC, "utf8");
  const rows: MatrixRow[] = [];
  let inMatrixSection = false;
  let headers: string[] | null = null;
  for (const line of md.split("\n")) {
    const trimmed = line.trim();
    // Only parse rows inside the "## Matrix" section, so the Classifications
    // legend (which also uses backticked first cells) is never mistaken for a
    // route row.
    if (trimmed.startsWith("## ")) {
      inMatrixSection = trimmed === "## Matrix";
      continue;
    }
    if (!inMatrixSection || !trimmed.startsWith("|")) {
      continue;
    }
    const cells = splitMarkdownRow(trimmed);
    if (!headers) {
      headers = cells;
      continue;
    }
    if (cells.every((cell) => /^-+$/.test(cell))) {
      continue;
    }
    const row = Object.fromEntries(
      MATRIX_HEADERS.map((header, index) => [header, cells[index] ?? ""]),
    ) as MatrixRow;
    if (row.Route) {
      rows.push(row);
    }
  }
  assert.deepEqual(headers, [...MATRIX_HEADERS], "matrix headers drifted");
  return rows;
}

function parseMatrixRouteKeys(): string[] {
  return parseMatrixRows()
    .map((row) => row.Route)
    .sort();
}

test("#509: every filesystem API route has a security-matrix row", () => {
  const fsRoutes = collectRouteKeys();
  const matrixRoutes = new Set(parseMatrixRouteKeys());

  // Sanity: we actually found routes and parsed rows.
  assert.ok(
    fsRoutes.length >= 13,
    `expected ≥13 routes, found ${fsRoutes.length}`,
  );
  assert.ok(matrixRoutes.size >= 13, "matrix parsed too few rows");

  const missing = fsRoutes.filter((r) => !matrixRoutes.has(r));
  assert.deepEqual(
    missing,
    [],
    `routes missing from docs/security/api-route-security-matrix.md: ${missing.join(", ")}`,
  );
});

test("#985: each security-matrix row has a complete validated contract", () => {
  const rows = parseMatrixRows();
  assert.ok(rows.length >= 13, "matrix parsed too few rows");

  for (const row of rows) {
    assert.match(
      row.Route,
      /^[^`|]+$/,
      `route cell is not normalized: ${row.Route}`,
    );
    assert.ok(
      CLASSIFICATIONS.has(row.Classification),
      `${row.Route}: invalid classification ${row.Classification}`,
    );
    assert.notEqual(
      row["Auth/session"],
      "",
      `${row.Route}: missing auth/session`,
    );
    assert.notEqual(row["Rate limit"], "", `${row.Route}: missing rate limit`);
    assert.notEqual(
      row["Capability / share / entitlement / signature gate"],
      "",
      `${row.Route}: missing gate`,
    );
    assert.notEqual(
      row["Denial status / body"],
      "",
      `${row.Route}: missing denial status/body`,
    );
    assert.ok(
      /\b\d{3}\b|Delegated/.test(row["Denial status / body"]),
      `${row.Route}: denial status/body must name a status or delegation`,
    );
    assert.ok(
      RESPONSE_EXCEPTIONS.has(row["Response exception"]),
      `${row.Route}: invalid response exception ${row["Response exception"]}`,
    );
    assert.notEqual(row.Owner, "", `${row.Route}: missing owner`);
  }
});

test("#985: explicit response exceptions are scoped to known route contracts", () => {
  const exceptionRoutes = new Map(
    parseMatrixRows()
      .filter((row) => row["Response exception"] !== "None")
      .map((row) => [row.Route, row["Response exception"]]),
  );

  assert.deepEqual(
    [...exceptionRoutes],
    [
      ["auth/[...nextauth]", "Framework delegated"],
      ["billing/webhook", "Provider contract"],
      ["brand-assets/[ownerId]/[...path]", "Binary/plain-text"],
      ["generate", "Shared {error, code} body"],
      ["generate-deck", "Shared {error, code} body"],
      ["slide-assets/[documentId]/[...path]", "Binary/plain-text"],
    ],
  );
});

test("#509: the security matrix has no stale rows for deleted routes", () => {
  const fsRoutes = new Set(collectRouteKeys());
  const matrixRoutes = parseMatrixRouteKeys();

  const stale = matrixRoutes.filter((r) => !fsRoutes.has(r));
  assert.deepEqual(
    stale,
    [],
    `matrix lists routes that no longer exist on disk: ${stale.join(", ")}`,
  );
});

test("#509: the no-app-gate allowlist only names real routes", () => {
  const fsRoutes = new Set(collectRouteKeys());
  for (const route of NO_APP_GATE_ALLOWLIST) {
    assert.ok(
      fsRoutes.has(route),
      `allowlisted route does not exist on disk: ${route}`,
    );
  }
});
