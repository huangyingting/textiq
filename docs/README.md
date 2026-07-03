---
type: "reference"
status: "current"
last_updated: "2026-07-03"
description: "This folder documents the current runtime architecture, persisted contracts, product behavior, operational runbooks, and forward plans for TextIQ. Source code, tests, and schemas remain authoritative; docs explain the current system and name where future work belongs."
---

# TextIQ Documentation

This folder documents the current runtime architecture, persisted contracts,
product behavior, operational runbooks, and forward plans for TextIQ. Source
code, tests, and schemas remain authoritative; docs explain the current system
and name where future work belongs.

Database migration commands in README/package scripts are normal Prisma schema
workflow. They are not runtime compatibility readers for superseded JSON
payloads.

## Start Here

| Document                                                   | Type         | Purpose                                                  |
| ---------------------------------------------------------- | ------------ | -------------------------------------------------------- |
| [system/architecture.md](system/architecture.md)           | Architecture | System-wide runtime architecture and write paths.        |
| [system/documentation-map.md](system/documentation-map.md) | Reference    | Code subsystem to documentation ownership map.           |
| [data-model/deck.md](data-model/deck.md)                   | Contract     | Current Deck `Document.deckJson` persisted contract.     |
| [presentation/README.md](presentation/README.md)           | Architecture | Slide editor, rendering, present mode, and export index. |
| [operations/quality-gates.md](operations/quality-gates.md) | Reference    | Local/CI quality gates and governance scripts.           |

## Document Types

| Type           | Use for                                                                                 |
| -------------- | --------------------------------------------------------------------------------------- |
| `Architecture` | Current runtime boundaries, ownership, data flow, and cross-module invariants.          |
| `Contract`     | Persisted schemas, command envelopes, route matrices, APIs, and validation rules.       |
| `Design`       | Product behavior, UI surfaces, interaction rules, and authoring workflows.              |
| `Plan`         | Future work with current state, target state, phases, non-goals, and acceptance checks. |
| `Runbook`      | Operational steps, diagnosis, repair, release, deployment, and incident procedures.     |
| `Reference`    | Inventories, support matrices, coverage maps, and source-to-doc lookup tables.          |

Plans live inside the owning subsystem as `*-plan.md`. Current architecture and
contracts must not depend on plan documents for behavior.

## Subsystems

| Section                                   | Owns                                                     | Common doc types                     |
| ----------------------------------------- | -------------------------------------------------------- | ------------------------------------ |
| [system/](system/README.md)               | Cross-subsystem architecture, invariants, ADRs, naming.  | Architecture, Reference, ADR         |
| [data-model/](data-model/README.md)       | Persisted JSON contracts and database projections.       | Contract, Architecture               |
| [presentation/](presentation/README.md)   | Slide editor runtime, Deck rendering, present/export.    | Architecture, Design, Contract, Plan |
| [editor/](editor/README.md)               | Lexical document editor and editor-owned comment UX.     | Architecture, Design                 |
| [documents/](documents/README.md)         | Document creation, listing, tags, search, trash.         | Architecture                         |
| [visual/](visual/README.md)               | Visual schemas, registry, rendering, transform/export.   | Contract, Architecture               |
| [ai/](ai/README.md)                       | AI-assisted document/deck generation and quota flow.     | Architecture, Contract               |
| [commands/](commands/README.md)           | Command envelopes, mutation routing, mutation inventory. | Contract, Reference                  |
| [public-render/](public-render/README.md) | Public share/embed/present rendering and metadata.       | Architecture, Security               |
| [security/](security/README.md)           | Permissions, sharing, route policy, public surfaces.     | Contract, Reference                  |
| [auth/](auth/README.md)                   | Authentication, account lifecycle, settings, deletion.   | Architecture, Runbook                |
| [collaboration/](collaboration/README.md) | Yjs rooms, readiness, presence, collaboration access.    | Architecture, Runbook                |
| [import/](import/README.md)               | Document import parsing, validation, normalization.      | Architecture, Contract               |
| [localization/](localization/README.md)   | Typed catalogs, locale resolution, activation gate.      | Architecture                         |
| [product/](product/README.md)             | Billing, entitlements, Brand Studio, product policy.     | Architecture, Contract               |
| [diagnostics/](diagnostics/README.md)     | Logging scopes, diagnostic codes, telemetry layers.      | Reference, Contract                  |
| [operations/](operations/README.md)       | Runtime configuration, release, repair, privacy, QA.     | Runbook, Reference                   |

## Documentation Rules

- Document current behavior and current design in Architecture, Contract, and
  Design docs.
- Do not document superseded payload shapes as supported runtime behavior.
- Put future or incomplete work in a `Plan` document owned by the subsystem that
  will implement it.
- When a schema is tightened, update the relevant Contract doc and tests in the
  same change.
- Keep subsystem directories flat: Markdown files live directly under
  `docs/<subsystem>/`.
- Prefer links to source files for implementation detail, but keep docs readable
  without opening code.
- Material source behavior changes must amend the relevant ADR or supersede it
  with a new ADR; see the [ADR index](system/architecture-decisions.md).

## Verification

Before treating a docs update as done, run the relevant code checks when the
docs describe executable behavior:

```bash
npm run docs:check
npm run typecheck
npm run test:subsystem -- <subsystem>
```

For broad documentation reshapes, also run:

```bash
npm run import-graph:check
rg "<deleted-doc-or-symbol>" docs src
```
