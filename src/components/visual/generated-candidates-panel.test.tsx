/**
 * Direct behavior coverage for `GeneratedCandidatesPanel` (#1963) — the
 * shared AI-variations grid used by both the popover's `variations` section
 * and any compact embed: loading skeletons, error (with/without a
 * credit-exhaustion upgrade prompt), the candidate grid (popover variant
 * wraps each choice in a `Tooltip` with a "Select variation N of M"
 * aria-label; compact variant renders plain "Insert generated visual N"
 * buttons with no tooltip), selection callback wiring, and the idle+empty
 * `empty` fallback slot.
 *
 * `VisualRenderer` (used for each candidate's thumbnail) is a directive-free
 * SVG renderer with no DOM dependency, so it mounts as-is. `Tooltip` and
 * `next/link`'s `<Link>` (rendered for the credit-exhaustion "Upgrade" case)
 * both need `@/test/portal-dom`'s fake `document.body`/`IntersectionObserver`
 * stub, so every test mounts via `withPortalDom`/`mountWithPortalDom`.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act } from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import { textOf } from "@/test/render-text";
import { buildVisual } from "@/test/builders/visual";

import { GeneratedCandidatesPanel } from "./generated-candidates-panel";

function noop() {}

describe("GeneratedCandidatesPanel", () => {
  test("idle + no candidates + no error renders the empty slot (and nothing when empty is omitted)", () => {
    withPortalDom(() => {
      const withEmpty = mountWithPortalDom(
        <GeneratedCandidatesPanel
          candidates={[]}
          status="idle"
          error={null}
          onRetry={noop}
          onChooseCandidate={noop}
          empty={<p>Nothing yet</p>}
        />,
      );
      try {
        assert.match(textOf(withEmpty.root), /Nothing yet/);
      } finally {
        act(() => withEmpty.unmount());
      }

      const withoutEmpty = mountWithPortalDom(
        <GeneratedCandidatesPanel
          candidates={[]}
          status="idle"
          error={null}
          onRetry={noop}
          onChooseCandidate={noop}
        />,
      );
      try {
        assert.equal(textOf(withoutEmpty.root).trim(), "");
      } finally {
        act(() => withoutEmpty.unmount());
      }
    });
  });

  test("loading renders two skeleton placeholders and the generating indicator, for both variants", () => {
    withPortalDom(() => {
      for (const variant of ["popover", "compact"] as const) {
        const renderer = mountWithPortalDom(
          <GeneratedCandidatesPanel
            candidates={[]}
            status="loading"
            error={null}
            onRetry={noop}
            onChooseCandidate={noop}
            variant={variant}
          />,
        );
        try {
          const items = renderer.root
            .findAllByProps({})
            .filter((node) => node.type === "li");
          assert.equal(items.length, 2);
          assert.match(textOf(renderer.root), /Analysing/);
        } finally {
          act(() => renderer.unmount());
        }
      }
    });
  });

  test("an error without creditError shows a Try again button that calls onRetry", () => {
    withPortalDom(() => {
      let retried = 0;
      const renderer = mountWithPortalDom(
        <GeneratedCandidatesPanel
          candidates={[]}
          status="idle"
          error="Something went wrong."
          onRetry={() => {
            retried += 1;
          }}
          onChooseCandidate={noop}
        />,
      );
      try {
        const alert = renderer.root.findByProps({ role: "alert" });
        assert.match(textOf(alert), /Something went wrong\./);
        assert.throws(() => renderer.root.findByType("a"));
        const retryButton = renderer.root.find(
          (node) =>
            node.type === "button" && textOf(node).trim() === "Try again",
        );
        act(() => {
          (retryButton.props.onClick as () => void)();
        });
      } finally {
        act(() => renderer.unmount());
      }
      assert.equal(retried, 1);
    });
  });

  test("an error with creditError renders an Upgrade link instead of a retry button", () => {
    withPortalDom(() => {
      const renderer = mountWithPortalDom(
        <GeneratedCandidatesPanel
          candidates={[]}
          status="idle"
          error="Out of credits."
          creditError
          onRetry={noop}
          onChooseCandidate={noop}
        />,
      );
      try {
        const alert = renderer.root.findByProps({ role: "alert" });
        assert.match(textOf(alert), /Out of credits\./);
        const link = renderer.root.findByType("a");
        assert.equal(link.props.href, "/app/settings/billing");
        assert.match(textOf(link), /Upgrade/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("popover variant: shows a pluralized count, wraps each candidate in a Tooltip labeled with its title (falling back to the kind label), and calls onChooseCandidate on click", () => {
    withPortalDom(() => {
      const chosen: unknown[] = [];
      const a = buildVisual({ title: "Sales funnel" });
      const b = buildVisual({ title: undefined, type: "flowchart" });
      const renderer = mountWithPortalDom(
        <GeneratedCandidatesPanel
          candidates={[a, b]}
          status="idle"
          error={null}
          onRetry={noop}
          onChooseCandidate={(candidate) => chosen.push(candidate)}
          variant="popover"
        />,
      );
      try {
        assert.match(textOf(renderer.root), /2 variations — click to apply/);
        const first = renderer.root.findByProps({
          "aria-label": "Select variation 1 of 2",
        });
        const second = renderer.root.findByProps({
          "aria-label": "Select variation 2 of 2",
        });
        act(() => {
          (first.props.onClick as () => void)();
        });
        assert.deepEqual(chosen, [a]);
        act(() => {
          (second.props.onClick as () => void)();
        });
        assert.deepEqual(chosen, [a, b]);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("compact variant: no count text, plain 'Insert generated visual N' buttons (no Tooltip), and onChooseCandidate wiring", () => {
    withPortalDom(() => {
      const chosen: unknown[] = [];
      const only = buildVisual({ title: "Roadmap" });
      const renderer = mountWithPortalDom(
        <GeneratedCandidatesPanel
          candidates={[only]}
          status="idle"
          error={null}
          onRetry={noop}
          onChooseCandidate={(candidate) => chosen.push(candidate)}
          variant="compact"
        />,
      );
      try {
        assert.doesNotMatch(textOf(renderer.root), /variation/);
        const button = renderer.root.findByProps({
          "aria-label": "Insert generated visual 1",
        });
        act(() => {
          (button.props.onClick as () => void)();
        });
        assert.deepEqual(chosen, [only]);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});
