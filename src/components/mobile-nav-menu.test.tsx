/**
 * Direct behavior coverage for `MobileNavMenu` and `MobileNavNonClosing`
 * (#1964) — the header's hamburger trigger + slide-in `DrawerSurface` and its
 * content-click-to-close wiring.
 *
 * `DrawerSurface` (`@/components/ui/overlay-stack`) portals its panel to
 * `document.body` via framer-motion's `AnimatePresence`, so this uses the
 * shared `@/test/portal-dom` harness (`mountWithPortalDom`/`withPortalDom`) —
 * same rationale as `document-list-toolbar.test.tsx` and
 * `new-document-button.test.tsx`. `useOverlayStack`'s real Escape-key
 * handling registers a `document.addEventListener("keydown", ...)` listener,
 * but `@/test/portal-dom`'s fake `document.addEventListener` is a
 * deliberate no-op (see that module's docstring) — no `OverlayProvider`
 * ancestor is mounted either, since `register` degrades to a no-op without
 * one. Both are fine here: this file never simulates a real Escape
 * keypress and instead finds the mounted `DrawerSurface` instance directly
 * and invokes its `onClose` prop, exercising exactly the same close path a
 * real Escape/backdrop-click would trigger without depending on
 * `overlay-stack`'s own Escape/focus-trap mechanics (out of scope — no
 * direct `overlay-stack.tsx` test exists yet).
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { act, type ReactTestRenderer } from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import { DrawerSurface } from "@/components/ui";

import { MobileNavMenu, MobileNavNonClosing } from "./mobile-nav-menu";

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

function mount(): ReactTestRenderer {
  // A plain `<div data-test-child>` stands in for an arbitrary nav child
  // here — this only verifies `MobileNavMenu` passes children through
  // untouched, not real anchor/link semantics, and `<a href="/app/...">`
  // trips the repo's `@next/next/no-html-link-for-pages` lint rule.
  return mountWithPortalDom(
    <MobileNavMenu>
      <div data-test-child="documents">Documents</div>
    </MobileNavMenu>,
  );
}

function hamburger(renderer: ReactTestRenderer) {
  return renderer.root.find(
    (el) => el.type === "button" && el.props["aria-haspopup"] === "dialog",
  );
}

function toggleHamburger(renderer: ReactTestRenderer): void {
  act(() => {
    (hamburger(renderer).props.onClick as () => void)();
  });
}

describe("MobileNavMenu — hamburger trigger", () => {
  test("starts closed: Menu icon, aria-expanded=false, 'Open navigation menu' label, no dialog mounted", () => {
    withPortalDom(() => {
      const renderer = mount();
      const trigger = hamburger(renderer);
      assert.equal(trigger.props["aria-expanded"], false);
      assert.equal(trigger.props["aria-label"], "Open navigation menu");
      assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
    });
  });

  test("clicking the trigger opens the drawer: X icon, aria-expanded=true, 'Close navigation menu' label, dialog mounted", () => {
    withPortalDom(() => {
      const renderer = mount();
      toggleHamburger(renderer);

      const trigger = hamburger(renderer);
      assert.equal(trigger.props["aria-expanded"], true);
      assert.equal(trigger.props["aria-label"], "Close navigation menu");
      const dialog = renderer.root.findByProps({ role: "dialog" });
      assert.equal(dialog.props["aria-label"], "Navigation menu");
    });
  });

  test("clicking the trigger again closes the drawer", () => {
    withPortalDom(() => {
      const renderer = mount();
      toggleHamburger(renderer);
      toggleHamburger(renderer);

      assert.equal(hamburger(renderer).props["aria-expanded"], false);
      assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
    });
  });
});

describe("MobileNavMenu — DrawerSurface wiring", () => {
  test("passes open/onClose/aria-label through to DrawerSurface", () => {
    withPortalDom(() => {
      const renderer = mount();
      const drawer = renderer.root.findByType(DrawerSurface);
      assert.equal(drawer.props.open, false);
      assert.equal(drawer.props["aria-label"], "Navigation menu");

      toggleHamburger(renderer);
      assert.equal(renderer.root.findByType(DrawerSurface).props.open, true);
    });
  });

  test("invoking DrawerSurface's onClose prop closes the drawer (same path Escape/backdrop-click would trigger)", () => {
    withPortalDom(() => {
      const renderer = mount();
      toggleHamburger(renderer);
      assert.equal(renderer.root.findByType(DrawerSurface).props.open, true);

      act(() => {
        renderer.root.findByType(DrawerSurface).props.onClose();
      });

      assert.equal(renderer.root.findByType(DrawerSurface).props.open, false);
      assert.equal(
        hamburger(renderer).props["aria-label"],
        "Open navigation menu",
      );
    });
  });

  test("the header close button inside the drawer closes it", () => {
    withPortalDom(() => {
      const renderer = mount();
      toggleHamburger(renderer);

      const closeButtons = renderer.root.findAll(
        (el) =>
          el.type === "button" &&
          el.props["aria-label"] === "Close navigation menu",
      );
      // Both the hamburger (now toggled to "Close navigation menu") and the
      // drawer's own header close button match this label; the header one is
      // the second, nested inside the dialog panel.
      assert.equal(closeButtons.length, 2);
      act(() => {
        (closeButtons[1].props.onClick as () => void)();
      });

      assert.equal(renderer.root.findByType(DrawerSurface).props.open, false);
    });
  });

  test("clicking the drawer's content area closes it (click-to-close)", () => {
    withPortalDom(() => {
      const renderer = mount();
      toggleHamburger(renderer);

      const content = renderer.root.find(
        (el) => el.type === "div" && el.props.role === "presentation",
      );
      act(() => {
        (content.props.onClick as () => void)();
      });

      assert.equal(renderer.root.findByType(DrawerSurface).props.open, false);
    });
  });

  test("renders the passed children inside the drawer content area when open", () => {
    withPortalDom(() => {
      const renderer = mount();
      toggleHamburger(renderer);

      const child = renderer.root.findByProps({
        "data-test-child": "documents",
      });
      assert.equal(child.children.join(""), "Documents");
    });
  });
});

describe("MobileNavNonClosing", () => {
  test("stops click propagation so wrapped content doesn't trigger the drawer's click-to-close", () => {
    withPortalDom(() => {
      const renderer = mountWithPortalDom(
        <MobileNavNonClosing className="test-wrapper">
          <span>Nested dropdown</span>
        </MobileNavNonClosing>,
      );

      const wrapper = renderer.root.find(
        (el) => el.type === "div" && el.props.className === "test-wrapper",
      );
      let stopped = false;
      act(() => {
        (
          wrapper.props.onClick as (event: {
            stopPropagation: () => void;
          }) => void
        )({
          stopPropagation: () => {
            stopped = true;
          },
        });
      });

      assert.ok(stopped);
    });
  });
});
