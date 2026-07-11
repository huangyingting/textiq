/**
 * Behavior contracts for route-protection-policy.ts (#1866).
 *
 * All exports are pure (no I/O, no DB) — node:test + node:assert/strict.
 * Tests assert policy results and redirect targets; internal arrays are not
 * inspected and the implementation is not duplicated.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  authorizeRouteAccess,
  isAuthPageRoute,
  isProtectedRoute,
  isProxyRouteMatched,
  isPublicRoute,
  routeProtectionPolicy,
} from "@/lib/auth/route-protection-policy";

// ---------------------------------------------------------------------------
// routeProtectionPolicy constant (#1866)
// ---------------------------------------------------------------------------

describe("routeProtectionPolicy constant (#1866)", () => {
  test("authenticatedHome is /app", () => {
    assert.equal(routeProtectionPolicy.authenticatedHome, "/app");
  });

  test("signIn is /login", () => {
    assert.equal(routeProtectionPolicy.signIn, "/login");
  });
});

// ---------------------------------------------------------------------------
// isProtectedRoute (#1866)
// ---------------------------------------------------------------------------

describe("isProtectedRoute (#1866)", () => {
  test("/app is protected (prefix root matches itself)", () => {
    assert.equal(isProtectedRoute("/app"), true);
  });

  test("/app/documents/123 is protected (deep prefix)", () => {
    assert.equal(isProtectedRoute("/app/documents/123"), true);
  });

  test("/app/ is protected (trailing slash)", () => {
    assert.equal(isProtectedRoute("/app/"), true);
  });

  test("/app/settings/billing is protected", () => {
    assert.equal(isProtectedRoute("/app/settings/billing"), true);
  });

  test("/ is not protected", () => {
    assert.equal(isProtectedRoute("/"), false);
  });

  test("/login is not protected", () => {
    assert.equal(isProtectedRoute("/login"), false);
  });

  test("/signup is not protected", () => {
    assert.equal(isProtectedRoute("/signup"), false);
  });

  // Segment-boundary: /application must NOT be protected — it is not a
  // sub-path of /app.  Plain startsWith("/app") incorrectly matches it.
  test("/application is NOT protected (segment boundary, not a sub-path of /app)", () => {
    assert.equal(isProtectedRoute("/application"), false);
  });

  test("/appx is NOT protected (segment boundary, no slash separator)", () => {
    assert.equal(isProtectedRoute("/appx"), false);
  });
});

// ---------------------------------------------------------------------------
// isAuthPageRoute (#1866)
// ---------------------------------------------------------------------------

describe("isAuthPageRoute (#1866)", () => {
  test("/login is an auth page route (exact match)", () => {
    assert.equal(isAuthPageRoute("/login"), true);
  });

  test("/signup is an auth page route (exact match)", () => {
    assert.equal(isAuthPageRoute("/signup"), true);
  });

  test("/app is not an auth page route", () => {
    assert.equal(isAuthPageRoute("/app"), false);
  });

  test("/ is not an auth page route", () => {
    assert.equal(isAuthPageRoute("/"), false);
  });

  test("/login/extra is not an auth page route (exact only, no sub-paths)", () => {
    assert.equal(isAuthPageRoute("/login/extra"), false);
  });

  test("/signup/confirm is not an auth page route (exact only, no sub-paths)", () => {
    assert.equal(isAuthPageRoute("/signup/confirm"), false);
  });

  test("/loginx is not an auth page route (not a prefix match)", () => {
    assert.equal(isAuthPageRoute("/loginx"), false);
  });
});

// ---------------------------------------------------------------------------
// isPublicRoute (#1866)
// ---------------------------------------------------------------------------

describe("isPublicRoute (#1866)", () => {
  test("/ is a public route (exact match)", () => {
    assert.equal(isPublicRoute("/"), true);
  });

  test("/about is not a public route", () => {
    assert.equal(isPublicRoute("/about"), false);
  });

  test("/app is not a public route", () => {
    assert.equal(isPublicRoute("/app"), false);
  });

  test("/login is not a public route (auth-page, not public)", () => {
    assert.equal(isPublicRoute("/login"), false);
  });
});

// ---------------------------------------------------------------------------
// authorizeRouteAccess (#1866)
// ---------------------------------------------------------------------------

describe("authorizeRouteAccess — protected routes (#1866)", () => {
  test("protected route + unauthenticated → false (deny)", () => {
    const result = authorizeRouteAccess({
      isLoggedIn: false,
      nextUrl: new URL("http://h/app"),
    });
    assert.equal(result, false);
  });

  test("protected route + authenticated → true (allow)", () => {
    const result = authorizeRouteAccess({
      isLoggedIn: true,
      nextUrl: new URL("http://h/app"),
    });
    assert.equal(result, true);
  });

  test("protected sub-route + unauthenticated → false (deny)", () => {
    const result = authorizeRouteAccess({
      isLoggedIn: false,
      nextUrl: new URL("http://h/app/documents/abc"),
    });
    assert.equal(result, false);
  });

  test("protected sub-route + authenticated → true (allow)", () => {
    const result = authorizeRouteAccess({
      isLoggedIn: true,
      nextUrl: new URL("http://h/app/documents/abc"),
    });
    assert.equal(result, true);
  });
});

describe("authorizeRouteAccess — auth page routes (#1866)", () => {
  test("/login + authenticated → Response redirect to authenticatedHome", () => {
    const result = authorizeRouteAccess({
      isLoggedIn: true,
      nextUrl: new URL("https://textiq.example/login"),
    });
    assert.ok(result instanceof Response, "expected a Response redirect");
    assert.equal(result.status, 302);
    assert.equal(
      result.headers.get("location"),
      `https://textiq.example${routeProtectionPolicy.authenticatedHome}`,
    );
  });

  test("/signup + authenticated → Response redirect to authenticatedHome", () => {
    const result = authorizeRouteAccess({
      isLoggedIn: true,
      nextUrl: new URL("https://textiq.example/signup"),
    });
    assert.ok(result instanceof Response, "expected a Response redirect");
    assert.equal(result.status, 302);
    assert.equal(
      result.headers.get("location"),
      `https://textiq.example${routeProtectionPolicy.authenticatedHome}`,
    );
  });

  test("redirect preserves the request origin", () => {
    const result = authorizeRouteAccess({
      isLoggedIn: true,
      nextUrl: new URL("https://app.textiq.com/login"),
    });
    assert.ok(result instanceof Response);
    assert.equal(
      result.headers.get("location"),
      `https://app.textiq.com${routeProtectionPolicy.authenticatedHome}`,
    );
  });

  test("/login + unauthenticated → true (allow through to login form)", () => {
    const result = authorizeRouteAccess({
      isLoggedIn: false,
      nextUrl: new URL("http://h/login"),
    });
    assert.equal(result, true);
  });

  test("/signup + unauthenticated → true (allow through to signup form)", () => {
    const result = authorizeRouteAccess({
      isLoggedIn: false,
      nextUrl: new URL("http://h/signup"),
    });
    assert.equal(result, true);
  });
});

describe("authorizeRouteAccess — unclassified routes default allow (#1866)", () => {
  test("unknown route + unauthenticated → true (default allow)", () => {
    const result = authorizeRouteAccess({
      isLoggedIn: false,
      nextUrl: new URL("http://h/some-public-page"),
    });
    assert.equal(result, true);
  });

  test("unknown route + authenticated → true (default allow)", () => {
    const result = authorizeRouteAccess({
      isLoggedIn: true,
      nextUrl: new URL("http://h/some-page"),
    });
    assert.equal(result, true);
  });

  test("/ (public root) + unauthenticated → true (default allow, not protected)", () => {
    const result = authorizeRouteAccess({
      isLoggedIn: false,
      nextUrl: new URL("http://h/"),
    });
    assert.equal(result, true);
  });

  test("/ (public root) + authenticated → true (default allow, not protected)", () => {
    const result = authorizeRouteAccess({
      isLoggedIn: true,
      nextUrl: new URL("http://h/"),
    });
    assert.equal(result, true);
  });
});

// ---------------------------------------------------------------------------
// isProxyRouteMatched (#1866)
// ---------------------------------------------------------------------------

describe("isProxyRouteMatched — excluded paths (#1866)", () => {
  test("/favicon.ico is excluded (exact excluded path)", () => {
    assert.equal(isProxyRouteMatched("/favicon.ico"), false);
  });
});

describe("isProxyRouteMatched — excluded prefixes (#1866)", () => {
  test("/api is excluded (api prefix exact)", () => {
    assert.equal(isProxyRouteMatched("/api"), false);
  });

  test("/api/foo is excluded (api prefix)", () => {
    assert.equal(isProxyRouteMatched("/api/foo"), false);
  });

  test("/api/auth/session is excluded (api prefix deep)", () => {
    assert.equal(isProxyRouteMatched("/api/auth/session"), false);
  });

  test("/_next/static is excluded (_next/static prefix exact)", () => {
    assert.equal(isProxyRouteMatched("/_next/static"), false);
  });

  test("/_next/static/chunk.js is excluded (_next/static prefix)", () => {
    assert.equal(isProxyRouteMatched("/_next/static/chunk.js"), false);
  });

  test("/_next/image is excluded (_next/image prefix exact)", () => {
    assert.equal(isProxyRouteMatched("/_next/image"), false);
  });

  test("/_next/image/transform is excluded (_next/image prefix)", () => {
    assert.equal(isProxyRouteMatched("/_next/image/transform"), false);
  });
});

describe("isProxyRouteMatched — matched routes (#1866)", () => {
  test("/app is matched (not excluded)", () => {
    assert.equal(isProxyRouteMatched("/app"), true);
  });

  test("/ is matched (not excluded)", () => {
    assert.equal(isProxyRouteMatched("/"), true);
  });

  test("/login is matched (not excluded)", () => {
    assert.equal(isProxyRouteMatched("/login"), true);
  });

  test("/signup is matched (not excluded)", () => {
    assert.equal(isProxyRouteMatched("/signup"), true);
  });

  test("/share/abc is matched (not excluded)", () => {
    assert.equal(isProxyRouteMatched("/share/abc"), true);
  });

  // Segment-boundary: /apiary must NOT be excluded by the /api prefix.
  test("/apiary is matched (not excluded — segment boundary, /api prefix must not bleed)", () => {
    assert.equal(isProxyRouteMatched("/apiary"), true);
  });

  test("/_next/staticfoo is matched (not excluded — segment boundary)", () => {
    assert.equal(isProxyRouteMatched("/_next/staticfoo"), true);
  });

  test("/_next/imagefoo is matched (not excluded — segment boundary)", () => {
    assert.equal(isProxyRouteMatched("/_next/imagefoo"), true);
  });
});
