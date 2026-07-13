/**
 * Direct contract coverage for `Presence` (issue #1962) — the collaboration
 * avatar stack + connection-status pill shown in the document editor header.
 *
 * `initialsOf` (`@/lib/collab/y-text`) is already covered by
 * `src/lib/collab/y-text.test.ts`, so the real implementation is used here
 * (no stub needed — this component just calls it directly on peer names).
 *
 * `Presence` renders through `Tooltip` (`@/components/ui`), which
 * unconditionally `createPortal`s into `document.body` whenever `document`
 * exists, so this uses the shared `withPortalDom`/`mountWithPortalDom`
 * harness (`@/test/portal-dom`) — the same one used by
 * `src/app/app/new-document-button.test.tsx` — rather than the plain
 * `react-render-harness`, which installs a `document` with no `.body` and
 * would throw the moment `Tooltip` tries to portal.
 *
 * Tooltip labels are asserted by finding the real `Tooltip` element
 * instances in the rendered tree (`findAllByType(Tooltip)`) and reading
 * their `label` prop directly — `Tooltip` only renders its bubble content
 * once open (after a hover delay), so this avoids re-testing `Tooltip`'s own
 * show/hide timing (already outside this file's scope) just to read the
 * label text that `Presence` assigns it.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { act } from "react-test-renderer";

import { Tooltip } from "@/components/ui";
import type { CollabStatus, Peer } from "@/lib/collab/use-collaboration";
import { initialsOf } from "@/lib/collab/y-text";
import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";

import { Presence } from "./presence";

function peer(overrides: Partial<Peer> & { clientId: number }): Peer {
  return {
    name: "Ada Lovelace",
    color: "#336699",
    self: false,
    ...overrides,
  };
}

function statusLabel(pill: { children: unknown[] }): string {
  return pill.children
    .filter((child): child is string => typeof child === "string")
    .join("")
    .trim();
}

describe("Presence", () => {
  test("renders no avatar stack when there are no peers, but still shows the status pill", () => {
    withPortalDom(() => {
      const renderer = mountWithPortalDom(
        createElement(Presence, { peers: [], status: "connected" }),
      );
      try {
        assert.throws(() =>
          renderer.root.findByProps({ "aria-label": "People here" }),
        );
        const pill = renderer.root.findByProps({ role: "status" });
        assert.equal(pill.props["aria-live"], "polite");
        assert.equal(statusLabel(pill), "Live");
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("renders one avatar per peer, up to MAX_AVATARS, with initials and self/other ring styling", () => {
    withPortalDom(() => {
      const peers = [
        peer({ clientId: 1, name: "Ada Lovelace", self: true }),
        peer({ clientId: 2, name: "Grace Hopper" }),
        peer({ clientId: 3, name: "Alan Turing" }),
      ];
      const renderer = mountWithPortalDom(
        createElement(Presence, { peers, status: "connected" }),
      );
      try {
        const stack = renderer.root.findByProps({
          "aria-label": "People here",
        });
        const avatarSpans = stack.findAll(
          (node) =>
            node.type === "span" &&
            typeof node.props["aria-label"] === "string" &&
            node.props["aria-label"] !== "People here",
        );
        assert.equal(avatarSpans.length, 3);

        assert.equal(avatarSpans[0].props["aria-label"], "Ada Lovelace (you)");
        assert.equal(
          avatarSpans[0].children?.join(""),
          initialsOf("Ada Lovelace"),
        );
        assert.match(avatarSpans[0].props.className, /ring-ds-control/);

        assert.equal(avatarSpans[1].props["aria-label"], "Grace Hopper");
        assert.equal(
          avatarSpans[1].children?.join(""),
          initialsOf("Grace Hopper"),
        );
        assert.match(avatarSpans[1].props.className, /ring-ds-surface-overlay/);

        assert.equal(avatarSpans[2].props["aria-label"], "Alan Turing");

        const tooltips = renderer.root.findAllByType(Tooltip);
        assert.deepEqual(
          tooltips.map((t) => t.props.label),
          ["Ada Lovelace (you)", "Grace Hopper", "Alan Turing"],
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("caps the visible stack at MAX_AVATARS (4) and shows a '+N more' overflow badge", () => {
    withPortalDom(() => {
      const peers = Array.from({ length: 6 }, (_, i) =>
        peer({ clientId: i, name: `Person ${i}` }),
      );
      const renderer = mountWithPortalDom(
        createElement(Presence, { peers, status: "connected" }),
      );
      try {
        const stack = renderer.root.findByProps({
          "aria-label": "People here",
        });
        const avatarSpans = stack.findAll(
          (node) =>
            node.type === "span" &&
            typeof node.props["aria-label"] === "string" &&
            node.props["aria-label"] !== "People here" &&
            !node.props["aria-label"].endsWith("more"),
        );
        assert.equal(avatarSpans.length, 4);

        const overflowBadge = renderer.root.findByProps({
          "aria-label": "2 more",
        });
        assert.equal(overflowBadge.children?.join(""), "+2");

        const overflowTooltip = renderer.root
          .findAllByType(Tooltip)
          .find((t) => t.props.label === "2 more");
        assert.ok(
          overflowTooltip,
          "expected an overflow Tooltip with '2 more'",
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("shows no overflow badge when peers.length is exactly MAX_AVATARS", () => {
    withPortalDom(() => {
      const peers = Array.from({ length: 4 }, (_, i) =>
        peer({ clientId: i, name: `Person ${i}` }),
      );
      const renderer = mountWithPortalDom(
        createElement(Presence, { peers, status: "connected" }),
      );
      try {
        const overflowBadges = renderer.root.findAll(
          (node) =>
            typeof node.props["aria-label"] === "string" &&
            node.props["aria-label"].endsWith("more"),
        );
        assert.equal(overflowBadges.length, 0);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  for (const [status, expectedLabel] of [
    ["connected", "Live"],
    ["connecting", "Connecting…"],
    ["disconnected", "Offline"],
  ] as [CollabStatus, string][]) {
    test(`renders the "${expectedLabel}" status pill for status="${status}"`, () => {
      withPortalDom(() => {
        const renderer = mountWithPortalDom(
          createElement(Presence, { peers: [], status }),
        );
        try {
          const pill = renderer.root.findByProps({ role: "status" });
          assert.equal(pill.props["aria-live"], "polite");
          assert.equal(statusLabel(pill), expectedLabel);
        } finally {
          act(() => renderer.unmount());
        }
      });
    });
  }
});
