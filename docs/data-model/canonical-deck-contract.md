---
type: "architecture"
status: "accepted"
last_updated: "2026-07-14"
description: "Declares src/lib/presentation/schema.ts as the canonical persisted Deck contract and safeParseDeck as the single validation entry for persisted/cross-subsystem deck JSON. Records the convergence target for deck-kernel types and validators, the non-bridge constraint, and staged migration criteria."
---

# Canonical Deck Contract (B2)

This decision records the authoritative boundary for the persisted `Deck`
contract and names `safeParseDeck` as the single validation entry for
persisted and cross-subsystem deck JSON. It separates current state from
target state and makes the staged migration path explicit.

## Current State

### Canonical contract

`src/lib/presentation/schema.ts` defines the persisted `Deck` type
(`schemaVersion: 7`). This is the **only** accepted shape for
`Document.deckJson` at runtime.

`src/lib/presentation/validation.ts` exports `safeParseDeck`, which
validates unknown input against that schema without mutation. It is the
single validation entry for any boundary that touches persisted or
cross-subsystem deck JSON.

A thin re-export facade exists at `src/lib/deck/current-deck-schema.ts`
so document-owned code can import the canonical contract without reaching
directly into presentation runtime paths:

```ts
// src/lib/deck/current-deck-schema.ts
export { DECK_SCHEMA_VERSION } from "@/lib/presentation/schema";
export type {
  Deck,
  SlideChildNode,
  SlideNode,
} from "@/lib/presentation/schema";
export { safeParseDeck } from "@/lib/presentation/validation";
export type { DeckParseResult } from "@/lib/presentation/validation";
```

### Legacy v6 boundary (deck-kernel)

`src/lib/document/deck-kernel/deck-core.ts` defines a separate `Deck`
type for the legacy v6 payload shape (`schemaVersion: 6`). Its fields
(`elements`, `masters`, `customTemplates`, `design`, `defaultMasterId`)
are **not** valid in the current persisted contract and are rejected by
`safeParseDeck`.

`src/lib/document/deck-kernel/deck-validation/core.ts` — `validateDeck`
— validates the legacy v6 schema. It operates on the deck-kernel `Deck`
type, not on the presentation `Deck`.

### Document facade divergence

`src/lib/document/deck-schema.ts` exposes both boundaries under one
module:

- `CurrentDeck`, `safeParseCurrentDeck`, `CurrentSlideNode`,
  `CurrentSlideChildNode`, `CURRENT_DECK_SCHEMA_VERSION` — re-exported
  from `src/lib/deck/current-deck-schema.ts` (canonical v7 contract).
- `Deck` (legacy v6), `safeParseDeck` (wraps deck-kernel `validateDeck`),
  `DeckParseResult` — the legacy v6 boundary, exposed under the same
  unqualified names.

This dual exposure means a reader of `deck-schema.ts` encounters two
types both named `Deck` and two functions both named `safeParseDeck`, one
canonical and one legacy.

### Data-contract registry

`src/lib/data-contracts/persisted-json.ts` registers the canonical
`safeParseDeck` from `src/lib/presentation/validation.ts` as the
validator for the `Document.deckJson` contract area. The schema-audit
script at `src/lib/schema-audit/audit.ts` uses this registry exclusively.

## Target State

1. `src/lib/presentation/schema.ts` remains the single source of truth for
   the persisted `Deck` type.
2. `safeParseDeck` from `src/lib/presentation/validation.ts` is the single
   validation entry for persisted and cross-subsystem deck JSON.
   All call sites that currently reach the legacy `validateDeck` in
   `deck-validation/core.ts` for persistence purposes must be migrated to
   `safeParseDeck`.
3. The deck-kernel `Deck` type and its `validateDeck` function converge onto
   the v7 contract or are retired. No translation layer, bridge, alias
   facade, or legacy/v6 compatibility path is introduced in the process.
4. `src/lib/document/deck-schema.ts` exposes only the canonical v7
   boundary. Legacy exports (`Deck`, `safeParseDeck`, `DeckParseResult` as
   the v6 variants) are removed when all consumers are migrated.
5. `src/lib/deck/current-deck-schema.ts` is collapsed into its single
   consumer (`deck-schema.ts`) or retained as a thin stable facade — not
   as a migration artifact.
6. AI and downstream consumers depend on the thin presentation contract
   surface (`schema.ts`, `validation.ts`) rather than on
   implementation registries or deck-kernel internals.

## Dependency Direction

```
persistence / AI / downstream consumers
          ↓
  src/lib/presentation/schema.ts      ← canonical Deck type
  src/lib/presentation/validation.ts  ← safeParseDeck (single validation entry)
          ↓
  src/lib/deck/current-deck-schema.ts ← thin facade (migration target: collapse)
          ↓
  src/lib/document/deck-schema.ts     ← document facade (migration target: v7-only)
```

`deck-kernel/deck-validation/` and `deck-kernel/deck-core.ts` are
**migration targets**, not endorsed permanent boundaries for persisted
contracts.

## Invariants

1. The persisted `Deck` contract is `schemaVersion: 7` as defined in
   `src/lib/presentation/schema.ts`. No other version is accepted by the
   runtime.
2. `safeParseDeck` (`src/lib/presentation/validation.ts`) is the only
   permitted validator for `Document.deckJson` writes, reads, and
   cross-subsystem handoffs.
3. No bridge, translation layer, alias facade, or legacy/v6 compatibility
   path may be added to make older deck shapes pass validation. Repair
   happens at import/AI-plan/paste boundaries before reaching
   `safeParseDeck`.
4. The deck-kernel `Deck` type and `validateDeck` must not be used for
   persisted-payload validation. They are internal legacy objects pending
   convergence.
5. The data-contract registry (`persisted-json.ts`) and schema-audit
   (`audit.ts`) must reference `safeParseDeck` from
   `src/lib/presentation/validation.ts` exclusively.

## Staged Migration

The following steps are **not yet implemented**. They are targets for
future refactor batches.

| Step | Target                                                                                   | Acceptance check                                                                 |
| ---- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| B3   | Migrate deck-kernel `Deck` type to extend or alias presentation `Deck`.                  | `deck-core.ts` no longer defines a separate v6 shape; existing tests still pass. |
| B4   | Migrate `validateDeck` in `deck-validation/core.ts` to delegate to `safeParseDeck`.      | Legacy `validateDeck` callers removed or re-pointed; schema-audit green.         |
| B5   | Remove legacy exports from `src/lib/document/deck-schema.ts`.                            | Only `CurrentDeck`, `safeParseCurrentDeck`, and v7 surface remain.               |
| B6   | Collapse `src/lib/deck/current-deck-schema.ts` if its only consumer is `deck-schema.ts`. | No other module imports `current-deck-schema`; facade file deleted or kept thin. |

## Non-Goals

- This decision does **not** change any source file. B2 is documentation only.
- No runtime migration shim or compatibility path for v6 payloads is
  introduced at any step.
- The staged migration steps above are not claimed to be complete.
  Source, tests, and schemas are authoritative; this document reflects
  intent, not implementation.

## Validation and Rollback Criteria

**Green:** `npm run docs:check` passes. `src/lib/presentation/validation.ts`
continues to export `safeParseDeck`. `src/lib/data-contracts/persisted-json.ts`
imports `safeParseDeck` from `src/lib/presentation/validation.ts`. No new
source files are changed in B2.

**Rollback:** If a later batch introduces a bridge or compatibility shim
instead of converging, revert that batch. This decision record is the
constraint; source changes that contradict invariants 3–4 above must not
land.

## Related Documents

- [deck.md](deck.md) — persisted `Deck` JSON shape, schema gate, open/save
  boundaries, render/export.
- [document-persistence.md](document-persistence.md) — document save
  transactions, visual mirror rebuilds, deck CAS writes, version restore.
- [../presentation/rendering-and-export.md](../presentation/rendering-and-export.md) — shared slide rendering, present/public viewers, export specs.
- [../presentation/autosave-and-commands.md](../presentation/autosave-and-commands.md) — slide editor autosave and deck command execution.
