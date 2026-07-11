import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyPageRoute,
  pageRouteAccessManifest,
} from "@/lib/auth/page-route-access-manifest";
import {
  isProxyRouteMatched,
  routeProtectionPolicy,
} from "@/lib/auth/route-protection-policy";

import { config, proxy } from "./proxy";

function proxyMatcherAllows(pathname: string): boolean {
  const [matcher] = config.matcher;
  const regex = new RegExp(`^${matcher}$`);
  return regex.test(pathname);
}

test("proxy matcher is explicit and sourced from the shared route policy", () => {
  assert.deepEqual(config.matcher, routeProtectionPolicy.proxy.matcher);
  assert.deepEqual(config.matcher, [
    "/((?!api(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon.ico).*)",
  ]);
});

test("proxy exports the NextAuth proxy handler", () => {
  assert.equal(typeof proxy, "function");
});

test("proxy matcher excludes API, Next static/image, and favicon routes", () => {
  for (const path of [
    "/api/auth/session",
    "/api",
    "/_next/static/chunk.js",
    "/_next/static",
    "/_next/image",
    "/favicon.ico",
  ]) {
    assert.equal(proxyMatcherAllows(path), false, path);
    assert.equal(isProxyRouteMatched(path), false, path);
  }
});

test("proxy matcher includes public, auth, and protected page routes", () => {
  for (const path of [
    "/",
    "/login",
    "/signup",
    "/app",
    "/app/settings",
    // Segment-boundary: /apiary must not be excluded by the /api prefix.
    "/apiary",
    "/_next/staticfoo",
    "/_next/imagefoo",
  ]) {
    assert.equal(proxyMatcherAllows(path), true, path);
    assert.equal(isProxyRouteMatched(path), true, path);
  }
});

test("proxy matcher remains synced with the page route access manifest", () => {
  for (const entry of pageRouteAccessManifest) {
    assert.equal(classifyPageRoute(entry.pattern)?.pattern, entry.pattern);
    assert.equal(
      isProxyRouteMatched(entry.pattern),
      entry.proxy === "matched",
      entry.pattern,
    );
  }
});
