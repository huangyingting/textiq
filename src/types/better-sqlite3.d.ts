// `better-sqlite3` ships no bundled `.d.ts` and no `@types/better-sqlite3`
// package is installed in this repo. This ambient declaration is
// intentionally scoped to only the API surface exercised by the real-SQLite
// invite-link purge branch-semantics tests in
// `src/lib/document/trash.test.ts`.
declare module "better-sqlite3" {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement {
    run(...params: unknown[]): RunResult;
    all(...params: unknown[]): unknown[];
  }

  class Database {
    constructor(filename: string);
    exec(sql: string): this;
    prepare(sql: string): Statement;
    close(): this;
  }

  export = Database;
}
