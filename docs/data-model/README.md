---
type: "contract"
status: "current"
last_updated: "2026-07-16"
description: "These documents define persisted JSON contracts and database projections. They are the first place to update when a schema or source-of-truth boundary changes."
---

# Data Model Contracts

These documents define persisted JSON contracts and database projections. They
are the first place to update when a schema or source-of-truth boundary changes.

| Document                                                                             | Type         | Scope                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [canonical-deck-contract.md](canonical-deck-contract.md)                             | Architecture | Canonical persisted `Deck` contract boundary, `safeParseDeck` as single validation entry, active v6 violations as migration risks, complete deck-kernel import inventory (36 statements / 14 files / 8 families), diff/metrics dependency sequencing, topological staged migration (B3–B8-e) including data migration gates. |
| [deck.md](deck.md)                                                                   | Contract     | Current Deck `Document.deckJson` shape, schema gate, open/save boundaries, render/export.                                                                                                                                                                                                                                    |
| [document-persistence.md](document-persistence.md)                                   | Architecture | Document save transactions, visual mirror rebuilds, deck CAS writes, and version restore.                                                                                                                                                                                                                                    |
| [database-persistence.md](database-persistence.md)                                   | Architecture | Prisma provider resolution, client setup, relational groups, and retention semantics.                                                                                                                                                                                                                                        |
| [visual-mirror.md](visual-mirror.md)                                                 | Contract     | Projection from Lexical visual nodes in `contentJson` to `Visual` rows.                                                                                                                                                                                                                                                      |
| [../system/identity-and-payload-naming.md](../system/identity-and-payload-naming.md) | Reference    | Durable id, source-ref/anchor, asset reference, and payload suffix vocabulary.                                                                                                                                                                                                                                               |

## Rules

- Current schemas are authoritative.
- Runtime render/export paths consume current payloads directly.
- Obsolete payload shapes are not documented as supported contracts.
- Plan documents may describe future schema changes, but they are not runtime
  contracts until source, validation, tests, and this subsystem are updated.
