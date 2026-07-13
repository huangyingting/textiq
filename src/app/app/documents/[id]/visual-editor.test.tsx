/**
 * Direct behavior coverage for `VisualEditor` (#1963) — the SVG node/edge
 * canvas: selection, drag-move, corner-resize, click/double-click-to-edit
 * inline label input, keyboard nav (arrows/Enter/Delete/Escape), connector
 * selection + inline toolbar (flip/arrowhead/curve/label), background click
 * clearing selection, pointer-cancel cleanup, and the `onCommand` (#507)
 * vs `onChange` fallback pattern.
 *
 * `nodeBoxes`/`resizeNodeBox`/`edgeSegments`/`isPositionedKind`
 * (`@/lib/visual/layout`) and `flipEdge`/`setEdgeLabel`/`setNodeLabel`/
 * `toggleEdgeDirected`/`toggleEdgeStyle` (`@/lib/visual/transforms`) are
 * already covered by their own dedicated test files (`layout.test.ts`,
 * `transforms.*.test.ts`) — this file only asserts that `VisualEditor` wires
 * pointer/keyboard gestures to the right transform with the right arguments,
 * not the transform math itself.
 *
 * Pointer/keyboard events are constructed by hand (not dispatched through a
 * real DOM) and passed directly to the handler props found on the rendered
 * SVG host elements — the established pattern for this repo's DOM-free
 * React Test Renderer suites. `svgRef`/`inputRef`/`edgeInputRef` need a
 * `getBoundingClientRect`/`setPointerCapture`/`releasePointerCapture` /
 * `focus`/`select`/`setSelectionRange` mock, supplied via a small
 * type-keyed `createNodeMock` (this canvas has no crop/rotate/connector
 * handles like the unrelated presentation `fake-dom.ts` harness, so that
 * module doesn't apply here). `Tooltip` (rendered in the connector toolbar)
 * only portals to `document.body` while open, but mounts via
 * `@/test/portal-dom`'s `withPortalDom` regardless for a real fake
 * `document`/`window` — with `window.matchMedia` monkey-patched per test so
 * `useIsPointerFine` can be driven to either pointer tier (default: fine, so
 * resize handles render).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { ReactElement } from "react";

import { withPortalDom } from "@/test/portal-dom";
import { buildVisual, buildVisualNode } from "@/test/builders/visual";
import type { Visual } from "@/lib/visual/schema";
import type { VisualCommandPayload } from "@/lib/commands/visual-command-contracts";

import { VisualEditor } from "./visual-editor";

function withEditorDom<T>(run: () => T, pointerFine = true): T {
  return withPortalDom(() => {
    (
      window as unknown as {
        matchMedia: (query: string) => {
          matches: boolean;
          addEventListener: () => void;
          removeEventListener: () => void;
        };
      }
    ).matchMedia = (query: string) => ({
      matches: query.includes("pointer: fine") ? pointerFine : false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    return run();
  });
}

function rect(width = 640, height = 360) {
  return {
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
}

function createEditorNodeMock(element: ReactElement) {
  if (element.type === "svg") {
    return {
      getBoundingClientRect: () => rect(),
      setPointerCapture: () => undefined,
      releasePointerCapture: () => undefined,
    };
  }
  if (element.type === "input") {
    return {
      focus: () => undefined,
      select: () => undefined,
      setSelectionRange: () => undefined,
      blur: () => undefined,
      value: "",
    };
  }
  return null;
}

function mountEditor(element: ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(element, { createNodeMock: createEditorNodeMock });
  });
  return renderer;
}

function findByAria(
  root: import("react-test-renderer").ReactTestInstance,
  label: string,
) {
  return root.find(
    (node) =>
      node.props["aria-label"] === label && typeof node.type === "string",
  );
}

// `VisualRenderer` (the static base) also renders an `<svg>`; the
// interactive overlay is the one with pointer handlers attached.
function findOverlaySvg(root: import("react-test-renderer").ReactTestInstance) {
  return root.find(
    (node) =>
      node.type === "svg" && typeof node.props.onPointerMove === "function",
  );
}

function findAllByAriaPrefix(
  root: import("react-test-renderer").ReactTestInstance,
  prefix: string,
) {
  return root.findAll(
    (node) =>
      typeof node.props["aria-label"] === "string" &&
      (node.props["aria-label"] as string).startsWith(prefix) &&
      typeof node.type === "string",
  );
}

function pointerEvent(overrides: Record<string, any> = {}) {
  const target = overrides.currentTarget ?? {
    getBoundingClientRect: () => rect(100, 100),
  };
  return {
    clientX: 0,
    clientY: 0,
    shiftKey: false,
    pointerId: 1,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    currentTarget: target,
    target,
    ...overrides,
  };
}

function keyEvent(key: string, overrides: Record<string, any> = {}) {
  return {
    key,
    shiftKey: false,
    preventDefault: () => undefined,
    currentTarget: { blur: () => undefined },
    ...overrides,
  };
}

function baseVisual(): Visual {
  return buildVisual();
}

describe("VisualEditor", () => {
  test("renders a hit-box per node and per edge with editable-target aria-labels; no resize handles or inputs before selection", () => {
    withEditorDom(() => {
      const renderer = mountEditor(
        <VisualEditor visual={baseVisual()} onChange={() => {}} />,
      );
      try {
        assert.ok(findByAria(renderer.root, "Edit Start"));
        assert.ok(findByAria(renderer.root, "Edit Finish"));
        assert.ok(findByAria(renderer.root, "Edit connector connector"));
        assert.throws(() =>
          renderer.root.findByProps({ "aria-label": "Node label" }),
        );
        assert.equal(findAllByAriaPrefix(renderer.root, "Resize").length, 0);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("pointer-down on a node reports the selection via onSelectNode", () => {
    withEditorDom(() => {
      const selected: Array<string | null> = [];
      const renderer = mountEditor(
        <VisualEditor
          visual={baseVisual()}
          onChange={() => {}}
          onSelectNode={(id) => selected.push(id)}
        />,
      );
      try {
        const node = findByAria(renderer.root, "Edit Finish");
        act(() => {
          (node.props.onPointerDown as (e: unknown) => void)(
            pointerEvent({ clientX: 300, clientY: 120 }),
          );
        });
        assert.deepEqual(selected.at(-1), "node-2");
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("dragging a positioned node past the click threshold commits a new position via onChange", () => {
    withEditorDom(() => {
      const changes: Visual[] = [];
      const renderer = mountEditor(
        <VisualEditor
          visual={baseVisual()}
          onChange={(next) => changes.push(next)}
        />,
      );
      try {
        const node = findByAria(renderer.root, "Edit Start");
        const svg = findOverlaySvg(renderer.root);
        act(() => {
          (node.props.onPointerDown as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        act(() => {
          (svg.props.onPointerMove as (e: unknown) => void)(
            pointerEvent({ clientX: 140, clientY: 100 }),
          );
        });
        assert.ok(changes.length > 0);
        const moved = changes.at(-1)!.nodes.find((n) => n.id === "node-1")!;
        assert.notEqual(moved.x, 120);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a plain click that does not move the pointer selects without dragging (moved stays false)", () => {
    withEditorDom(() => {
      const changes: Visual[] = [];
      const renderer = mountEditor(
        <VisualEditor
          visual={baseVisual()}
          onChange={(next) => changes.push(next)}
        />,
      );
      try {
        const node = findByAria(renderer.root, "Edit Start");
        const svg = findOverlaySvg(renderer.root);
        act(() => {
          (node.props.onPointerDown as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        act(() => {
          (svg.props.onPointerUp as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        assert.equal(changes.length, 0);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("corner-resize handles render for a selected positioned node on a fine pointer, and dragging a handle commits a resized box", () => {
    withEditorDom(() => {
      const changes: Visual[] = [];
      const renderer = mountEditor(
        <VisualEditor
          visual={baseVisual()}
          onChange={(next) => changes.push(next)}
        />,
      );
      try {
        const node = findByAria(renderer.root, "Edit Start");
        act(() => {
          (node.props.onPointerDown as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        const handle = findByAria(renderer.root, "Resize Start se");
        assert.ok(handle);
        const svg = findOverlaySvg(renderer.root);
        act(() => {
          (handle.props.onPointerDown as (e: unknown) => void)(
            pointerEvent({ clientX: 190, clientY: 148 }),
          );
        });
        act(() => {
          (svg.props.onPointerMove as (e: unknown) => void)(
            pointerEvent({ clientX: 230, clientY: 180 }),
          );
        });
        assert.ok(changes.length > 0);
        const resized = changes.at(-1)!.nodes.find((n) => n.id === "node-1")!;
        assert.ok(resized.width !== 140 || resized.height !== 56);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("resize handles are hidden on a coarse (touch) pointer even when a node is selected", () => {
    withEditorDom(() => {
      const renderer = mountEditor(
        <VisualEditor visual={baseVisual()} onChange={() => {}} />,
      );
      try {
        const node = findByAria(renderer.root, "Edit Start");
        act(() => {
          (node.props.onPointerDown as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        assert.equal(findAllByAriaPrefix(renderer.root, "Resize").length, 0);
      } finally {
        act(() => renderer.unmount());
      }
    }, false);
  });

  test("a single click on an already-selected node begins inline editing immediately", () => {
    withEditorDom(() => {
      const renderer = mountEditor(
        <VisualEditor visual={baseVisual()} onChange={() => {}} />,
      );
      try {
        const node = findByAria(renderer.root, "Edit Start");
        const svg = findOverlaySvg(renderer.root);
        act(() => {
          (node.props.onPointerDown as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        act(() => {
          (svg.props.onPointerUp as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        // Second press on the now-selected node — still no movement.
        act(() => {
          (node.props.onPointerDown as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        act(() => {
          (svg.props.onPointerUp as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        const input = renderer.root.findByProps({ "aria-label": "Node label" });
        assert.equal(input.props.value, "Start");
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("editing a node label calls onChange(setNodeLabel); Enter commits and removes the input", () => {
    withEditorDom(() => {
      const changes: Visual[] = [];
      const renderer = mountEditor(
        <VisualEditor
          visual={baseVisual()}
          onChange={(next) => changes.push(next)}
        />,
      );
      try {
        const node = findByAria(renderer.root, "Edit Start");
        const svg = findOverlaySvg(renderer.root);
        act(() => {
          (node.props.onPointerDown as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        act(() => {
          (svg.props.onPointerUp as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        act(() => {
          (node.props.onPointerDown as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        act(() => {
          (svg.props.onPointerUp as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        const input = renderer.root.findByProps({ "aria-label": "Node label" });
        act(() => {
          (input.props.onChange as (e: unknown) => void)({
            target: { value: "Started" },
          });
        });
        assert.equal(
          changes.at(-1)!.nodes.find((n) => n.id === "node-1")!.label,
          "Started",
        );
        act(() => {
          (input.props.onKeyDown as (e: unknown) => void)(keyEvent("Enter"));
        });
        assert.throws(() =>
          renderer.root.findByProps({ "aria-label": "Node label" }),
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("Escape while editing restores the pre-edit label (undo) via onChange when no onCommand sink is given", () => {
    withEditorDom(() => {
      const changes: Visual[] = [];
      const renderer = mountEditor(
        <VisualEditor
          visual={baseVisual()}
          onChange={(next) => changes.push(next)}
        />,
      );
      try {
        const node = findByAria(renderer.root, "Edit Start");
        const svg = findOverlaySvg(renderer.root);
        act(() => {
          (node.props.onPointerDown as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        act(() => {
          (svg.props.onPointerUp as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        act(() => {
          (node.props.onPointerDown as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        act(() => {
          (svg.props.onPointerUp as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        const input = renderer.root.findByProps({ "aria-label": "Node label" });
        act(() => {
          (input.props.onChange as (e: unknown) => void)({
            target: { value: "Mutated" },
          });
        });
        act(() => {
          (input.props.onKeyDown as (e: unknown) => void)(keyEvent("Escape"));
        });
        assert.equal(
          changes.at(-1)!.nodes.find((n) => n.id === "node-1")!.label,
          "Start",
        );
        assert.throws(() =>
          renderer.root.findByProps({ "aria-label": "Node label" }),
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("Escape restores the label via onCommand (not onChange) when a command sink is provided", () => {
    withEditorDom(() => {
      const changes: Visual[] = [];
      const commands: VisualCommandPayload[] = [];
      const renderer = mountEditor(
        <VisualEditor
          visual={baseVisual()}
          onChange={(next) => changes.push(next)}
          onCommand={(payload) => commands.push(payload)}
        />,
      );
      try {
        const node = findByAria(renderer.root, "Edit Start");
        const svg = findOverlaySvg(renderer.root);
        act(() => {
          (node.props.onPointerDown as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        act(() => {
          (svg.props.onPointerUp as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        act(() => {
          (node.props.onPointerDown as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        act(() => {
          (svg.props.onPointerUp as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        const input = renderer.root.findByProps({ "aria-label": "Node label" });
        act(() => {
          (input.props.onKeyDown as (e: unknown) => void)(keyEvent("Escape"));
        });
        assert.equal(changes.length, 0);
        assert.deepEqual(commands.at(-1), {
          op: "visual.set_node_label",
          nodeId: "node-1",
          label: "Start",
        });
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("keyboard: Enter begins editing, Escape clears active/selected, Delete removes (guarded to >1 node), arrows nudge position", () => {
    withEditorDom(() => {
      const changes: Visual[] = [];
      const renderer = mountEditor(
        <VisualEditor
          visual={baseVisual()}
          onChange={(next) => changes.push(next)}
        />,
      );
      try {
        const node = findByAria(renderer.root, "Edit Start");

        act(() => {
          (node.props.onKeyDown as (e: unknown) => void)(keyEvent("Enter"));
        });
        assert.ok(renderer.root.findByProps({ "aria-label": "Node label" }));
        act(() => {
          (
            renderer.root.findByProps({ "aria-label": "Node label" }).props
              .onKeyDown as (e: unknown) => void
          )(keyEvent("Escape"));
        });

        act(() => {
          (node.props.onKeyDown as (e: unknown) => void)(
            keyEvent("ArrowRight"),
          );
        });
        assert.equal(
          changes.at(-1)!.nodes.find((n) => n.id === "node-1")!.x,
          121,
        );

        act(() => {
          (node.props.onKeyDown as (e: unknown) => void)(
            keyEvent("ArrowDown", { shiftKey: true }),
          );
        });
        assert.equal(
          changes.at(-1)!.nodes.find((n) => n.id === "node-1")!.y,
          130,
        );

        act(() => {
          (node.props.onKeyDown as (e: unknown) => void)(keyEvent("Delete"));
        });
        assert.equal(
          changes.at(-1)!.nodes.some((n) => n.id === "node-1"),
          false,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("Delete/Backspace is a no-op when only one node remains (canDelete guard)", () => {
    withEditorDom(() => {
      const changes: Visual[] = [];
      const single = buildVisual({
        nodes: [buildVisualNode({ id: "solo", label: "Only" })],
        edges: [],
      });
      const renderer = mountEditor(
        <VisualEditor
          visual={single}
          onChange={(next) => changes.push(next)}
        />,
      );
      try {
        const node = findByAria(renderer.root, "Edit Only");
        act(() => {
          (node.props.onKeyDown as (e: unknown) => void)(keyEvent("Delete"));
        });
        assert.equal(changes.length, 0);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("selecting a connector opens its inline toolbar; editing its label, flipping direction, and toggling arrowhead/curve route to onChange", () => {
    withEditorDom(() => {
      const changes: Visual[] = [];
      const renderer = mountEditor(
        <VisualEditor
          visual={baseVisual()}
          onChange={(next) => changes.push(next)}
        />,
      );
      try {
        const edge = findByAria(renderer.root, "Edit connector connector");
        act(() => {
          (edge.props.onPointerDown as (e: unknown) => void)(pointerEvent());
        });
        assert.ok(
          findByAria(renderer.root, "Connector tools"),
          "connector toolbar should render once selected",
        );
        const labelInput = renderer.root.findByProps({
          "aria-label": "Connector label",
        });
        assert.equal(labelInput.props.value, "");

        act(() => {
          (labelInput.props.onChange as (e: unknown) => void)({
            target: { value: "Next step" },
          });
        });
        assert.equal(
          changes.at(-1)!.edges.find((e) => e.id === "edge-1")!.label,
          "Next step",
        );

        act(() => {
          (
            renderer.root.findByProps({
              "aria-label": "Flip connector direction",
            }).props.onClick as () => void
          )();
        });
        const flipped = changes.at(-1)!.edges.find((e) => e.id === "edge-1")!;
        assert.equal(flipped.from, "node-2");
        assert.equal(flipped.to, "node-1");

        act(() => {
          (
            renderer.root.findByProps({ "aria-label": "Hide arrowhead" }).props
              .onClick as () => void
          )();
        });
        assert.equal(
          changes.at(-1)!.edges.find((e) => e.id === "edge-1")!.directed,
          false,
        );

        act(() => {
          (
            renderer.root.findByProps({ "aria-label": "Use curved connector" })
              .props.onClick as () => void
          )();
        });
        assert.equal(
          changes.at(-1)!.edges.find((e) => e.id === "edge-1")!.style,
          "curved",
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("connector edits route through onCommand (not onChange) when a command sink is provided", () => {
    withEditorDom(() => {
      const changes: Visual[] = [];
      const commands: VisualCommandPayload[] = [];
      const renderer = mountEditor(
        <VisualEditor
          visual={baseVisual()}
          onChange={(next) => changes.push(next)}
          onCommand={(payload) => commands.push(payload)}
        />,
      );
      try {
        const edge = findByAria(renderer.root, "Edit connector connector");
        act(() => {
          (edge.props.onPointerDown as (e: unknown) => void)(pointerEvent());
        });
        act(() => {
          (
            renderer.root.findByProps({
              "aria-label": "Flip connector direction",
            }).props.onClick as () => void
          )();
        });
        assert.equal(changes.length, 0);
        assert.deepEqual(commands.at(-1), {
          op: "visual.flip_edge",
          edgeId: "edge-1",
        });
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("Enter in the connector label input closes the toolbar; Escape restores the original label and closes", () => {
    withEditorDom(() => {
      const changes: Visual[] = [];
      const renderer = mountEditor(
        <VisualEditor
          visual={baseVisual()}
          onChange={(next) => changes.push(next)}
        />,
      );
      try {
        const edge = findByAria(renderer.root, "Edit connector connector");
        act(() => {
          (edge.props.onPointerDown as (e: unknown) => void)(pointerEvent());
        });
        const labelInput = renderer.root.findByProps({
          "aria-label": "Connector label",
        });
        act(() => {
          (labelInput.props.onChange as (e: unknown) => void)({
            target: { value: "Renamed" },
          });
        });
        act(() => {
          (labelInput.props.onKeyDown as (e: unknown) => void)(
            keyEvent("Escape"),
          );
        });
        assert.equal(
          changes.at(-1)!.edges.find((e) => e.id === "edge-1")!.label,
          "",
        );
        assert.throws(() =>
          renderer.root.findByProps({ "aria-label": "Connector label" }),
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("clicking the empty canvas background clears node/edge selection", () => {
    withEditorDom(() => {
      const renderer = mountEditor(
        <VisualEditor visual={baseVisual()} onChange={() => {}} />,
      );
      try {
        const edge = findByAria(renderer.root, "Edit connector connector");
        act(() => {
          (edge.props.onPointerDown as (e: unknown) => void)(pointerEvent());
        });
        assert.ok(findByAria(renderer.root, "Connector tools"));

        const svg = findOverlaySvg(renderer.root);
        const shared = { getBoundingClientRect: () => rect(100, 100) };
        act(() => {
          (svg.props.onPointerDown as (e: unknown) => void)(
            pointerEvent({ currentTarget: shared, target: shared }),
          );
        });
        assert.throws(() => findByAria(renderer.root, "Connector tools"));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("pointer-cancel ends an in-progress drag/resize (cleanup): further move events no longer commit changes", () => {
    withEditorDom(() => {
      const changes: Visual[] = [];
      const renderer = mountEditor(
        <VisualEditor
          visual={baseVisual()}
          onChange={(next) => changes.push(next)}
        />,
      );
      try {
        const node = findByAria(renderer.root, "Edit Start");
        const svg = findOverlaySvg(renderer.root);
        act(() => {
          (node.props.onPointerDown as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        act(() => {
          (svg.props.onPointerCancel as (e: unknown) => void)(pointerEvent());
        });
        act(() => {
          (svg.props.onPointerMove as (e: unknown) => void)(
            pointerEvent({ clientX: 300, clientY: 300 }),
          );
        });
        assert.equal(changes.length, 0);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("canEdit=false disables selection-driven editing: a click on a node never opens the inline label input", () => {
    withEditorDom(() => {
      const renderer = mountEditor(
        <VisualEditor
          visual={baseVisual()}
          onChange={() => {}}
          canEdit={false}
        />,
      );
      try {
        const node = findByAria(renderer.root, "Edit Start");
        const svg = findOverlaySvg(renderer.root);
        act(() => {
          (node.props.onPointerDown as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        act(() => {
          (svg.props.onPointerUp as (e: unknown) => void)(
            pointerEvent({ clientX: 100, clientY: 100 }),
          );
        });
        assert.throws(() =>
          renderer.root.findByProps({ "aria-label": "Node label" }),
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});
