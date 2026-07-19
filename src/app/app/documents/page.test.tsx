/**
 * Direct coverage for the bare `/app/documents` index page (issue #2022): it
 * exists solely to permanently redirect to `/app` (the real documents list),
 * so `/app/documents` no longer falls through to the 404 boundary while
 * `/app/documents/[id]` is unaffected.
 *
 * `next/navigation` is stubbed via `@/test/module-stub` so `redirect()` is
 * observable — it records the target and throws Next's `NEXT_REDIRECT`
 * control-flow signal — instead of depending on the framework runtime (the
 * same technique as `src/app/forgot-password/page.test.tsx`). The page is
 * dynamically imported after the stub is registered so its `next/navigation`
 * import resolves to the stub.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, test } from "node:test";

import { stubModule } from "@/test/module-stub";

type NavTestState = { redirectCalls: string[] };

const globalForNav = globalThis as typeof globalThis & {
  __documentsIndexPageNavState: NavTestState;
};

function resetNavState(): void {
  globalForNav.__documentsIndexPageNavState = { redirectCalls: [] };
}
resetNavState();

stubModule(
  "next/navigation",
  `module.exports = {
  redirect: (url) => {
    globalThis.__documentsIndexPageNavState.redirectCalls.push(url);
    throw new Error("NEXT_REDIRECT:" + url);
  },
};`,
);

let DocumentsIndexPage: typeof import("./page").default;
before(async () => {
  DocumentsIndexPage = (await import("./page")).default;
});

beforeEach(resetNavState);

describe("DocumentsIndexPage", () => {
  test("permanently redirects the bare /app/documents route to the /app list", () => {
    assert.throws(() => DocumentsIndexPage(), /NEXT_REDIRECT:\/app/);
    assert.deepEqual(globalForNav.__documentsIndexPageNavState.redirectCalls, [
      "/app",
    ]);
  });

  test("redirects to exactly /app, never a nested /app/documents path", () => {
    try {
      DocumentsIndexPage();
    } catch {
      // The redirect throws NEXT_REDIRECT by design; the target is asserted below.
    }
    assert.deepEqual(globalForNav.__documentsIndexPageNavState.redirectCalls, [
      "/app",
    ]);
  });
});
