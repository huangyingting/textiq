import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  classifyPageRoute,
  pageRouteAccessManifest,
} from "@/lib/auth/page-route-access-manifest";
import {
  authorizeRouteAccess,
  isAuthPageRoute,
  isProtectedRoute,
  isProxyRouteMatched,
  isPublicRoute,
  routeProtectionPolicy,
} from "@/lib/auth/route-protection-policy";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const APP_DIR = join(REPO_ROOT, "src", "app");

function direntParentPath(entry: unknown): string {
  return (entry as unknown as { parentPath: string }).parentPath;
}

function routeFromAppFile(filePath: string): string | null {
  const rel = relative(APP_DIR, filePath).split(sep).join("/");
  if (rel === "page.tsx") return "/";
  if (rel === "signout/route.ts") return "/signout";
  if (!rel.endsWith("/page.tsx")) return null;
  return `/${rel.slice(0, -"/page.tsx".length)}`;
}

function collectPageRoutes(): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(APP_DIR, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const parent = direntParentPath(entry);
    const route = routeFromAppFile(join(parent, entry.name));
    if (route && !route.startsWith("/api/")) {
      routes.push(route);
    }
  }
  return routes.sort();
}

test("#986: page access manifest classifies every app page surface", () => {
  const unclassified = collectPageRoutes().filter(
    (route) => !classifyPageRoute(route),
  );

  assert.deepEqual(unclassified, []);
});

test("#986: manifest covers named protected, auth, share, and asset surfaces", () => {
  const expectations = new Map([
    ["/app", "authenticated-session"],
    ["/app/documents/[id]", "authenticated-session"],
    ["/login", "auth-page"],
    ["/signup", "auth-page"],
    ["/share/[shareId]", "share-policy"],
    ["/embed/[shareId]", "share-policy"],
    ["/present/[shareId]", "share-policy"],
    ["/present/[shareId]/embed", "share-policy"],
    ["/reset-password", "auth-page"],
    ["/verify-email/[token]", "auth-page"],
    ["/signout", "auth-page"],
    ["/_next/static/chunk.js", "public-asset"],
  ]);

  for (const [route, classification] of expectations) {
    assert.equal(
      classifyPageRoute(route)?.classification,
      classification,
      route,
    );
  }
});

test("#986: page access manifest proxy flags stay in sync with proxy policy", () => {
  for (const entry of pageRouteAccessManifest) {
    const sample =
      entry.match === "prefix" && !entry.pattern.includes(".")
        ? `${entry.pattern}/sample`
        : entry.pattern;
    assert.equal(
      entry.proxy === "matched",
      isProxyRouteMatched(sample),
      `${entry.pattern} proxy flag drifted`,
    );
  }
});

test("route protection policy classifies pages and redirects authenticated auth pages", () => {
  assert.equal(
    routeProtectionPolicy.proxy.excludedPaths.includes("/favicon.ico"),
    true,
  );
  assert.equal(isProtectedRoute("/app/documents"), true);
  assert.equal(isAuthPageRoute("/login"), true);
  assert.equal(isPublicRoute("/"), true);
  assert.equal(isProxyRouteMatched("/api/auth/session"), false);

  const result = authorizeRouteAccess({
    isLoggedIn: true,
    nextUrl: new URL("https://textiq.example/login"),
  });
  assert.ok(result instanceof Response);
  assert.equal(result.status, 302);
  assert.equal(result.headers.get("location"), "https://textiq.example/app");
});
