---
type: "architecture"
status: "accepted"
last_updated: "2026-07-14"
description: "Declares src/lib/presentation/schema.ts as the canonical persisted Deck contract and safeParseDeck as the single validation entry for persisted/cross-subsystem deck JSON. Records active violations of the canonical contract, retirement targets for deck-kernel types and validators, the non-bridge constraint, and staged migration criteria including data migration gates."
---

# Canonical Deck Contract (B2)

This decision records the authoritative boundary for the persisted `Deck`
contract and names `safeParseDeck` as the single validation entry for
persisted and cross-subsystem deck JSON. It separates current state from
target state and makes the staged migration path explicit.

## Current State

### Canonical contract

`src/lib/presentation/schema.ts` defines the persisted `Deck` type
(`schemaVersion: 7`). This is the canonical accepted shape for
`Document.deckJson`. Active violations of this constraint are documented
in the [Active violations](#active-violations-migration-risks) subsection
below.

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

`src/lib/document/deck-schema.ts` exposes both boundaries and several
deck-kernel validation utilities under one module:

- **Qualified canonical names** (`Current*`): `CurrentDeck`,
  `safeParseCurrentDeck`, `CurrentSlideNode`, `CurrentSlideChildNode`,
  `CURRENT_DECK_SCHEMA_VERSION`, `CurrentDeckParseResult` — re-exported
  from `src/lib/deck/current-deck-schema.ts` (canonical v7 contract).
- **Unqualified legacy parse boundary**: `safeParseDeck` (a locally
  defined function wrapping deck-kernel `validateDeck`) and
  `DeckParseResult` (a locally defined type alias whose success branch
  holds the deck-kernel `Deck`). No unqualified `Deck` type is exported;
  the deck-kernel `Deck` is used only inside the `DeckParseResult` type
  definition and is not a public export of this module.
- **Deck-kernel validation utilities** (removal targets): `validateElement`,
  `validateImageCrop`, `validateImageFitMode`, `validateImageMaskShape`,
  `validateSourceRef` — re-exported from `deck-kernel/deck-validation/`
  sub-modules. These are not part of the legacy v6 parse boundary but are
  deck-kernel dependencies that will be retired with it.

The unqualified `safeParseDeck` in `deck-schema.ts` binds to the **legacy
v6** boundary. A consumer that imports `safeParseDeck` from `deck-schema.ts`
receives the legacy validator, not the canonical presentation validator.
The canonical v7 surface is accessible via the `Current*`-qualified exports,
via `persistence/current-deck-schema.ts`, or via a direct import from
`src/lib/presentation/validation.ts`.

### Data-contract registry

`src/lib/data-contracts/persisted-json.ts` registers the canonical
`safeParseDeck` from `src/lib/presentation/validation.ts` as the validator
for both `Document.deckJson` and `DocumentVersion.deckJson` contract areas.
Each registry entry routes through `validateDeckContract`, which calls
`safeParseDeck` from `src/lib/presentation/validation.ts`.

`src/lib/schema-audit/audit.ts` imports `safeParseDeck` directly from
`src/lib/presentation/validation.ts` — bypassing the `deck-schema.ts`
facade — to implement `validateNodeSourceMetadata`. That function validates
`source` metadata embedded in individual slide nodes, not the deck payload
itself. `NodeSourceMetadata` is listed in `SCHEMA_AREAS` but has no
registry entry in `persisted-json.ts`; the direct import is therefore
intentional and not a facade violation. For all contract-bound areas —
`Document.deckJson`, `DocumentVersion.deckJson`, visuals, comment anchors
— the audit dispatches through `getPersistedJsonContract`, ensuring audit
results reflect the canonical validators registered in `persisted-json.ts`.
Both the direct and registry-resolved bindings resolve to the same canonical
`safeParseDeck`.

### Active violations (migration risks)

The following production behaviors diverge from the canonical contract.
They are removal targets; their elimination requires the migration gates in
the Staged Migration section (B6–B7).

**v6 restore path and raw-invalid passthrough
(`persistence/versioning.ts` — `sanitizeRestoredDeck`):**
`sanitizeRestoredDeck` imports `safeParseDeck as safeParseLegacyDeck` from
`src/lib/document/deck-schema` (wrapping deck-kernel `validateDeck`) for its
legacy branch. When `looksLikeDeck` returns false — i.e., the snapshot
payload does not carry `schemaVersion === DECK_SCHEMA_VERSION` — the function
falls through to `safeParseLegacyDeck` and writes the legacy v6 result to
`Document.deckJson`. The canonical branch (active when `looksLikeDeck` is
true) resolves `safeParseDeck` via `persistence/current-deck-schema` (the
canonical presentation validator). Both branches have a raw-invalid
passthrough: when parsing fails, the raw input is returned unchanged and
written to `Document.deckJson`. Tests in `persistence-service.test.ts`
assert both the legacy-v6 restore and the raw-invalid passthrough as expected
behavior. These write paths violate invariants 1 and 2 and the no-bridge
constraint.

**Legacy validator in `persistence/visual.ts`
(`reconcileDeckAfterMirror`):** `reconcileDeckAfterMirror` imports
`safeParseDeck` from `src/lib/document/deck-schema.ts` (the legacy v6
validator) rather than the canonical `safeParseDeck` from
`src/lib/presentation/validation.ts`. Deck reconciliation after a visual
mirror therefore silently accepts v6 payloads.

## Target State

1. `src/lib/presentation/schema.ts` remains the single source of truth for
   the persisted `Deck` type.
2. `safeParseDeck` from `src/lib/presentation/validation.ts` is the single
   validation entry for persisted and cross-subsystem deck JSON.
   All call sites that currently reach the legacy `validateDeck` in
   `deck-validation/core.ts` for persistence purposes must be migrated to
   `safeParseDeck`.
3. The deck-kernel `Deck` type and its `validateDeck` function are retired.
   No translation layer, bridge, alias facade, or legacy/v6 compatibility
   path is introduced in the process.
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

`→` means "imports from." Presentation modules are the foundation;
document facades depend on them.

### (a) Current import paths

The `deck-schema.ts` facade is **not** universal. `persistence/visual.ts`
imports the **legacy** `safeParseDeck` from it; `schema-audit/audit.ts`
bypasses it entirely with a direct import to `presentation/validation.ts`.

```
persistence/versioning.ts ─(safeParseLegacyDeck, legacy branch)──→ document/deck-schema.ts
                          ─(safeParseDeck, canonical branch)──→ persistence/current-deck-schema.ts
                                                                   → document/deck-schema.ts (Current*)
                                                                   → deck/current-deck-schema.ts
                                                                   → presentation/validation.ts

persistence/visual.ts ─(safeParseDeck)──→ document/deck-schema.ts  [VIOLATION: legacy v6 validator]
                                              → deck-kernel/deck-validation/core.ts (validateDeck)

schema-audit/audit.ts ─(safeParseDeck, NodeSourceMetadata only)──→ presentation/validation.ts  [direct bypass]
                      ─(getPersistedJsonContract)──→ data-contracts/persisted-json.ts
                                                        → presentation/validation.ts
```

`document/deck-schema.ts` also re-exports `validateElement` and
media/source-ref validators from `deck-kernel/deck-validation/`; all are
removal targets.

### (b) Target dependency direction

```
All callers (persistence/versioning.ts, persistence/visual.ts, AI, downstream)
        ↓ imports
src/lib/document/deck-schema.ts       ← document facade (v7-only after B4)
        ↓ imports
src/lib/deck/current-deck-schema.ts   ← thin re-export (collapse candidate, B5)
        ↓ imports
src/lib/presentation/schema.ts        ← canonical Deck type (source of truth)
src/lib/presentation/validation.ts    ← safeParseDeck (canonical validator)

src/lib/data-contracts/persisted-json.ts  ← registry; imports safeParseDeck from validation.ts
src/lib/schema-audit/audit.ts             ← uses registry for all contract areas;
                                             retains direct import of safeParseDeck
                                             from validation.ts for NodeSourceMetadata only
```

`deck-kernel/` is fully retired; no module in the target graph imports it.

## Invariants

These invariants describe the target architecture. As noted in the Active
violations subsection, invariants 1, 2, and 4 are not yet satisfied by all
production paths and are migration targets.

1. The persisted `Deck` contract is `schemaVersion: 7` as defined in
   `src/lib/presentation/schema.ts`. No other version is written to
   `Document.deckJson`.
2. `safeParseDeck` (`src/lib/presentation/validation.ts`) is the only
   permitted validator for `Document.deckJson` writes, reads, and
   cross-subsystem handoffs.
3. No bridge, translation layer, alias facade, or legacy/v6 compatibility
   path may be added to make older deck shapes pass validation. Repair
   happens at import/AI-plan/paste boundaries before reaching
   `safeParseDeck`.
4. The deck-kernel `Deck` type and `validateDeck` must not be used for
   persisted-payload validation. They are internal legacy objects pending
   retirement.
5. The data-contract registry (`persisted-json.ts`) and schema-audit
   (`audit.ts`) must reference `safeParseDeck` from
   `src/lib/presentation/validation.ts` exclusively.

## Staged Migration

The following steps are **not yet implemented**. They are targets for
future refactor batches.

| Step | Target                                                                                                                                                                                                                                                                                                                        | Acceptance check                                                                                                                                                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B3   | Retire the deck-kernel `Deck` type; convert all consumers to import `Deck` directly from `src/lib/presentation/schema.ts`.                                                                                                                                                                                                    | `deck-core.ts` no longer defines a separate v6 type; no alias or compatibility shim introduced; tests updated to use presentation `Deck`.                                                                                                                                     |
| B4   | Retire `validateDeck` in `deck-validation/core.ts`; remove all callers including the `safeParseDeck` wrapper in `deck-schema.ts`; remove all deck-kernel validation utility re-exports from `deck-schema.ts` (`validateElement`, `validateImageCrop`, `validateImageFitMode`, `validateImageMaskShape`, `validateSourceRef`). | `validateDeck` deleted; `deck-schema.ts` exports only the canonical `Current*` surface; no legacy `safeParseDeck`, `DeckParseResult`, or deck-kernel validation utilities remain; no delegating wrapper introduced; schema-audit green.                                       |
| B5   | Collapse `src/lib/deck/current-deck-schema.ts` if its only consumer is `deck-schema.ts`.                                                                                                                                                                                                                                      | No other module imports `current-deck-schema`; facade file deleted or kept thin.                                                                                                                                                                                              |
| B6   | Inventory all `Document.deckJson` and `DocumentVersion.deckJson` rows; characterize non-v7 payloads (v6 shape, null, or schema-invalid); migrate or archive them so neither live documents nor version snapshots hold a non-v7 deck shape.                                                                                    | Schema-audit CLI reports zero `Document.deckJson` violations and zero `DocumentVersion.deckJson` violations; a query recording the `schemaVersion` distribution per table is captured as evidence; rollback plan for surviving non-v7 rows documented; ops smoke test passes. |
| B7   | Remove the v6 restore branch and raw-invalid passthrough from `sanitizeRestoredDeck` (`persistence/versioning.ts`); fix `reconcileDeckAfterMirror` (`persistence/visual.ts`) to import the canonical `safeParseDeck` from `src/lib/presentation/validation.ts`.                                                               | `sanitizeRestoredDeck` rejects non-v7 payloads without writing to `Document.deckJson`; raw-invalid input is not persisted; `reconcileDeckAfterMirror` imports from `src/lib/presentation/validation.ts`; affected tests updated.                                              |

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

**Before removing active violations (B6–B7):** The schema-audit CLI must
report zero non-v7 `Document.deckJson` rows and zero non-v7
`DocumentVersion.deckJson` rows; query evidence recording the `schemaVersion`
distribution per table must be captured; a rollback plan for any surviving
non-v7 rows must be documented; ops smoke test must pass before the v6
restore path and raw-invalid passthrough are removed.

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
