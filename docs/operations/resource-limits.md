---
type: "contract"
status: "current"
last_updated: "2026-07-10"
description: "This document describes the central resource-limit inventory used by import, AI, deck persistence, assets, comments, workspaces, and performance budgets. Runtime environment variables are documented in runtime-config.md."
---

# Resource Limits And Budgets

This document describes the central resource-limit inventory used by import,
AI, deck persistence, assets, comments, workspaces, and performance budgets.
Runtime environment variables are documented in [runtime-config.md](runtime-config.md).

## Source Anchors

| Area                    | Source                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| Public limit facade     | [`src/lib/limits/index.ts`](../../src/lib/limits/index.ts)         |
| Shared budget helpers   | [`src/lib/limits/budgets.ts`](../../src/lib/limits/budgets.ts)     |
| Inventory               | [`src/lib/limits/inventory.ts`](../../src/lib/limits/inventory.ts) |
| AI limits               | [`src/lib/limits/ai.ts`](../../src/lib/limits/ai.ts)               |
| Asset/import limits     | [`src/lib/limits/assets.ts`](../../src/lib/limits/assets.ts)       |
| Deck and timing budgets | [`src/lib/limits/deck.ts`](../../src/lib/limits/deck.ts)           |
| Document limits         | [`src/lib/limits/document.ts`](../../src/lib/limits/document.ts)   |

## Limit Model

Each `LimitDefinition` carries:

- stable `id`;
- human description;
- numeric value and unit;
- enforcement type: `enforced` or `warning`;
- diagnostic scope/metric;
- optional warning threshold;
- source file that applies the limit.

`LIMIT_INVENTORY` is the source inventory for documentation, checks, and review.
New hard limits or warning budgets should be added there so they stay
discoverable.

## Enforcement Categories

| Category       | Examples                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------- |
| AI             | visual input chars, deck input chars, generated deck slide count, output token budget.    |
| Import/assets  | import upload bytes, text import bytes, brand font/logo upload bytes, slide asset bytes.  |
| Deck           | serialized deck JSON bytes, slide count, elements per slide, visual count, inline images. |
| Document       | document title/content, serialized Lexical state, workspace names, tag names, comments.   |
| Timing budgets | autosave, export preflight, editor open/hydration warning budgets.                        |

Hard limits block a write or request. Warning budgets produce diagnostics or
preflight warnings while allowing the operation to proceed.

## Budget Helpers

`checkBudget(metric, actual, warnAt, hardAt)` returns a pure result with
`warned` and `exceeded` flags. `checkLimit(limit, actual)` applies a
`LimitDefinition` and returns diagnostic metadata. `budgetExceededDiagnostic`
turns a limit check into a stable `BUDGET_EXCEEDED` diagnostic payload.

Callers keep user-facing error copy in the owning limit module, for example
`formatDeckTooLargeError`, `formatImportFileTooLargeError`,
`formatAssetFileTooLargeError`, and `formatLexicalStateTooLargeError`.

## Relationship To Subsystems

- [../import/README.md](../import/README.md) uses import MIME and byte ceilings
  before server-side parsing.
- [../ai/generation.md](../ai/generation.md) uses AI input and generated-deck
  limits before and after model calls.
- [../data-model/document-persistence.md](../data-model/document-persistence.md)
  uses deck JSON and document content limits in persistence paths.
- [../presentation/rendering-and-export.md](../presentation/rendering-and-export.md)
  surfaces deck and timing warnings through export preflight.
- [../presentation/assets.md](../presentation/assets.md) uses slide asset byte
  and dimension limits.

## Invariants

1. Limits live in `src/lib/limits/*`, not as scattered magic numbers in call
   sites.
2. New limit definitions belong in `LIMIT_INVENTORY` when they are product,
   storage, abuse-control, or performance contracts.
3. Hard limits reject operations before expensive or unsafe work where possible.
4. Warning budgets are advisory and should surface stable diagnostics.
5. User-facing copy stays with the owning limit module.

## Primary Tests

- [`src/lib/limits/limits.test.ts`](../../src/lib/limits/limits.test.ts)
- [`src/lib/import/validate.test.ts`](../../src/lib/import/validate.test.ts)
- [`src/lib/presentation/export-preflight.test.ts`](../../src/lib/presentation/export-preflight.test.ts)
- [`src/lib/document/deck-cas-writer.test.ts`](../../src/lib/document/deck-cas-writer.test.ts)
