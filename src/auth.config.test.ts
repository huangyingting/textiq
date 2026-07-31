import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { authConfig } from "./auth.config";
import {
  isAuthPageRoute,
  isProtectedRoute,
  isPublicRoute,
  routeProtectionPolicy,
} from "./lib/auth/route-protection-policy";

const authorized = authConfig.callbacks!.authorized!;

type AuthorizedArg = Parameters<typeof authorized>[0];

function callAuthorized(isLoggedIn: boolean, pathname: string) {
  return authorized({
    auth: isLoggedIn ? ({ user: { id: "u1" } } as never) : null,
    request: { nextUrl: new URL(`http://localhost${pathname}`) },
  } as AuthorizedArg);
}

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const forbiddenEdgeImports = [
  "bcryptjs",
  "@/lib/auth/password",
  "@/lib/auth/credentials-service",
  "@/lib/auth/oauth-user-service",
  "@/lib/prisma",
  "@/auth",
  "next-auth/providers/credentials",
  "next-auth/providers/google",
  "@prisma/client",
];

function runtimeImports(source: string): string[] {
  const imports: string[] = [];
  const importFromPattern =
    /^\s*import\s+(?!type\b)[\s\S]*?\sfrom\s*["']([^"']+)["'];?/gm;
  const sideEffectImportPattern =
    /^\s*import\s+(?!type\b)\s*["']([^"']+)["'];?/gm;
  const exportFromPattern =
    /^\s*export\s+(?!type\b)[\s\S]*?\sfrom\s*["']([^"']+)["'];?/gm;

  for (const pattern of [
    importFromPattern,
    sideEffectImportPattern,
    exportFromPattern,
  ]) {
    for (const match of source.matchAll(pattern)) {
      imports.push(match[1]);
    }
  }

  return imports;
}

function resolveLocalImport(
  fromFile: string,
  specifier: string,
): string | null {
  const base = specifier.startsWith("@/")
    ? join(SRC_DIR, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (!base) {
    return null;
  }

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function collectRuntimeImportGraph(entryFile: string): {
  files: string[];
  violations: string[];
} {
  const pending = [entryFile];
  const visited = new Set<string>();
  const violations: string[] = [];

  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) {
      continue;
    }
    visited.add(file);

    const source = readFileSync(file, "utf8");
    for (const specifier of runtimeImports(source)) {
      if (
        specifier.startsWith("node:") ||
        forbiddenEdgeImports.includes(specifier) ||
        specifier.includes("/generated/prisma/")
      ) {
        violations.push(`${relative(SRC_DIR, file)} -> ${specifier}`);
      }

      const local = resolveLocalImport(file, specifier);
      if (local) {
        pending.push(local);
      }
    }
  }

  return {
    files: Array.from(visited, (file) => relative(SRC_DIR, file)).sort(),
    violations,
  };
}

test("redirects signed-out users away from protected /app routes", () => {
  // Returning `false` instructs Auth.js to redirect to the sign-in page with a
  // `callbackUrl` back to the originally requested protected route.
  assert.equal(callAuthorized(false, "/app/settings/billing"), false);
  assert.equal(callAuthorized(false, "/app"), false);
});

test("allows signed-in users into protected /app routes", () => {
  assert.equal(callAuthorized(true, "/app/settings/billing"), true);
  assert.equal(callAuthorized(true, "/app"), true);
});

test("allows everyone through public routes", () => {
  assert.equal(callAuthorized(false, "/"), true);
  assert.equal(callAuthorized(false, "/login"), true);
  assert.equal(callAuthorized(false, "/signup"), true);
});

test("redirects signed-in users away from the auth pages", () => {
  for (const path of ["/login", "/signup"]) {
    const result = callAuthorized(true, path);
    assert.ok(result instanceof Response, `${path} should redirect`);
    assert.ok(
      (result as Response).status >= 300 && (result as Response).status < 400,
    );
    assert.equal(
      (result as Response).headers.get("location"),
      "http://localhost/app",
    );
  }
});

test("auth config uses the shared route protection policy data", () => {
  assert.equal(authConfig.pages?.signIn, routeProtectionPolicy.signIn);
  assert.equal(authConfig.pages?.error, routeProtectionPolicy.signIn);
  assert.equal(isProtectedRoute("/app/settings"), true);
  assert.equal(isProtectedRoute("/"), false);
  assert.equal(isAuthPageRoute("/login"), true);
  assert.equal(isAuthPageRoute("/signup"), true);
  assert.equal(isAuthPageRoute("/app"), false);
  assert.equal(isPublicRoute("/"), true);
  assert.equal(isPublicRoute("/app"), false);
});

test("auth logger suppresses recoverable JWT session decode errors", () => {
  const calls: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    const error = Object.assign(new Error("stale session cookie"), {
      name: "JWTSessionError",
      type: "JWTSessionError",
    });

    authConfig.logger?.error?.(error);

    assert.deepEqual(calls, []);
  } finally {
    console.error = originalConsoleError;
  }
});

test("auth logger suppresses expected invalid-credential errors", () => {
  const calls: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    const error = Object.assign(new Error("credentials rejected"), {
      name: "CredentialsSignin",
      type: "CredentialsSignin",
    });

    authConfig.logger?.error?.(error);

    assert.deepEqual(calls, []);
  } finally {
    console.error = originalConsoleError;
  }
});

test("auth logger forwards non-JWT auth errors", () => {
  const calls: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    const error = new Error("auth misconfigured");

    authConfig.logger?.error?.(error);

    assert.deepEqual(calls, [[error]]);
  } finally {
    console.error = originalConsoleError;
  }
});

test("edge-safe auth config runtime imports stay free of Prisma, bcrypt, and providers", () => {
  const graph = collectRuntimeImportGraph(join(SRC_DIR, "auth.config.ts"));

  assert.deepEqual(graph.violations, []);
  assert.deepEqual(graph.files, [
    "auth.config.ts",
    "lib/auth/route-protection-policy.ts",
  ]);
});
