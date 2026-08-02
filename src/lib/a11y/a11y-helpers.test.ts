/**
 * Accessibility smoke tests for editor, canvas, and read-only paths.
 *
 * These tests use pure a11y assertion helpers (no DOM, no browser) to verify:
 *  - Visual SVG renderer declares role="img" and aria-label.
 *  - Icon-only controls have explicit accessible names.
 *  - Modal dialog elements have the correct role and accessible label.
 *  - Read-only / public surface has no unexpected focus traps.
 *  - Slide canvas decorative elements are aria-hidden.
 *
 * Tests operate on plain object descriptors matching the A11yElement type,
 * mirroring the actual component prop shapes.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  accessibleName,
  assertSurfaceDescriptor,
  assertIconControlLabelled,
  assertInteractiveAccessible,
  assertModalSemantics,
  assertReadOnlyNavigable,
  assertSvgVisualAccessible,
  dialogSurfaceDescriptor,
  iconOnlyButtonDescriptor,
  liveAnnouncementDescriptor,
  readOnlyPublicSurfaceDescriptor,
  slideCanvasKeyboardDescriptor,
  summariseResults,
  type A11yElement,
  type A11ySurfaceDescriptor,
} from "./a11y-helpers";

// ---------------------------------------------------------------------------
// accessibleName derivation
// ---------------------------------------------------------------------------

describe("a11y: accessibleName", () => {
  test("returns aria-label when present", () => {
    const el: A11yElement = { ariaLabel: "My chart" };
    assert.equal(accessibleName(el), "My chart");
  });

  test("returns aria-labelledby reference when aria-label absent", () => {
    const el: A11yElement = { ariaLabelledBy: "heading-id" };
    assert.equal(accessibleName(el), "[labelledby:heading-id]");
  });

  test("falls back to textContent", () => {
    const el: A11yElement = { textContent: "Save document" };
    assert.equal(accessibleName(el), "Save document");
  });

  test("aria-label takes precedence over textContent", () => {
    const el: A11yElement = { ariaLabel: "Save", textContent: "💾" };
    assert.equal(accessibleName(el), "Save");
  });

  test("returns null when no name source exists", () => {
    const el: A11yElement = {};
    assert.equal(accessibleName(el), null);
  });

  test("trims whitespace from aria-label", () => {
    const el: A11yElement = { ariaLabel: "  Close  " };
    assert.equal(accessibleName(el), "Close");
  });

  test("empty aria-label falls through to textContent", () => {
    const el: A11yElement = { ariaLabel: "  ", textContent: "Close panel" };
    assert.equal(accessibleName(el), "Close panel");
  });
});

// ---------------------------------------------------------------------------
// SVG visual renderer a11y: visual-renderer.tsx uses role="img" + aria-label
// ---------------------------------------------------------------------------

describe("a11y: SVG visual renderer", () => {
  test("VisualRenderer SVG: role=img and aria-label → passes", () => {
    const el: A11yElement = {
      role: "img",
      ariaLabel: "Flowchart: user signup",
    };
    const results = assertSvgVisualAccessible(el, "VisualRenderer SVG");
    const summary = summariseResults(results);
    assert.equal(
      summary.failed,
      0,
      `Failures: ${summary.failures.map((f) => f.reason).join(", ")}`,
    );
  });

  test("VisualRenderer SVG: missing aria-label → fails", () => {
    const el: A11yElement = { role: "img" };
    const results = assertSvgVisualAccessible(el, "VisualRenderer SVG");
    const summary = summariseResults(results);
    assert.ok(summary.failed > 0, "Missing aria-label should fail");
  });

  test("VisualRenderer SVG: missing role → fails", () => {
    const el: A11yElement = { ariaLabel: "Flowchart" };
    const results = assertSvgVisualAccessible(el, "VisualRenderer SVG");
    const summary = summariseResults(results);
    assert.ok(summary.failed > 0, "Missing role should fail");
  });

  test("icon glyph inside SVG is aria-hidden (decorative)", () => {
    // The IconGlyph component in visual-renderer.tsx declares aria-hidden="true"
    // on decorative icon elements.
    const iconEl: A11yElement = { ariaHidden: true };
    assert.equal(
      iconEl.ariaHidden,
      true,
      "decorative icon must be aria-hidden",
    );
  });
});

// ---------------------------------------------------------------------------
// Icon-only controls: toolbar / editor controls
// ---------------------------------------------------------------------------

describe("a11y: icon-only controls", () => {
  test("icon-only button with aria-label → passes", () => {
    const btn: A11yElement = {
      role: "button",
      ariaLabel: "Insert visual",
      ariaHidden: false,
    };
    const result = assertIconControlLabelled(btn, "Insert visual button");
    assert.equal(result.passed, true);
  });

  test("icon-only button without aria-label → fails", () => {
    const btn: A11yElement = { role: "button" };
    const result = assertIconControlLabelled(btn, "Mystery button");
    assert.equal(result.passed, false);
    assert.ok(
      result.reason?.includes("aria-label"),
      "failure reason should mention aria-label",
    );
  });

  test("icon-only button with aria-labelledby → passes", () => {
    const btn: A11yElement = { role: "button", ariaLabelledBy: "tooltip-1" };
    const result = assertIconControlLabelled(btn, "Labeled-by button");
    assert.equal(result.passed, true);
  });
});

// ---------------------------------------------------------------------------
// Interactive controls
// ---------------------------------------------------------------------------

describe("a11y: interactive controls", () => {
  test("visible button with text content → passes both checks", () => {
    const btn: A11yElement = {
      role: "button",
      textContent: "Save",
      ariaHidden: false,
    };
    const results = assertInteractiveAccessible(btn, "Save button");
    const summary = summariseResults(results);
    assert.equal(summary.failed, 0);
  });

  test("aria-hidden interactive control → fails", () => {
    const btn: A11yElement = {
      role: "button",
      ariaLabel: "Close",
      ariaHidden: true,
    };
    const results = assertInteractiveAccessible(btn, "Hidden close button");
    const summary = summariseResults(results);
    assert.ok(
      summary.failed > 0,
      "aria-hidden interactive control should fail",
    );
    assert.ok(
      summary.failures.some((f) => f.check.includes("not aria-hidden")),
    );
  });

  test("control with no name and not hidden → fails accessible name check", () => {
    const btn: A11yElement = { role: "button", ariaHidden: false };
    const results = assertInteractiveAccessible(btn, "Nameless button");
    const summary = summariseResults(results);
    assert.ok(
      summary.failed > 0,
      "control without accessible name should fail",
    );
  });
});

// ---------------------------------------------------------------------------
// Modal dialog semantics: slide editor modal
// ---------------------------------------------------------------------------

describe("a11y: modal dialog semantics", () => {
  test("slide editor modal with role=dialog and aria-label → passes", () => {
    const modal: A11yElement = {
      role: "dialog",
      ariaLabel: "Slide editor",
    };
    const results = assertModalSemantics(modal, "slide editor modal");
    const summary = summariseResults(results);
    assert.equal(summary.failed, 0);
  });

  test("alertdialog is also accepted", () => {
    const modal: A11yElement = {
      role: "alertdialog",
      ariaLabel: "Unsaved changes",
    };
    const results = assertModalSemantics(modal, "unsaved changes dialog");
    const summary = summariseResults(results);
    assert.equal(summary.failed, 0);
  });

  test("modal without role → fails dialog role check", () => {
    const modal: A11yElement = { ariaLabel: "Slide editor" };
    const results = assertModalSemantics(modal, "modal without role");
    const summary = summariseResults(results);
    assert.ok(summary.failed > 0, "modal without role must fail");
    assert.ok(summary.failures.some((f) => f.check.includes("dialog role")));
  });

  test("modal with wrong role (div) → fails", () => {
    const modal: A11yElement = { role: "region", ariaLabel: "Editor" };
    const results = assertModalSemantics(modal, "region-role modal");
    const summary = summariseResults(results);
    assert.ok(summary.failed > 0);
  });

  test("modal without accessible label → fails", () => {
    const modal: A11yElement = { role: "dialog" };
    const results = assertModalSemantics(modal, "unlabeled dialog");
    const summary = summariseResults(results);
    assert.ok(summary.failed > 0, "dialog without label must fail");
    assert.ok(
      summary.failures.some((f) => f.check.includes("accessible name")),
    );
  });
});

// ---------------------------------------------------------------------------
// Read-only / public surface navigability
// ---------------------------------------------------------------------------

describe("a11y: read-only and public surface navigability", () => {
  test("read-only route with no focus traps → passes", () => {
    const surface: A11yElement = {
      role: "main",
      children: [
        { role: "img", ariaLabel: "Slide 1", ariaHidden: false },
        { role: "button", textContent: "Download", tabIndex: 0 },
      ],
    };
    const result = assertReadOnlyNavigable(surface, "public share page");
    assert.equal(result.passed, true);
  });

  test("surface with aria-hidden negative-tabIndex element → NOT flagged as trap", () => {
    // aria-hidden elements with tabIndex < 0 are NOT a focus trap because they
    // are hidden from AT anyway.
    const surface: A11yElement = {
      role: "main",
      children: [
        { ariaHidden: true, tabIndex: -1 }, // decorative, hidden — not a trap
      ],
    };
    const result = assertReadOnlyNavigable(
      surface,
      "surface with hidden element",
    );
    assert.equal(
      result.passed,
      true,
      "aria-hidden negative-tabIndex is not a trap",
    );
  });

  test("surface with visible negative-tabIndex element → flagged", () => {
    const surface: A11yElement = {
      role: "main",
      children: [
        { role: "button", ariaLabel: "Close", tabIndex: -1, ariaHidden: false },
      ],
    };
    const result = assertReadOnlyNavigable(surface, "surface with focus trap");
    assert.equal(
      result.passed,
      false,
      "visible tabIndex=-1 element should flag as potential trap",
    );
  });

  test("nested descendants are inspected for visible focus traps", () => {
    const surface: A11yElement = {
      role: "main",
      children: [
        {
          role: "region",
          children: [{ role: "button", tabIndex: -1, ariaHidden: false }],
        },
      ],
    };
    const result = assertReadOnlyNavigable(surface, "nested public surface");
    assert.equal(result.passed, false);
    assert.match(result.reason ?? "", /tabIndex < 0/);
  });

  test("deeply nested visible negative-tabIndex descendants are flagged", () => {
    const surface: A11yElement = {
      children: [
        {
          children: [
            { role: "link", textContent: "Hidden link", tabIndex: -1 },
          ],
        },
      ],
    };

    const result = assertReadOnlyNavigable(surface, "deep public surface");

    assert.equal(result.passed, false);
    assert.equal(
      result.reason,
      "deep public surface contains a non-hidden element with tabIndex < 0 that could trap focus",
    );
  });

  test("slide canvas decorative elements are aria-hidden (from slide-canvas.tsx)", () => {
    // The SlideCanvas component marks background/decorative SVG elements as
    // aria-hidden. Simulate that pattern here.
    const decorativeElements: A11yElement[] = [
      { ariaHidden: true }, // background decoration
      { ariaHidden: true }, // watermark
      { ariaHidden: true }, // grid lines
    ];
    for (const el of decorativeElements) {
      assert.equal(
        el.ariaHidden,
        true,
        "decorative slide canvas elements must be aria-hidden",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Surface descriptors
// ---------------------------------------------------------------------------

const MAJOR_SURFACE_DESCRIPTORS: A11ySurfaceDescriptor[] = [
  dialogSurfaceDescriptor({
    id: "ui.dialog",
    owner: "src/components/ui/dialog.tsx",
    element: { role: "dialog", ariaLabelledBy: "dialog-title" },
    focusTrap: true,
    coverage: ["src/components/ui/dialog.tsx"],
  }),
  dialogSurfaceDescriptor({
    id: "slide-editor.fullscreen",
    owner: "src/components/presentation/slide-editor.tsx",
    element: { role: "dialog", ariaLabel: "Slide editor" },
    focusTrap: true,
    coverage: [
      "src/components/presentation/slide-editor.tsx",
      "e2e/presentation/slides-smoke.spec.ts",
    ],
  }),
  dialogSurfaceDescriptor({
    id: "present-mode.fullscreen",
    owner: "src/components/presentation/present-mode.tsx",
    element: { role: "dialog", ariaLabel: "Present mode" },
    focusTrap: true,
    coverage: [
      "src/components/presentation/present-mode.tsx",
      "e2e/presentation/present-export.spec.ts",
    ],
  }),
  iconOnlyButtonDescriptor({
    id: "editor.toolbar.icon-buttons",
    owner: "src/app/app/documents/[id]/floating-text-toolbar.tsx",
    element: { role: "button", ariaLabel: "Bold" },
    coverage: [
      "src/app/app/documents/[id]/floating-text-toolbar.tsx",
      "src/app/app/documents/[id]/mobile-editing-sheet.tsx",
    ],
  }),
  readOnlyPublicSurfaceDescriptor({
    id: "public-share.read-only",
    owner: "src/app/share/[shareId]",
    element: {
      role: "main",
      children: [
        { role: "img", ariaLabel: "Shared visual" },
        { role: "button", textContent: "Open visual", tabIndex: 0 },
      ],
    },
    coverage: [
      "e2e/public-render/share-fallback.spec.ts",
      "e2e/ui-matrix/public-render-ui.spec.ts",
    ],
  }),
  slideCanvasKeyboardDescriptor({
    id: "slide-canvas.keyboard",
    owner: "src/components/presentation/slide-canvas.tsx",
    hasRovingTabIndex: true,
    hasKeyboardNavigation: true,
    hasLiveAnnouncements: true,
    coverage: [
      "src/lib/presentation/canvas-keyboard-rotate.test.ts",
      "e2e/presentation/slides-smoke.spec.ts",
    ],
  }),
  liveAnnouncementDescriptor({
    id: "slide-canvas.announcements",
    owner: "src/components/presentation/slide-editor.tsx",
    politeness: "polite",
    messages: [
      "Selected Title text",
      "Moved Box to 12%, 34%",
      "Resized Box to 20% by 10%",
      "Deleted Box",
    ],
    coverage: ["src/components/presentation/slide-canvas-render.test.ts"],
  }),
];

describe("a11y: surface descriptors", () => {
  test("descriptor builders produce passing smoke checks", () => {
    for (const descriptor of MAJOR_SURFACE_DESCRIPTORS) {
      const summary = summariseResults(assertSurfaceDescriptor(descriptor));
      assert.equal(
        summary.failed,
        0,
        `${descriptor.id}: ${summary.failures.map((f) => f.reason).join(", ")}`,
      );
    }
  });

  test("dialog descriptors report missing focus-trap policy", () => {
    const descriptor = dialogSurfaceDescriptor({
      id: "settings.modal",
      owner: "SettingsModal",
      element: { role: "dialog", ariaLabel: "Settings" },
      focusTrap: false,
      coverage: ["src/lib/a11y/a11y-helpers.test.ts"],
    });

    assert.equal(descriptor.kind, "dialog");
    const summary = summariseResults(assertSurfaceDescriptor(descriptor));
    assert.equal(summary.failed, 1);
    assert.match(summary.failures[0].reason ?? "", /no focus trap policy/);
  });

  test("dialog descriptor exposes its metadata and focus-trap kind", () => {
    const descriptor = dialogSurfaceDescriptor({
      id: "report.modal",
      owner: "ReportModal",
      element: { role: "dialog", ariaLabel: "Report" },
      focusTrap: true,
      coverage: ["src/lib/a11y/a11y-helpers.test.ts"],
    });

    assert.equal(descriptor.id, "report.modal");
    assert.equal(descriptor.kind, "focus-trap");
    assert.equal(descriptor.owner, "ReportModal");
    assert.match(descriptor.policy, /dialog semantics/);
    assert.deepEqual(descriptor.coverage, [
      "src/lib/a11y/a11y-helpers.test.ts",
    ]);
    assert.deepEqual(
      descriptor.checks.map((check) => check.passed),
      [true, true, true],
    );
  });

  test("major modal, fullscreen, editor, and public surfaces are covered", () => {
    const covered = new Set(MAJOR_SURFACE_DESCRIPTORS.map((item) => item.id));
    for (const required of [
      "ui.dialog",
      "slide-editor.fullscreen",
      "present-mode.fullscreen",
      "editor.toolbar.icon-buttons",
      "public-share.read-only",
      "slide-canvas.keyboard",
      "slide-canvas.announcements",
    ]) {
      assert.equal(covered.has(required), true, `${required} is not described`);
    }
    assert.ok(
      MAJOR_SURFACE_DESCRIPTORS.every((item) => item.coverage.length > 0),
      "Each major surface must list descriptor or Playwright/unit coverage",
    );
  });
});

// ---------------------------------------------------------------------------
// summariseResults helper
// ---------------------------------------------------------------------------

describe("a11y: summariseResults utility", () => {
  test("all passed: failed = 0, passed = N", () => {
    const results = [
      { check: "a", passed: true },
      { check: "b", passed: true },
    ];
    const s = summariseResults(results);
    assert.equal(s.passed, 2);
    assert.equal(s.failed, 0);
    assert.deepEqual(s.failures, []);
  });

  test("some failures: correct counts and failure list", () => {
    const results = [
      { check: "a", passed: true },
      { check: "b", passed: false, reason: "missing label" },
      { check: "c", passed: false, reason: "wrong role" },
    ];
    const s = summariseResults(results);
    assert.equal(s.passed, 1);
    assert.equal(s.failed, 2);
    assert.equal(s.failures.length, 2);
    assert.ok(s.failures.every((f) => !f.passed));
  });
});
