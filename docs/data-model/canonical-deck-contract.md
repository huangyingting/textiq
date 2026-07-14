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
They are removal targets; their elimination requires the data gate (B4) and
the v6-path removal stage (B5) in the Staged Migration section.

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

**Legacy validator in `document/duplicate.ts`
(`remapDeckSourceRefs`):** `remapDeckSourceRefs` imports `safeParseDeck`
and `safeParseCurrentDeck` from `src/lib/document/deck-schema.ts` and
implements a v7-then-v6 fallback: it first attempts canonical v7 parsing
via `safeParseCurrentDeck` and, if that fails, falls through to the legacy
v6 `safeParseDeck`. The v6 fallback silently accepts v6 payloads during
document duplication. This violates invariants 3 and 4.

**Legacy validator in `ai/deck-metrics.ts`:**
`ai/deck-metrics.ts` imports `safeParseDeck` from
`src/lib/document/deck-schema.ts`, receiving the legacy v6 validator, and
uses it to assess schema validity during AI metric computation. Deck
validity in AI metrics is therefore assessed against the legacy v6 schema,
not the canonical v7 schema. This violates invariant 4.

## Target State

1. `src/lib/presentation/schema.ts` remains the single source of truth for
   the persisted `Deck` type.
2. `safeParseDeck` from `src/lib/presentation/validation.ts` is the single
   validation entry for persisted and cross-subsystem deck JSON.
   All call sites that currently reach the legacy `validateDeck` in
   `deck-validation/core.ts` for persistence purposes must be migrated to
   `safeParseDeck`.
3. The deck-kernel `validateDeck` function is retired once its only production
   consumer (the legacy `safeParseDeck` wrapper in `deck-schema.ts`) is removed.
   The deck-kernel `Deck` type is retired last: beyond the persisted-validation
   dependents, it is still consumed via `deck-model` by non-persistence modules
   (`source-ref-model.ts`, `action-ports.ts`, and test builders), whose migration
   to the presentation `Deck` gates its deletion (see B8). No translation layer,
   bridge, alias facade, or legacy/v6 compatibility path is introduced in the
   process.
4. The legacy unqualified exports from `src/lib/document/deck-schema.ts`
   (`safeParseDeck` and `DeckParseResult` as the v6 variants) and the
   deck-kernel validation utility re-exports (`validateElement`,
   `validateImageCrop`, `validateImageFitMode`, `validateImageMaskShape`,
   `validateSourceRef`) are removed once their callers are migrated. After
   all callers of the `Current*`-qualified canonical re-exports also migrate
   to import directly from `src/lib/presentation/schema.ts` and
   `src/lib/presentation/validation.ts`, `deck-schema.ts` is deleted; it is
   not retained as a canonical hub.
5. `src/lib/deck/current-deck-schema.ts` and
   `src/lib/document/persistence/current-deck-schema.ts` are deleted once
   their consumers have migrated to direct canonical imports. Neither facade
   layer is retained; `Current*`-aliased re-exports are not a stable final
   surface.
6. AI and downstream consumers depend on the thin presentation contract
   surface (`schema.ts`, `validation.ts`) rather than on
   implementation registries or deck-kernel internals.

## Dependency Direction

`→` means "imports from." Presentation modules (`schema.ts`, `validation.ts`)
are the foundation; the facades depend on them. The two graphs below use the
same module names as the Ownership Matrix and Staged Migration table so all
three agree exactly.

### (a) Current import paths

The facades are **not** universal. Four consumers hold the **legacy**
`safeParseDeck` from `document/deck-schema.ts`; three canonical consumers route
through `persistence/current-deck-schema.ts`; the remaining callers, the audit,
and the registry import `presentation/{schema,validation}` directly.

```
-- facade chain (canonical surface), aliased at each hop:
persistence/current-deck-schema.ts ─(Current* → canonical names)──→ document/deck-schema.ts
document/deck-schema.ts ─(Current* aliases)──→ deck/current-deck-schema.ts ──→ presentation/{schema,validation}
document/deck-schema.ts ─(validateDeck, Deck type, validation utilities)──→ deck-kernel/*

-- legacy v6 `safeParseDeck` consumers (VIOLATIONS):
ai/deck-metrics.ts        ─(safeParseDeck)─────────────→ document/deck-schema.ts   [legacy v6]
persistence/visual.ts     ─(safeParseDeck)─────────────→ document/deck-schema.ts   [legacy v6]
persistence/versioning.ts ─(safeParseLegacyDeck)───────→ document/deck-schema.ts   [legacy v6 branch]
document/duplicate.ts     ─(safeParseDeck, v6 fallback)→ document/deck-schema.ts   [legacy v6]

-- canonical consumers routed through the persistence facade:
document/duplicate.ts     ─(safeParseCurrentDeck, CurrentDeck)──→ document/deck-schema.ts (Current*)
persistence/versioning.ts ─(safeParseDeck, canonical branch)────→ persistence/current-deck-schema.ts
persistence/deck.ts       ─(safeParseDeck, Deck, SlideNode, SlideChildNode)→ persistence/current-deck-schema.ts
document/deck-cas-writer.ts ─(safeParseDeck)───────────────────→ persistence/current-deck-schema.ts

-- direct canonical consumers (bypass every facade):
app/api/generate-deck/route-logic.ts \
ai/deck-generation-request.ts          |─(safeParseDeck)──→ presentation/validation.ts
comments/service.ts                   /
schema-audit/audit.ts    ─(safeParseDeck, NodeSourceMetadata only)──→ presentation/validation.ts
schema-audit/audit.ts    ─(getPersistedJsonContract)──→ data-contracts/persisted-json.ts ──→ presentation/validation.ts
data-contracts/persisted-json.ts ─(Document.deckJson + DocumentVersion.deckJson)──→ presentation/validation.ts
```

### (b) Target dependency direction

Every deck-JSON validator resolves `presentation/{schema,validation}` directly.
No caller routes through `document/deck-schema.ts`,
`deck/current-deck-schema.ts`, or `persistence/current-deck-schema.ts` — all
three are deleted — and no path reaches the deck-kernel legacy validator.

```
-- persistence + AI consumers (migrated off the facades in B3/B5):
persistence/versioning.ts   \
persistence/visual.ts        |
persistence/deck.ts          |─→ presentation/schema.ts
document/deck-cas-writer.ts  |─→ presentation/validation.ts
document/duplicate.ts        |
ai/deck-metrics.ts          /

-- direct canonical consumers (already satisfied; unchanged):
app/api/generate-deck/route-logic.ts \
ai/deck-generation-request.ts          |
comments/service.ts                    |─→ presentation/schema.ts
schema-audit/audit.ts                  |─→ presentation/validation.ts
data-contracts/persisted-json.ts      /

-- deleted facades (no importers remain):
document/deck-schema.ts              (deleted in B7)
deck/current-deck-schema.ts          (deleted in B7)
persistence/current-deck-schema.ts   (deleted in B3)
```

`deck-kernel/deck-validation/core.ts#validateDeck` is retired in B6. The
deck-kernel `Deck` type is retired in B8, after its remaining `deck-model`
consumers (`source-ref-model.ts`, `action-ports.ts`, test builders) migrate to
the presentation `Deck`.

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

## Ownership Matrix

Each symbol, caller family, and facade below has exactly **one** owning stage
and one acceptance probe. A type, function, or facade is never retired before
every live consumer in the "Consumers at start" column has migrated. The
`versioning.ts` split into two rows is required by the data gate: its
facade-indirection removal (canonical branch) carries no data dependency, while
its legacy-branch removal must wait for B4.

| Symbol / surface / caller family                                                    | Consumers at start                                                                                   | Owning stage | Acceptance probe                                                                                        |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| Facade C `persistence/current-deck-schema.ts`                                       | `deck-cas-writer.ts`, `persistence/deck.ts`, `versioning.ts` canonical branch, its test              | B3           | `rg "persistence/current-deck-schema"` → no importers; file deleted                                     |
| `versioning.ts` canonical branch (facade-indirection removal)                       | routes through Facade C                                                                              | B3           | `versioning.ts` canonical branch imports `presentation/{schema,validation}`                             |
| deck-kernel validation-utility re-exports in `deck-schema.ts`                       | `deck-schema.test.ts` only                                                                           | B3           | those five utilities have no importer from `deck-schema.ts`                                             |
| `Document.deckJson` + `DocumentVersion.deckJson` data (both tables)                 | live rows                                                                                            | B4           | schema-audit CLI: zero violations in **both** areas; per-table `schemaVersion` distribution captured    |
| `versioning.ts` legacy v6 branch + raw-invalid passthrough                          | `sanitizeRestoredDeck`                                                                               | B5           | `safeParseLegacyDeck` import gone; non-v7 restore input rejected, not written to `Document.deckJson`    |
| `visual.ts` `reconcileDeckAfterMirror` legacy validator                             | legacy `safeParseDeck`                                                                               | B5           | imports canonical `safeParseDeck`; non-v7 `Document.deckJson` rejected without rewrite                  |
| `duplicate.ts` (canonical path **and** v6 fallback — assigned once)                 | `safeParseCurrentDeck`, `CurrentDeck`, `CurrentSlideChildNode`, legacy `safeParseDeck`               | B5           | `remapDeckSourceRefs` imports `presentation/{schema,validation}`; no legacy `safeParseDeck`/v6 fallback |
| `deck-metrics.ts` legacy validator + legacy `Deck`/`Slide` typing                   | legacy `safeParseDeck`, `deck-model` `Deck`/`Slide`                                                  | B5           | imports canonical `safeParseDeck` + presentation `Deck`; no `deck-model` legacy import                  |
| Legacy `safeParseDeck` wrapper + `DeckParseResult` in `deck-schema.ts`              | (all migrated by B5) + `deck-schema.test.ts`, `fixture-drift.test.ts`                                | B6           | `deck-schema.ts` retains only the `Current*` re-exports                                                 |
| deck-kernel `validateDeck` (`deck-validation/core.ts`)                              | legacy wrapper (removed same stage) + deck-validation tests                                          | B6           | `rg "validateDeck"` → zero non-test references outside deleted code                                     |
| `Current*` type-only consumers (`duplicate.test.ts`, `persistence-service.test.ts`) | Facade A `Current*` types                                                                            | B7           | those tests import presentation `Deck`/`SlideChildNode`                                                 |
| Facade A `document/deck-schema.ts`                                                  | `Current*` (migrated by B5/B7), legacy surface (removed B6), utilities (removed B3), Facade C (gone) | B7           | `rg "document/deck-schema"` → no importers; file deleted                                                |
| Facade B `deck/current-deck-schema.ts`                                              | Facade A only                                                                                        | B7           | `rg "deck/current-deck-schema"` → no importers; file deleted                                            |
| deck-kernel `Deck` type (`deck-core.ts` + `deck-model` re-export)                   | after B6: `source-ref-model.ts`, `action-ports.ts`, test builders (via `deck-model`)                 | B8           | `rg` for `Deck` imports from `deck-core`/`deck-model` → zero; presentation `Deck` used everywhere       |

## Staged Migration

The following steps are **not yet implemented**. They are targets for future
refactor batches, ordered so that no symbol, function, or facade is retired
before its consumers migrate. Stages B3 and B5 group several caller families,
but each family (see the Ownership Matrix) is owned by exactly one stage.

| Step | Target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Acceptance check                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B3   | Remove facade indirection that carries no data dependency (canonical validator unchanged). Migrate `deck-cas-writer.ts`, `persistence/deck.ts`, and the **canonical branch** of `versioning.ts` from `persistence/current-deck-schema.ts` to direct `presentation/{schema,validation}` imports; update `deck-cas-writer.test.ts`; delete `persistence/current-deck-schema.ts`. Remove the deck-kernel validation-utility re-exports (`validateElement`, `validateImageCrop`, `validateImageFitMode`, `validateImageMaskShape`, `validateSourceRef`) from `deck-schema.ts` and point `deck-schema.test.ts` at `deck-kernel/deck-validation/*`.                            | `rg "persistence/current-deck-schema"` reports no importers (file deleted); `deck-cas-writer.ts`, `persistence/deck.ts`, and versioning's canonical branch resolve `presentation/{schema,validation}` directly; no module imports the five validation utilities from `deck-schema.ts`; canonical validator behavior unchanged; schema-audit and docs green. `versioning.ts` retains its legacy branch until B5. |
| B4   | **Data gate (both persisted tables).** Inventory `Document.deckJson` and `DocumentVersion.deckJson`; characterize non-v7 payloads (v6 shape, null, or schema-invalid); migrate or archive them so neither live documents nor version snapshots hold a non-v7 deck.                                                                                                                                                                                                                                                                                                                                                                                                       | Schema-audit CLI reports zero `Document.deckJson` violations **and** zero `DocumentVersion.deckJson` violations; a query recording the `schemaVersion` distribution per table is captured as evidence; a rollback plan covering surviving v6 **and** invalid rows is documented; ops smoke test passes.                                                                                                         |
| B5   | **Remove the v6-accepting paths (gated on B4).** `versioning.ts`: remove the legacy v6 branch and raw-invalid passthrough from `sanitizeRestoredDeck`; drop the `safeParseDeck as safeParseLegacyDeck` import. `visual.ts`: migrate `reconcileDeckAfterMirror` to canonical `safeParseDeck` from `presentation/validation`. `duplicate.ts` (**assigned once**): migrate the canonical path (`safeParseCurrentDeck`/`CurrentDeck` → presentation `safeParseDeck`/`Deck`) **and** remove the v6 fallback. `deck-metrics.ts`: migrate to canonical `safeParseDeck` and presentation `Deck` typing. Update `fixture-drift.test.ts` and affected persistence/duplicate tests. | `rg "document/deck-schema"` shows zero **production** imports of the legacy `safeParseDeck`; `sanitizeRestoredDeck`, `reconcileDeckAfterMirror`, `remapDeckSourceRefs`, and `deck-metrics.ts` resolve canonical `safeParseDeck` from `presentation/validation`; all three write paths reject non-v7 payloads; the B4 gates for both areas remain green.                                                         |
| B6   | **Retire the legacy validation surface (gated on B5).** Remove the legacy `safeParseDeck` wrapper and `DeckParseResult` from `deck-schema.ts` (now consumer-free). Delete `validateDeck` in `deck-kernel/deck-validation/core.ts` — its only production consumer was that wrapper. Update `deck-schema.test.ts` and `deck-kernel/deck-validation/*` tests.                                                                                                                                                                                                                                                                                                               | `deck-schema.ts` retains only the `Current*` re-exports (no legacy `safeParseDeck`/`DeckParseResult`); `rg "validateDeck"` shows zero non-test references outside deleted code; schema-audit green.                                                                                                                                                                                                             |
| B7   | **Delete Facades A and B (gated on B5 + B6).** Migrate the remaining `Current*` type-only consumers (`duplicate.test.ts`, `persistence-service.test.ts`) to presentation `Deck`/`SlideChildNode`. Delete `src/lib/document/deck-schema.ts` (Facade A, now consumer-free) and `src/lib/deck/current-deck-schema.ts` (Facade B, imported only by Facade A).                                                                                                                                                                                                                                                                                                                | `rg "document/deck-schema"` and `rg "deck/current-deck-schema"` report no importers; both files deleted; all deck-JSON validation resolves `presentation/{schema,validation}` directly; no `Current*`-aliased re-export surface remains.                                                                                                                                                                        |
| B8   | **Retire the deck-kernel `Deck` type (gated on B6).** Migrate the remaining `deck-model`-mediated consumers of the legacy `Deck` type — `source-ref-model.ts`, `action-ports.ts`, and test builders — to the presentation `Deck`. These non-persistence consumers sit outside this contract's persisted-validation boundary; their migration is the gating precondition (tracked as broader deck-kernel retirement). Delete the deck-kernel `Deck` type from `deck-core.ts` and its `deck-model` re-export.                                                                                                                                                              | `rg` for `Deck` imports from `deck-core.ts`/`deck-model.ts` shows zero importers of the deck-kernel `Deck` type; persisted deck typing resolves the presentation `Deck` everywhere; no alias or compatibility shim introduced.                                                                                                                                                                                  |

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

**Before removing active violations (data gate B4; removal in B5):** The
schema-audit CLI must report zero non-v7 `Document.deckJson` rows and zero
non-v7 `DocumentVersion.deckJson` rows; query evidence recording the
`schemaVersion` distribution per table must be captured; a rollback plan for
any surviving non-v7 (v6 **and** invalid) rows must be documented; the ops
smoke test must pass before the v6 restore path and raw-invalid passthrough
are removed.

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
