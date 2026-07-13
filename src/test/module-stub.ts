/**
 * Shared helper for stubbing a single ESM specifier with an inline CommonJS
 * module body, via `node:module`'s `registerHooks`.
 *
 * This is the same technique already used ad hoc by
 * `src/app/app/import-document-button.test.tsx` and
 * `src/app/app/new-document-button.test.tsx` (each stubbing their sibling
 * `"./actions"` so the real `"use server"` module — already covered by its
 * own dedicated action tests — never runs its `requireUser`/`prisma`/
 * `next/navigation` dependencies just to mount a UI component). Centralizing
 * it here avoids re-deriving the `registerHooks` resolve/load boilerplate in
 * every component test file: call {@link stubModule} once per specifier
 * (before importing the module under test) and every importer within this
 * test file's module graph that resolves that exact specifier string
 * receives the stub instead.
 *
 * `registerHooks` is process-global and can only be usefully installed once
 * per specifier per test-file process (Node's test runner isolates each
 * `.test.ts(x)` file into its own process, so this never leaks across
 * files). Calling {@link stubModule} again for the same specifier within one
 * file replaces the previously registered source.
 */
import { createRequire } from "node:module";

type ModuleHooks = {
  registerHooks(hooks: {
    resolve(
      specifier: string,
      context: unknown,
      nextResolve: (specifier: string, context: unknown) => unknown,
    ): unknown;
    load(
      url: string,
      context: unknown,
      nextLoad: (url: string, context: unknown) => unknown,
    ): unknown;
  }): void;
};

const STUB_URL_PREFIX = "textiq-module-stub:";
const stubSources = new Map<string, string>();
let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  const { registerHooks } = createRequire(import.meta.url)(
    "node:module",
  ) as ModuleHooks;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (stubSources.has(specifier)) {
        return {
          url: `${STUB_URL_PREFIX}${specifier}`,
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith(STUB_URL_PREFIX)) {
        const specifier = url.slice(STUB_URL_PREFIX.length);
        const source = stubSources.get(specifier);
        if (source !== undefined) {
          return { format: "commonjs", source, shortCircuit: true };
        }
      }
      return nextLoad(url, context);
    },
  });
}

/**
 * Registers an inline CommonJS `source` as the resolved module body for every
 * import of the exact `specifier` string (e.g. `"./actions"`, `"../actions"`,
 * `"next/navigation"`) within this test file's module graph. Must be called
 * before the first `import`/`await import(...)` that resolves `specifier`.
 */
export function stubModule(specifier: string, source: string): void {
  install();
  stubSources.set(specifier, source);
}
