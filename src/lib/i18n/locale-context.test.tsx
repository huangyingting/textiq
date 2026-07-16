/**
 * Behavioral tests for `LocaleProvider`, `useLocale`, `useSetLocaleOptimistic`,
 * and `useTranslation` (#1906).
 *
 * These hooks depend on React context propagation and `useOptimistic`, which
 * require a real mounted component tree — not just a bare hook call — so this
 * suite mounts a small `Harness` component with `react-test-renderer`
 * directly (same pattern as `src/lib/import/document-import-workflow.test.ts`)
 * rather than the shared `react-render-harness`, which intentionally never
 * commits its probe's returned element and so cannot propagate context to a
 * nested consumer.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { startTransition } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import {
  LocaleProvider,
  useLocale,
  useSetLocaleOptimistic,
  useTranslation,
} from "./locale-context";
import { DEFAULT_LOCALE, type Locale, type Translator } from "./index";

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const [message] = args;
  if (
    typeof message === "string" &&
    message.startsWith("react-test-renderer is deprecated")
  ) {
    return;
  }
  originalConsoleError(...args);
};

after(() => {
  console.error = originalConsoleError;
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type ConsumerSnapshot = {
  locale: Locale;
  setLocaleOptimistic: (next: Locale) => void;
  t: Translator;
};

function Consumer({
  onRender,
}: {
  onRender: (snapshot: ConsumerSnapshot) => void;
}) {
  const locale = useLocale();
  const setLocaleOptimistic = useSetLocaleOptimistic();
  const t = useTranslation();
  onRender({ locale, setLocaleOptimistic, t });
  return null;
}

/** Mounts `Consumer` directly, with no `LocaleProvider` ancestor. */
function renderUnguarded(): {
  ref: { current: ConsumerSnapshot | null };
  unmount: () => void;
} {
  const ref: { current: ConsumerSnapshot | null } = { current: null };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <Consumer
        onRender={(snapshot) => {
          ref.current = snapshot;
        }}
      />,
    );
  });
  return { ref, unmount: () => act(() => renderer.unmount()) };
}

/** Mounts `Consumer` inside `LocaleProvider` seeded with `initialLocale`. */
function renderProvided(initialLocale: Locale): {
  ref: { current: ConsumerSnapshot | null };
  unmount: () => void;
} {
  const ref: { current: ConsumerSnapshot | null } = { current: null };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <LocaleProvider initialLocale={initialLocale}>
        <Consumer
          onRender={(snapshot) => {
            ref.current = snapshot;
          }}
        />
      </LocaleProvider>,
    );
  });
  return { ref, unmount: () => act(() => renderer.unmount()) };
}

// ── Guard behavior outside a provider ───────────────────────────────────────

test("useLocale falls back to the default locale when no LocaleProvider is mounted", () => {
  const { ref, unmount } = renderUnguarded();
  assert.equal(ref.current?.locale, DEFAULT_LOCALE);
  unmount();
});

test("useSetLocaleOptimistic is a harmless no-op when no LocaleProvider is mounted", () => {
  const { ref, unmount } = renderUnguarded();
  assert.doesNotThrow(() => ref.current?.setLocaleOptimistic("es"));
  unmount();
});

test("useTranslation binds to the default locale when no LocaleProvider is mounted", () => {
  const { ref, unmount } = renderUnguarded();
  assert.equal(ref.current?.t("header.nav.login"), "Log in");
  unmount();
});

// ── Provider seeding ─────────────────────────────────────────────────────────

test("LocaleProvider seeds the context from the initialLocale prop", () => {
  const { ref, unmount } = renderProvided("es");
  assert.equal(ref.current?.locale, "es");
  unmount();
});

test("useTranslation binds t() to the locale seeded by LocaleProvider", () => {
  const { ref, unmount } = renderProvided("es");
  assert.equal(ref.current?.t("header.nav.documents"), "Documentos");
  unmount();
});

// ── Optimistic update wiring ─────────────────────────────────────────────────
//
// The language switcher starts a transition, applies the optimistic locale
// inside it, then persists the cookie and refreshes the server tree (see
// `src/components/language-switcher.tsx`). The optimistic value takes effect
// while that transition is pending, and settles back once it resolves unless
// a real locale update lands in the meantime.

test("setLocaleOptimistic shows the new locale immediately while the persistence transition is pending", async () => {
  const { ref, unmount } = renderProvided("en");
  assert.equal(ref.current?.locale, "en");

  let resolvePersist!: () => void;
  const persisted = new Promise<void>((resolve) => {
    resolvePersist = resolve;
  });

  act(() => {
    startTransition(async () => {
      ref.current?.setLocaleOptimistic("es");
      await persisted;
    });
  });

  assert.equal(ref.current?.locale, "es");
  assert.equal(ref.current?.t("header.nav.documents"), "Documentos");

  await act(async () => {
    resolvePersist();
    await persisted;
  });
  unmount();
});

test("setLocaleOptimistic settles back once the transition resolves without a confirmed locale update", async () => {
  const { ref, unmount } = renderProvided("en");

  let resolvePersist!: () => void;
  const persisted = new Promise<void>((resolve) => {
    resolvePersist = resolve;
  });

  act(() => {
    startTransition(async () => {
      ref.current?.setLocaleOptimistic("es");
      await persisted;
    });
  });

  assert.equal(ref.current?.locale, "es");

  await act(async () => {
    resolvePersist();
    await persisted;
  });

  // No RSC refresh landed a real "es" locale, so the optimistic value reverts
  // to the last confirmed `initialLocale` once the transition settles.
  assert.equal(ref.current?.locale, "en");
  unmount();
});
