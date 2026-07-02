---
type: "architecture"
status: "current"
last_updated: "2026-07-02"
description: "These documents describe the runtime presentation layer: the slide editor UI, stage interactions, present mode, and export pipeline. They sit between the persisted deck contract and the React components that render/edit slides."
---

# Presentation Architecture

These documents describe the runtime presentation layer: the slide editor UI,
stage interactions, present mode, and export pipeline. They sit between the
persisted deck contract and the React components that render/edit slides.

| Document                                                                         | Type         | Scope                                                                                              |
| -------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| [slide-editor.md](slide-editor.md)                                               | Architecture | Slide editor runtime, stage/inspector boundaries, autosave, source links, and presence.            |
| [slide-stage-interactions.md](slide-stage-interactions.md)                       | Design       | Stage hit-testing, preselection, selection, drag, edit, keyboard, connector, and overlap behavior. |
| [theme-packages.md](theme-packages.md)                                           | Contract     | Theme package catalog, apply behavior, template identity, and master boundaries.                   |
| [assets.md](assets.md)                                                           | Architecture | Slide image upload, storage, protected serving, deck references, and cleanup.                      |
| [rendering-and-export.md](rendering-and-export.md)                               | Architecture | Shared slide rendering, present/public viewers, export specs, and preflight diagnostics.           |
| [vnext-editor-decomposition-plan.md](vnext-editor-decomposition-plan.md)         | Plan         | P0 plan to shrink the vNext editor shell into explicit controllers while preserving behavior.      |
| [legacy-retirement-plan.md](legacy-retirement-plan.md)                           | Plan         | P0 plan to extract shared presentation kernel code and retire the orphaned v6 stack.               |
| [vnext-test-strategy-plan.md](vnext-test-strategy-plan.md)                       | Plan         | P1 plan to replace oversized/internals-coupled tests with refactor-safe presentation coverage.     |
| [vnext-render-source-boundaries-plan.md](vnext-render-source-boundaries-plan.md) | Plan         | P1/P2 plan for render, export, source, diagnostic, present/public, and provenance boundaries.      |

Future presentation work should live in this directory as `*-plan.md` and must
separate current behavior from target behavior, phases, and acceptance checks.

## Related Contracts

- [../data-model/deck.md](../data-model/deck.md) for the persisted deck JSON
  shape.
- [theme-packages.md](theme-packages.md) for theme package, style, template, and
  decoration resolution.
- [../commands/command-envelope.md](../commands/command-envelope.md) for
  serializable command metadata.
- [../public-render/README.md](../public-render/README.md) for public
  share/embed/present/asset resolution.
- [../security/access-and-sharing.md](../security/access-and-sharing.md) for
  public route and protected asset access policy.
- [../visual/README.md](../visual/README.md) for visual kind registry and
  renderer/export capabilities.

## Boundaries

- Presentation components consume current DeckV7 slide nodes directly.
- The editor owns interactions and deck mutations; render/export code stays
  read-only.
- Export code is split into pure spec builders and browser/PPTX appliers.
- Superseded deck payloads are rejected at the open boundary; runtime rendering
  and export do not branch on old deck shapes.
