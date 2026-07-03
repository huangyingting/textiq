---
type: "architecture"
status: "current"
last_updated: "2026-07-04"
description: "These documents describe the Lexical document editor and editor-owned comment UX. Presentation theme, slide editor, rendering, and export behavior belong to the presentation subsystem."
---

# Editor Architecture

These documents describe the Lexical document editor and editor-owned comment
UX. Presentation theme, slide editor, rendering, and export behavior belong to
the presentation subsystem.

| Document                                           | Type         | Scope                                                                                     |
| -------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------- |
| [document-editor.md](document-editor.md)           | Architecture | Lexical editor selection model, tool registry, visual lifecycle, and autosave.            |
| [lexical-runtime.md](lexical-runtime.md)           | Architecture | Durable block ids, VisualNode serialization, plugin registration, and editor write paths. |
| [comments-and-anchors.md](comments-and-anchors.md) | Design       | Comment threads, text/visual anchors, slide anchors, and lifecycle behavior.              |

## Related Contracts

- [../data-model/deck.md](../data-model/deck.md) for persisted deck shape.
- [../data-model/visual-mirror.md](../data-model/visual-mirror.md) for visual persistence.
- [../presentation/slide-editor.md](../presentation/slide-editor.md) for the
  slide editor runtime.
- [../presentation/theme-packages.md](../presentation/theme-packages.md) for
  slide theme packages, semantic templates, and style resolution.
- [../presentation/rendering-and-export.md](../presentation/rendering-and-export.md)
  for present mode and export behavior.
