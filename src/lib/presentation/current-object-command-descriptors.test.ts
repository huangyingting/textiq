import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CURRENT_OBJECT_ALIGN_COMMAND_DESCRIPTORS,
  CURRENT_OBJECT_COMMAND_DESCRIPTORS,
  CURRENT_OBJECT_COMMAND_FAMILIES,
  CURRENT_OBJECT_COMMAND_SURFACES,
  CURRENT_OBJECT_COMMAND_SURFACE_LABELS,
  CURRENT_OBJECT_DISABLED_REASON_LABELS,
  CURRENT_OBJECT_DISABLED_REASONS,
  CURRENT_OBJECT_INSERT_NODE_COMMAND_DESCRIPTORS,
  CURRENT_OBJECT_REORDER_COMMAND_DESCRIPTORS,
  currentObjectAlignCommandDescriptor,
  currentObjectCommandDescriptor,
  currentObjectCommandDescriptorsForSurface,
  currentObjectInsertNodeCommandDescriptor,
  currentObjectReorderCommandDescriptor,
  findCurrentObjectCommandDescriptor,
} from "./current-object-command-descriptors";

describe("current-object command descriptor catalog", () => {
  test("defines a stable surface and disabled-reason vocabulary", () => {
    assert.deepEqual(CURRENT_OBJECT_COMMAND_SURFACES, [
      "toolbar",
      "popover",
      "inspector",
      "keyboard",
      "stage",
    ]);
    assert.deepEqual(
      Object.keys(CURRENT_OBJECT_COMMAND_SURFACE_LABELS).sort(),
      [...CURRENT_OBJECT_COMMAND_SURFACES].sort(),
    );
    assert.deepEqual(
      Object.keys(CURRENT_OBJECT_DISABLED_REASON_LABELS).sort(),
      [...CURRENT_OBJECT_DISABLED_REASONS].sort(),
    );
  });

  test("keeps every descriptor mapped to one family and at least one owner", () => {
    const ids = CURRENT_OBJECT_COMMAND_DESCRIPTORS.map(
      (descriptor) => descriptor.id,
    );
    assert.equal(new Set(ids).size, ids.length);

    for (const descriptor of CURRENT_OBJECT_COMMAND_DESCRIPTORS) {
      assert.ok(descriptor.label.length > 0, descriptor.id);
      assert.ok(descriptor.accessibilityLabel.length > 0, descriptor.id);
      assert.ok(descriptor.liveMessage.length > 0, descriptor.id);
      assert.ok(descriptor.currentObjects.length > 0, descriptor.id);
      assert.ok(descriptor.owners.length > 0, descriptor.id);
      assert.ok(
        CURRENT_OBJECT_COMMAND_FAMILIES.includes(descriptor.family),
        descriptor.id,
      );
      for (const owner of descriptor.owners) {
        assert.ok(
          CURRENT_OBJECT_COMMAND_SURFACES.includes(owner.surface),
          `${descriptor.id} owner ${owner.ownerId}`,
        );
      }
      for (const reason of descriptor.disabledReasons) {
        assert.ok(reason in CURRENT_OBJECT_DISABLED_REASON_LABELS);
      }
    }

    for (const family of CURRENT_OBJECT_COMMAND_FAMILIES) {
      assert.ok(
        CURRENT_OBJECT_COMMAND_DESCRIPTORS.some(
          (descriptor) => descriptor.family === family,
        ),
        `${family} should have a descriptor`,
      );
    }

    for (const surface of CURRENT_OBJECT_COMMAND_SURFACES) {
      assert.ok(
        currentObjectCommandDescriptorsForSurface(surface).length > 0,
        `${surface} should have an owning descriptor`,
      );
    }
  });

  test("looks up descriptors by id and surface", () => {
    assert.equal(
      currentObjectCommandDescriptor("selection.align-left").family,
      "align-selection",
    );
    assert.equal(findCurrentObjectCommandDescriptor("missing"), undefined);
    assert.ok(
      currentObjectCommandDescriptorsForSurface("toolbar").some(
        (descriptor) => descriptor.id === "source.review",
      ),
    );
    const connector = currentObjectCommandDescriptor("connector.create");
    assert.deepEqual(connector.currentObjects, [
      "text",
      "shape",
      "image",
      "visual",
      "table",
    ]);
    assert.deepEqual(
      connector.owners.map((owner) => `${owner.surface}:${owner.ownerId}`),
      [
        "stage:connector-endpoint-gesture",
        "keyboard:slide-editor-keyboard",
        "popover:context-toolbar",
      ],
    );
    assert.deepEqual(connector.disabledReasons, [
      "missing-selection",
      "unsupported-current-object",
      "missing-handler",
    ]);
  });

  test("throws descriptive errors for invalid descriptor lookups", () => {
    assert.throws(
      () => currentObjectCommandDescriptor("missing" as never),
      /Unknown current-object command descriptor: missing/,
    );
    assert.throws(
      () => currentObjectAlignCommandDescriptor("diagonal" as never),
      /Unknown current-object align command mode: diagonal/,
    );
    assert.throws(
      () => currentObjectReorderCommandDescriptor("sideways" as never),
      /Unknown current-object reorder command mode: sideways/,
    );
    assert.throws(
      () => currentObjectInsertNodeCommandDescriptor("video" as never),
      /Unknown current-object insert node kind: video/,
    );
  });
});

describe("current-object command descriptor bijections", () => {
  test("keeps insert-node descriptors bijective with slide insert kinds", () => {
    assert.deepEqual(
      CURRENT_OBJECT_INSERT_NODE_COMMAND_DESCRIPTORS.map(
        (descriptor) => descriptor.nodeKind,
      ),
      ["text", "shape", "image", "visual", "connector", "table"],
    );

    for (const descriptor of CURRENT_OBJECT_INSERT_NODE_COMMAND_DESCRIPTORS) {
      assert.equal(
        currentObjectInsertNodeCommandDescriptor(descriptor.nodeKind),
        descriptor,
      );
      assert.equal(descriptor.family, "insert-node");
      assert.ok(
        descriptor.owners.some(
          (owner) =>
            owner.surface === "popover" && owner.ownerId === "context-toolbar",
        ),
      );
    }
  });

  test("keeps align descriptors bijective with toolbar and inspector arrange modes", () => {
    assert.deepEqual(
      CURRENT_OBJECT_ALIGN_COMMAND_DESCRIPTORS.map(
        (descriptor) => descriptor.mode,
      ),
      ["left", "center", "right", "top", "middle", "bottom"],
    );

    for (const descriptor of CURRENT_OBJECT_ALIGN_COMMAND_DESCRIPTORS) {
      assert.equal(
        currentObjectAlignCommandDescriptor(descriptor.mode),
        descriptor,
      );
      assert.ok(
        descriptor.owners.some(
          (owner) =>
            owner.surface === "popover" && owner.ownerId === "context-toolbar",
        ),
      );
      assert.ok(
        descriptor.owners.some(
          (owner) =>
            owner.surface === "inspector" && owner.inspectorPanel === "arrange",
        ),
      );
    }
  });

  test("keeps reorder descriptors bijective with toolbar and inspector commands", () => {
    assert.deepEqual(
      CURRENT_OBJECT_REORDER_COMMAND_DESCRIPTORS.map(
        (descriptor) => descriptor.mode,
      ),
      ["forward", "backward", "front", "back"],
    );
    for (const descriptor of CURRENT_OBJECT_REORDER_COMMAND_DESCRIPTORS) {
      assert.equal(
        currentObjectReorderCommandDescriptor(descriptor.mode),
        descriptor,
      );
      assert.ok(
        descriptor.owners.some(
          (owner) =>
            owner.surface === "popover" && owner.ownerId === "context-toolbar",
        ),
      );
      assert.ok(
        descriptor.owners.some(
          (owner) =>
            owner.surface === "inspector" && owner.inspectorPanel === "arrange",
        ),
      );
    }
  });

  test("keeps multi-selection arrange descriptors aligned with toolbar verbs", () => {
    assert.ok(
      CURRENT_OBJECT_COMMAND_DESCRIPTORS.some(
        (descriptor) => descriptor.id === "selection.distribute-horizontal",
      ),
    );
    assert.ok(
      CURRENT_OBJECT_COMMAND_DESCRIPTORS.some(
        (descriptor) => descriptor.id === "selection.distribute-vertical",
      ),
    );
    assert.ok(
      CURRENT_OBJECT_COMMAND_DESCRIPTORS.some(
        (descriptor) => descriptor.id === "selection.match-width",
      ),
    );
    assert.ok(
      CURRENT_OBJECT_COMMAND_DESCRIPTORS.some(
        (descriptor) => descriptor.id === "selection.match-height",
      ),
    );
  });
});
