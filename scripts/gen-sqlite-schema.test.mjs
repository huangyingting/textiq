import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  formatFirstDifference,
  generateSqliteSchema,
  parseOptions,
  runSqliteSchemaCli,
  validateSchemaContractMetadata,
} from "./gen-sqlite-schema.mjs";

test("schema drift gate requires persisted-contract metadata", () => {
  const valid = `
    // Point-in-time snapshot of a document's editable state
    model DocumentVersion {
      contentJson Json
      deckJson Json?
    }
    // The slug derives from slugify(name)
    model Tag {
      slug String
      @@unique([ownerId, slug])
    }
    model WorkspaceMember { role String @default("VIEWER") }
    model InviteLink { role String @default("VIEWER") }
    model InviteLinkUse { role String }
    model Comment {
      // Slide-level anchor fields
      anchorType String?
      anchorNodeId String?
      anchorGeometry Json?
    }
    model Asset {
      // Scope: an asset may be owned by a document, workspace, or brand.
      documentId String?
      workspaceId String?
      brandId String?
    }
  `;

  assert.deepEqual(validateSchemaContractMetadata(valid), []);

  const missing = validateSchemaContractMetadata(
    valid.replace("anchorGeometry Json?", ""),
  );
  assert.deepEqual(missing, ["Comment anchor persisted columns"]);
});

test("SQLite schema generator parses supported CLI options", () => {
  assert.deepEqual(parseOptions(["--check"]), {
    check: true,
    ifSqlite: false,
    stdout: false,
  });
  assert.deepEqual(parseOptions(["--if-sqlite", "--stdout"]), {
    check: false,
    ifSqlite: true,
    stdout: true,
  });

  assert.throws(() => parseOptions(["--check", "--stdout"]), /Use either/);
  assert.throws(() => parseOptions(["--unknown"]), /Unknown option/);
});

test("SQLite schema generator rewrites only the datasource provider", () => {
  const canonical = `
    generator client {
      provider = "prisma-client"
    }
    datasource db {
      provider = "postgresql"
      url = env("DATABASE_URL")
    }
  `;

  const result = generateSqliteSchema(canonical);

  assert.equal(result.from, "postgresql");
  assert.match(result.schema, /datasource db \{[\s\S]*provider = "sqlite"/);
  assert.match(
    result.schema,
    /generator client \{[\s\S]*provider = "prisma-client"/,
  );
});

test("SQLite schema generator preserves secondary generator blocks", () => {
  const canonical = `
    generator client {
      provider = "prisma-client"
      output = "../src/generated/prisma"
    }
    generator billingPostgresTestClient {
      provider = "prisma-client"
      output = "../.test-generated/prisma-postgres-billing"
    }
    datasource db {
      provider = "postgresql"
      url = env("DATABASE_URL")
    }
  `;

  const result = generateSqliteSchema(canonical);

  assert.match(
    result.schema,
    /generator billingPostgresTestClient \{[\s\S]*output = "\.\.\/\.test-generated\/prisma-postgres-billing"/,
  );
  assert.match(result.schema, /datasource db \{[\s\S]*provider = "sqlite"/);
});

test("SQLite schema generator explains missing datasource providers and first diffs", () => {
  assert.throws(
    () => generateSqliteSchema("generator client {}"),
    /Could not find a datasource provider/,
  );

  assert.equal(
    formatFirstDifference("one\ntwo\nthree\n", "one\ntoo\nthree\n"),
    [
      "@@ first difference near line 2 @@",
      "  1: one",
      "- 2: too",
      "+ 2: two",
      "  3: three",
      "  4: ",
    ].join("\n"),
  );
});

const VALID_SCHEMA = `
  // Point-in-time snapshot of a document's editable state
  model DocumentVersion { contentJson Json deckJson Json? }
  // The slug derives from slugify(name)
  model Tag { slug String @@unique([ownerId, slug]) }
  model WorkspaceMember { role String @default("VIEWER") }
  model InviteLink { role String @default("VIEWER") }
  model InviteLinkUse { role String }
  model Comment {
    // Slide-level anchor fields
    anchorType String?
    anchorNodeId String?
    anchorGeometry Json?
  }
  model Asset {
    // Scope: an asset may be owned by a document, workspace, or brand.
    documentId String?
    workspaceId String?
    brandId String?
  }
  datasource db {
    provider = "postgresql"
    url = env("DATABASE_URL")
  }
`;

test("SQLite schema generator CLI supports skip, stdout, check, and write modes", () => {
  const output = [];
  const errors = [];
  let exitCode = 0;
  let written = null;
  const sqliteSchema = generateSqliteSchema(VALID_SCHEMA).schema;
  const io = {
    readFile: (filePath) =>
      String(filePath).includes("sqlite") ? sqliteSchema : VALID_SCHEMA,
    writeFile: (_filePath, content) => {
      written = content;
    },
    stdout: { write: (message) => output.push(message) },
    stderr: { write: (message) => errors.push(message) },
    setExitCode: (code) => {
      exitCode = code;
    },
    paths: {
      canonicalPath: "schema.prisma",
      sqlitePath: "schema.sqlite.prisma",
    },
  };

  runSqliteSchemaCli({
    ...io,
    argv: ["--if-sqlite"],
    env: { DB_PROVIDER: "postgres" },
  });
  runSqliteSchemaCli({ ...io, argv: ["--stdout"], env: {} });
  runSqliteSchemaCli({ ...io, argv: ["--check"], env: {} });
  runSqliteSchemaCli({ ...io, argv: [], env: {} });

  assert.match(output.join(""), /Skipping SQLite schema generation/);
  assert.match(output.join(""), /provider = "sqlite"/);
  assert.match(output.join(""), /matches generated output/);
  assert.match(output.join(""), /Generated prisma\/schema\.sqlite\.prisma/);
  assert.equal(written, sqliteSchema);
  assert.deepEqual(errors, []);
  assert.equal(exitCode, 0);
});

test("SQLite schema generator CLI reports stale output and metadata failures", () => {
  const errors = [];
  const output = [];
  const exits = [];
  const io = {
    stdout: { write: (message) => output.push(message) },
    stderr: { write: (message) => errors.push(message) },
    setExitCode: (code) => exits.push(code),
    paths: {
      canonicalPath: "schema.prisma",
      sqlitePath: "schema.sqlite.prisma",
    },
  };

  runSqliteSchemaCli({
    ...io,
    argv: ["--check"],
    env: {},
    readFile: (filePath) =>
      String(filePath).includes("sqlite") ? "stale" : VALID_SCHEMA,
  });
  runSqliteSchemaCli({
    ...io,
    argv: ["--check"],
    env: {},
    readFile: (filePath) =>
      String(filePath).includes("sqlite")
        ? generateSqliteSchema(VALID_SCHEMA.replace("anchorGeometry Json?", ""))
            .schema
        : VALID_SCHEMA.replace("anchorGeometry Json?", ""),
  });

  assert.deepEqual(exits, [1, 1]);
  assert.match(errors.join(""), /schema\.sqlite\.prisma is stale/);
  assert.match(errors.join(""), /missing persisted-contract metadata/);

  const originalExitCode = process.exitCode;
  try {
    process.exitCode = 0;
    runSqliteSchemaCli({
      argv: ["--check"],
      env: {},
      readFile: (filePath) =>
        String(filePath).includes("sqlite") ? "stale" : VALID_SCHEMA,
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      paths: {
        canonicalPath: "schema.prisma",
        sqlitePath: "schema.sqlite.prisma",
      },
    });
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = originalExitCode;
  }
});

test("SQLite schema generator executable skips when postgres-only guard applies", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/gen-sqlite-schema.mjs", "--if-sqlite"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DB_PROVIDER: "postgres" },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Skipping SQLite schema generation/);
});
