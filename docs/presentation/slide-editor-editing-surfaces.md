---
type: "design"
status: "current"
last_updated: "2026-07-17"
description: "Interaction ownership rules for the slide editor canvas popover, element popover toolbar, right inspector panel, right-click menu, and layer management."
---

# Slide Editor Editing Surfaces

The slide editor exposes three editing surfaces with distinct ownership:

- Popover toolbar: nearby, high-frequency edits for the current object.
- Right inspector panel: the complete configuration surface for the current object.
- Right-click menu: object operations such as clipboard, grouping, locking, hiding, and connector detachment.

Canvas is treated as an editable object. Its popover toolbar owns common current-slide actions, while deck-level actions stay in the top toolbar.

## Canvas Popover Toolbar

The canvas popover appears when the slide/canvas is the current object.

It includes:

- Current slide background color.
- Insert text.
- Insert shape, with shape choice handled by the insert flow.
- Insert image.
- Insert visual.
- Insert connector.
- Insert table.
- Insert from document when document source blocks are available.
- A More/Inspector entry that opens the right inspector panel for full canvas configuration.

It excludes:

- Add slide, duplicate slide, and delete slide. These are top-toolbar deck/slide actions.
- Deck theme, brand, global font, master, and deck chrome settings.
- Clipboard, grouping, locking, hiding, and layer ordering operations.

## Element Popover Toolbar

The element popover appears for the current element and only exposes commonly used properties for that element type, plus a More/Inspector entry that opens the right inspector panel.

Shared rules:

- Clipboard, duplicate, delete, group, ungroup, lock, hide, and layer ordering are not element-popover actions.
- More opens the right inspector panel at the current object's default full-configuration panel. It does not open a popover submenu of panel links.
- The right inspector panel remains the source of complete configuration, including properties duplicated in the popover.

Text popover:

- Includes bold, italic, underline, strikethrough, text color, font size, and text alignment.
- Includes list, indent, and link controls only while inline text editing supports them.
- Excludes role selection, text content editing, font family, line height, and advanced typography.

Shape popover:

- Includes fill color, stroke color, stroke width, opacity, and rotation shortcuts.
- Excludes shape type. Shape choice belongs in the insert flow and the full right panel.

Image popover:

- Includes image fit, crop toggle, reset crop, opacity, and rotation shortcuts.
- Excludes image replacement, numeric crop sides, brightness, contrast, saturation, blur, and source/binding/layer settings.

Visual popover:

- Includes transparent background.
- Excludes visual replacement and visual theme/style selection.

Connector popover:

- Includes routing, line color, line width, start arrow, and end arrow.
- Excludes endpoint detachment and exact endpoint coordinates.

Table popover:

- Includes enter table edit, add row, add column, delete row, delete column, and header row toggle.
- Table row and column commands are allowed here because they are core table content editing, not generic object operations.

Multi-selection popover:

- Includes align, distribute, and match-size commands.
- Excludes group, ungroup, delete, duplicate, clipboard, lock, hide, and layer ordering.

## Right Inspector Panel

The right inspector panel is hidden by default and opens only through the popover More/Inspector entry, a fixed inspector entry, or a keyboard/command-palette path. Selecting an object does not automatically open it.

Desktop behavior:

- The panel occupies a right-side layout column when open.
- Closing the panel restores the stage width.

Mobile behavior:

- The panel opens as a sheet/drawer.

Panel header:

- Shows the current target: Canvas, Text, Shape, Image, Visual, Connector, Table, Group, Selection, Decoration, or the object's name when available.
- Provides a close button.
- Updates as selection changes while the panel is open.
- Falls back to Canvas when the previous target is deleted.

Panel content:

- Provides full object configuration through its own panel selector/tabs: main configuration, arrange, style, effects, source, layers, diagnostics, and other object-specific panels.
- Includes all popover-exposed properties plus advanced properties.
- Removes editable raw Layer/zIndex fields from ordinary geometry editing.

## Right-Click Menu

The right-click menu owns object operations.

It includes:

- Select overlapping layer/object when multiple candidates are under the pointer.
- Copy.
- Cut.
- Paste.
- Duplicate.
- Delete.
- Group and ungroup.
- Lock and unlock.
- Hide and show.
- Detach connector start/end for connectors attached to nodes.

It excludes:

- Edit text and edit table. Enter editing through double click, Enter, or table-specific editing controls.
- Bring to front, send to back, bring forward, and send backward.
- Style, color, typography, crop, image adjustment, source, binding, diagnostics, and inspector-tab navigation.

## Group Selection And Editing

Grouping is a structural operation, not an editing mode.

Group behavior:

- Grouping selected elements creates a group and selects the new group.
- Grouping does not enter a persistent group editing mode.
- The editor does not show an `Editing group` badge or an `Exit` button.
- Ungrouping finds the selected group at any supported nesting depth, replaces it
  with its direct children at the same parent/sibling position, and selects those
  former children. Nested group children remain grouped until explicitly
  ungrouped.
- Locked or hidden groups cannot be grouped or ungrouped. This prevents a
  structural command from bypassing lock state or making a hidden subtree
  visible.
- Groups are logical selection and stacking containers. Their children retain
  slide-absolute frames and rotations; group move, resize, and rotation commands
  bake geometry changes into descendants.
- Renderers and exporters therefore do not paint group fill/effects or apply a
  nested group transform. Group layout remains authoritative for selection
  bounds, manipulation, hit testing, and placement of the whole subtree among
  the group's siblings.
- Logical groups do not support `style` or `localStyle`. The schema rejects both
  fields, group creation does not write them, and style-binding/local-style
  commands ignore group targets. Visual styling belongs to descendants and keeps
  the normal theme binding, deck override, and node `localStyle` precedence,
  including for source-linked descendants.

Group child selection uses progressive clicks:

- First click on a grouped element selects the parent group.
- When the parent group is already selected, clicking a child selects that child.
- When a group child is selected, its popover toolbar and right inspector panel show the child configuration, not the parent group configuration.
- Clicking empty space inside the selected group keeps the parent group selected.
- Double-clicking a grouped text/table child enters that child editing surface directly; double-clicking grouped shapes, images, visuals, or connectors selects the child.

Group context is visual only:

- When a group child is selected, the parent group may show a lightweight context outline.
- The context outline does not create a mode and does not need an explicit Exit action.
- Escape exits by selection hierarchy: text/table editing first, then child to parent group, then parent group to canvas/no selection.

## Layer Management

Each parent node is an independent stacking context. Direct siblings are sorted
back-to-front by finite `layout.zIndex`; missing, `NaN`, and infinite values
deterministically fall back to zero, and source order is the stable tie-break.
A grouped child's z-index competes only with children of the same group, never
with the group's top-level siblings.

Layer management lives in the right inspector panel's Layers panel.

The Layers panel:

- Shows nested user layers in the same canonical foreground-to-background order
  used by editor, present/public rendering, hit testing, and export.
- Shows generated theme decoration and deck chrome layers as read-only generated groups.
- Supports rename, hide/show, and lock/unlock for user layers.
- Supports move controls only between direct siblings in the same parent.
- Does not move a node across a group boundary or into a different parent.

User-facing bring/send commands are removed from popover toolbars and the
right-click menu. Layers move controls update and normalize the selected sibling
set only; unrelated parent contexts retain their z-index values. Internal
`zIndex` remains part of the data model and render order but is not an ordinary
user-editable field.
