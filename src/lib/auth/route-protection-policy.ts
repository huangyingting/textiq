/* node:coverage ignore start -- Route pattern type is erased and only appears in source-map coverage. */
type RoutePattern = {
  path: string;
  match: "exact" | "prefix";
};
/* node:coverage ignore stop */

const PROTECTED_ROUTES = [{ path: "/app", match: "prefix" }] as const;
const AUTH_PAGE_ROUTES = [
  { path: "/login", match: "exact" },
  { path: "/signup", match: "exact" },
] as const;
const PUBLIC_ROUTES = [{ path: "/", match: "exact" }] as const;
const PROXY_MATCHER = [
  "/((?!api(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon.ico).*)",
];
const PROXY_EXCLUDED_PREFIXES = ["/api", "/_next/static", "/_next/image"];
const PROXY_EXCLUDED_PATHS = ["/favicon.ico"];

export const routeProtectionPolicy = {
  authenticatedHome: "/app",
  signIn: "/login",
  protectedRoutes: PROTECTED_ROUTES,
  authPageRoutes: AUTH_PAGE_ROUTES,
  publicRoutes: PUBLIC_ROUTES,
  proxy: {
    matcher: PROXY_MATCHER,
    excludedPrefixes: PROXY_EXCLUDED_PREFIXES,
    excludedPaths: PROXY_EXCLUDED_PATHS,
  },
} as const;

function matchesPattern(pathname: string, pattern: RoutePattern): boolean {
  if (pattern.match === "exact") {
    return pathname === pattern.path;
  }

  return pathname === pattern.path || pathname.startsWith(pattern.path + "/");
}

function matchesAny(
  pathname: string,
  patterns: readonly RoutePattern[],
): boolean {
  return patterns.some((pattern) => matchesPattern(pathname, pattern));
}

function includesString(values: readonly string[], value: string): boolean {
  return values.includes(value);
}

export function isProtectedRoute(pathname: string): boolean {
  return matchesAny(pathname, routeProtectionPolicy.protectedRoutes);
}

export function isAuthPageRoute(pathname: string): boolean {
  return matchesAny(pathname, routeProtectionPolicy.authPageRoutes);
}

export function isPublicRoute(pathname: string): boolean {
  return matchesAny(pathname, routeProtectionPolicy.publicRoutes);
}

export function authorizeRouteAccess(input: {
  isLoggedIn: boolean;
  nextUrl: URL;
}): boolean | Response {
  const { isLoggedIn, nextUrl } = input;

  if (isProtectedRoute(nextUrl.pathname)) {
    return isLoggedIn;
  }

  if (isAuthPageRoute(nextUrl.pathname) && isLoggedIn) {
    return Response.redirect(
      new URL(routeProtectionPolicy.authenticatedHome, nextUrl),
    );
  }

  return true;
}

export function isProxyRouteMatched(pathname: string): boolean {
  if (includesString(routeProtectionPolicy.proxy.excludedPaths, pathname)) {
    return false;
  }

  return !routeProtectionPolicy.proxy.excludedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}
