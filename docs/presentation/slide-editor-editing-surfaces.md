---
type: "design"
status: "current"
last_updated: "2026-07-07"
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

## Layer Management

Layering is type-banded rather than globally freeform. The system keeps stable type bands for slide objects, and users manage order only within compatible layer groups.

Layer management lives in the right inspector panel's Layers panel.

The Layers panel:

- Groups user layers by element type band.
- Shows generated theme decoration and deck chrome layers as read-only generated groups.
- Supports rename, hide/show, and lock/unlock for user layers.
- Supports drag or move controls only within the same type group.
- Does not allow user-facing cross-type bring/send commands.

User-facing bring/send commands are removed from popover toolbars, the right-click menu, and ordinary arrange panels. Internal zIndex remains part of the data model and render order but is not an ordinary user-editable field.
