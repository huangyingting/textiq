/**
 * Direct behavior coverage for `ThemeModeButton` (#1964) — the header/mobile
 * drawer theme picker built on `SelectMenu`.
 *
 * `@/components/theme-provider`'s `useThemeMode()` is stubbed via the shared
 * `@/test/module-stub` helper (same technique as `header-gate.test.tsx`'s
 * `next/navigation` stub: a mutable state object hung off `globalThis`, read
 * by the stub and written directly by each test) so this file never mounts
 * the real `ThemeProvider` — which reaches for `localStorage`/`matchMedia`
 * side effects incompatible with `@/test/portal-dom`'s minimal fake
 * `window`/`document`. This isolates `ThemeModeButton`'s own label/variant/
 * `aria-label` composition and its `onChange` → `isAppThemeMode` guard from
 * `ThemeProvider`'s persistence/system-preference logic (already covered by
 * `theme-provider.test.tsx`).
 *
 * `SelectMenu` portals its open listbox to `document.body`, so this uses the
 * shared `@/test/portal-dom` harness (`mountWithPortalDom`/`withPortalDom`) —
 * same rationale as `document-list-toolbar.test.tsx`, whose local
 * `chooseOption` open-then-click helper this file mirrors for opening the
 * theme picker and selecting an option. `SelectMenu`'s own open/keyboard-nav
 * contract is out of scope here (no direct test exists yet for it), as is
 * `ThemeProvider`'s resolution logic — only `ThemeModeButton`'s own wiring is
 * asserted.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { act, type ReactTestRenderer } from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import { textOf } from "@/test/render-text";
import { stubModule } from "@/test/module-stub";
import type { AppThemeMode, ResolvedAppThemeMode } from "@/lib/app-shell/theme";

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

type ThemeModeButtonState = {
  mode: AppThemeMode;
  resolvedMode: ResolvedAppThemeMode;
  setModeCalls: AppThemeMode[];
};

const globalForTheme = globalThis as typeof globalThis & {
  __themeModeButtonState: ThemeModeButtonState;
};

function resetThemeState(
  mode: AppThemeMode,
  resolvedMode: ResolvedAppThemeMode,
): ThemeModeButtonState {
  const state: ThemeModeButtonState = { mode, resolvedMode, setModeCalls: [] };
  globalForTheme.__themeModeButtonState = state;
  return state;
}
resetThemeState("system", "light");

stubModule(
  "@/components/theme-provider",
  `module.exports = {
  useThemeMode: () => {
    const state = globalThis.__themeModeButtonState;
    return {
      mode: state.mode,
      resolvedMode: state.resolvedMode,
      setMode: (mode) => { state.setModeCalls.push(mode); },
    };
  },
};`,
);

// Dynamically imported after the `stubModule` call above: a static import
// would resolve the whole module graph (including `@/components/theme-provider`)
// before this file's own top-level statements run.
let ThemeModeButton: typeof import("./theme-mode-button").ThemeModeButton;
before(async () => {
  ThemeModeButton = (await import("./theme-mode-button")).ThemeModeButton;
});

function mount(variant?: "desktop" | "mobileDrawer"): ReactTestRenderer {
  return mountWithPortalDom(<ThemeModeButton variant={variant} />);
}

/** Opens the theme picker by its trigger `aria-label`, then clicks the option matching `optionText`. */
function chooseThemeOption(
  renderer: ReactTestRenderer,
  optionText: string,
): void {
  const trigger = renderer.root.find(
    (el) => el.type === "button" && typeof el.props["aria-label"] === "string",
  );
  act(() => {
    (trigger.props.onClick as () => void)();
  });
  const option = renderer.root.find(
    (el) => el.props.role === "option" && textOf(el).includes(optionText),
  );
  const optionButton = option.findByType("button");
  act(() => {
    (optionButton.props.onClick as () => void)();
  });
}

describe("ThemeModeButton — label composition", () => {
  test("shows 'System (Light)'/'System (Dark)' when mode is system, reflecting the resolved mode", () => {
    withPortalDom(() => {
      resetThemeState("system", "dark");
      const renderer = mount();
      const trigger = renderer.root.find(
        (el) =>
          el.type === "button" && typeof el.props["aria-label"] === "string",
      );
      assert.equal(trigger.props["aria-label"], "Theme: System (Dark)");
    });
  });

  test("shows the plain mode label (no parenthetical) for a non-system mode", () => {
    withPortalDom(() => {
      resetThemeState("dark", "dark");
      const renderer = mount();
      const trigger = renderer.root.find(
        (el) =>
          el.type === "button" && typeof el.props["aria-label"] === "string",
      );
      assert.equal(trigger.props["aria-label"], "Theme: Dark");
    });
  });
});

describe("ThemeModeButton — variant differences", () => {
  test("desktop variant hides the selected label, shows a tooltip, and aligns the menu to the end", () => {
    withPortalDom(() => {
      resetThemeState("light", "light");
      const renderer = mount("desktop");
      const selectMenu = renderer.root.findByProps({
        showSelectedLabel: false,
      });
      assert.equal(selectMenu.props.align, "end");
      assert.equal(selectMenu.props.tooltipLabel, "Theme: Light");
      assert.notEqual(selectMenu.props.triggerIcon, undefined);
    });
  });

  test("mobileDrawer variant shows the selected label, aligns start, and has no tooltip/triggerIcon", () => {
    withPortalDom(() => {
      resetThemeState("light", "light");
      const renderer = mount("mobileDrawer");
      const selectMenu = renderer.root.findByProps({
        showSelectedLabel: true,
      });
      assert.equal(selectMenu.props.align, "start");
      assert.equal(selectMenu.props.tooltipLabel, undefined);
      assert.equal(selectMenu.props.triggerIcon, undefined);
    });
  });
});

describe("ThemeModeButton — selecting a mode", () => {
  test("selecting an option calls setMode with the chosen theme's value exactly once", () => {
    withPortalDom(() => {
      const state = resetThemeState("system", "light");
      const renderer = mount();

      chooseThemeOption(renderer, "Ocean");

      assert.deepEqual(state.setModeCalls, ["ocean"]);
    });
  });

  test("selecting the currently active mode still calls setMode (idempotent re-selection)", () => {
    withPortalDom(() => {
      const state = resetThemeState("dark", "dark");
      const renderer = mount();

      chooseThemeOption(renderer, "Dark");

      assert.deepEqual(state.setModeCalls, ["dark"]);
    });
  });
});

describe("ThemeModeButton — accessibility", () => {
  test("every theme option is present in the portalled listbox with the correct labels", () => {
    withPortalDom(() => {
      resetThemeState("system", "light");
      const renderer = mount();
      const trigger = renderer.root.find(
        (el) =>
          el.type === "button" && typeof el.props["aria-label"] === "string",
      );
      act(() => {
        (trigger.props.onClick as () => void)();
      });

      const options = renderer.root.findAll((el) => el.props.role === "option");
      const labels = options.map((option) => textOf(option));
      for (const expected of [
        "System",
        "Light",
        "Dark",
        "Ocean",
        "Mint",
        "Rose",
        "Amber",
      ]) {
        assert.ok(
          labels.some((label) => label.includes(expected)),
          `expected an option labeled "${expected}", got: ${labels.join(", ")}`,
        );
      }
    });
  });
});
