---
type: "architecture"
status: "current"
last_updated: "2026-07-01"
description: "These documents describe cross-subsystem architecture contracts. If a design changes during development, update the relevant contract so it continues to describe the current system."
---

# System Docs

These documents describe cross-subsystem architecture contracts. If a design
changes during development, update the relevant contract so it continues to
describe the current system.

## Overview

| Document                                                         | Scope                                                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)                               | End-to-end system architecture and source-of-truth map.                                                    |
| [documentation-map.md](documentation-map.md)                     | Code subsystem to documentation coverage map.                                                              |
| [design-system.md](design-system.md)                             | App chrome token ownership, shared UI primitives, and guardrails for z-index/color usage.                  |
| [z-order-plan.md](z-order-plan.md)                               | Semantic z-order system: layer scale, canvas/menu tiers, and overlay-stacking migration plan.              |
| [identity-and-payload-naming.md](identity-and-payload-naming.md) | Durable identity taxonomy, asset URL vocabulary, and payload/result suffix playbook.                       |
| [architecture-decisions.md](architecture-decisions.md)           | Architecture Decision Records (ADRs), accepted-decision index, supersession fields, and source-drift rule. |

## Contract Groups

| Group                                       | Documents                                                    |
| ------------------------------------------- | ------------------------------------------------------------ |
| [ai](../ai/README.md)                       | AI generation request flow and validation contracts.         |
| [auth](../auth/README.md)                   | Authentication, recovery, and account lifecycle.             |
| [collaboration](../collaboration/README.md) | Collaboration room model, readiness, and authorization.      |
| [data-model](../data-model/README.md)       | Deck JSON and visual mirror contracts.                       |
| [documents](../documents/README.md)         | Document creation, listing, search, tags, and trash.         |
| [editor](../editor/README.md)               | Lexical editor surfaces and slide theme/layout architecture. |
| [import](../import/README.md)               | Document import validation, parsing, and abuse controls.     |
| [localization](../localization/README.md)   | Typed catalogs, locale resolution, and activation gating.    |
| [presentation](../presentation/README.md)   | Slide editor runtime, present mode, and export pipeline.     |
| [product](../product/README.md)             | Brand styles, billing plans, and credits.                    |
| [public-render](../public-render/README.md) | Public share/embed/present render resolution.                |
| [security](../security/README.md)           | Permissions, public sharing, and protected asset access.     |
| [visual](../visual/README.md)               | Visual schemas, kind registry, rendering, and export.        |
| [commands](../commands/README.md)           | Command envelope and mutation routing inventory.             |
| [diagnostics](../diagnostics/README.md)     | Structured logging scopes, diagnostic codes, and telemetry.  |

Operational material lives under [../operations/](../operations/README.md).

## Current Invariants

- `Document.contentJson` is the source of truth for document text and embedded
  visuals.
- `Visual` rows are a derived projection of visual nodes in `contentJson`.
- `Document.deckJson` is the source of truth for slides.
- Persisted decks must be current Deck payloads with slide content under
  `SlideNode.children`.
- Render, export, and editor surfaces consume Deck nodes directly; they do not
  synthesize old deck shapes at runtime.
- Deck saves are guarded by revision-token compare-and-swap.
- Collaboration websocket upgrades require authorization.

## Schema Policy

The current design assumes development data can be regenerated or discarded when
schemas change. Document the current payload shape, not superseded shapes.
