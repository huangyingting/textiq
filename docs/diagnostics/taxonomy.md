---
type: "contract"
status: "current"
last_updated: "2026-07-04"
description: "Stable diagnostic error codes, domain telemetry categories, schema parse-failure telemetry, and public API abuse observability contracts."
---

# Diagnostic Taxonomy

Diagnostics are split into stable error codes and narrower telemetry categories.
Use the smallest layer that gives callers and operators a stable signal without
logging user content.

## Source Files

| Area                   | Source                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Structured error codes | [`src/lib/diagnostics/error-codes.ts`](../../src/lib/diagnostics/error-codes.ts)           |
| Domain telemetry       | [`src/lib/diagnostics/domain-events.ts`](../../src/lib/diagnostics/domain-events.ts)       |
| Schema telemetry       | [`src/lib/diagnostics/schema-telemetry.ts`](../../src/lib/diagnostics/schema-telemetry.ts) |
| API abuse diagnostics  | [`src/lib/diagnostics/api-abuse.ts`](../../src/lib/diagnostics/api-abuse.ts)               |
| Base logger            | [`src/lib/log.ts`](../../src/lib/log.ts)                                                   |
| Redaction core         | [`src/lib/log-redaction-core.cjs`](../../src/lib/log-redaction-core.cjs)                   |

## Stable Error Codes

`ERROR_CODES` are stable identifiers used by logs, UI handling, automation, or
operator workflows. They use `SCREAMING_SNAKE_CASE` and must not be renamed or
removed without a deliberate migration.

| Domain        | Codes                                            | Default severity  |
| ------------- | ------------------------------------------------ | ----------------- |
| Save          | `SAVE_CONFLICT`, `SAVE_OVERSIZED`, `SAVE_FAILED` | `error`           |
| Deck/schema   | `INVALID_DECK`                                   | `error`           |
| Visual        | `INVALID_VISUAL`, `PROJECTION_REPAIR_FAILED`     | `error`           |
| Authorization | `PERMISSION_DENIED`                              | `error`           |
| Assets        | `MISSING_ASSET`                                  | `error`           |
| Export        | `EXPORT_FALLBACK`, `EXPORT_PREFLIGHT_FATAL`      | `warning`/`fatal` |
| Source links  | `SOURCE_STALE`, `SOURCE_MISSING`                 | `warning`/`error` |
| Commands      | `UNSUPPORTED_COMMAND`                            | `error`           |
| Budgets       | `BUDGET_EXCEEDED`                                | `warning`         |
| AI            | `AI_GENERATION_REPAIR_FAILED`                    | `error`           |

`buildDiagnostic` derives severity from `CODE_SEVERITY`. Diagnostic metadata is
safe metadata only: ids, counts, codes, tokens, and booleans. Raw document
content, prompt text, cookies, tokens, and nested payloads are forbidden.

## Domain Telemetry

Domain telemetry covers stable but narrower operational events that do not need
to become global `ERROR_CODES`. The builder functions copy only allowlisted safe
scalars and redact sensitive keys before logging.

Current telemetry families include:

- usage ledger events under `billing.ledger.*`;
- metered usage events under `billing.metered.*`;
- slide and brand asset orphan cleanup under `asset.slide.*` and
  `asset.brand.*`;
- command validation events with command, document, visual, slide, element, and
  schema identifiers.

Callers should add a domain telemetry family when the event is operationally
useful but too domain-specific to become a cross-system error code.

## Persisted-Schema Telemetry

Persisted schema failures use `schema.persisted` and one of these categories:

| Category                      | Meaning                                        |
| ----------------------------- | ---------------------------------------------- |
| `deck-parse-failed`           | Persisted deck JSON failed Deck validation.    |
| `visual-parse-failed`         | Persisted visual row failed Visual parsing.    |
| `sourceref-invalid`           | Persisted source reference failed validation.  |
| `content-visual-parse-failed` | Visual embedded in `contentJson` failed parse. |

The diagnostic can include safe identifiers such as `documentId`, `rowId`,
`area`, `anchorBlockId`, and counters. Content keys such as `text`, `input`,
`deckJson`, `contentJson`, `data`, and validator reason/message fields are
dropped before logging.

These categories intentionally remain telemetry categories rather than
`ERROR_CODES`; they support repair workflows without expanding the user-facing
code taxonomy.

## API Abuse Diagnostics

Public expensive routes log denials through the `api.abuse` scope with message
`route-denial`. The event carries only route tag, fixed category, status, and
optional opaque identifiers such as a hashed subject, document id, user id, or
`Retry-After` seconds.

Current abuse categories are:

- `rate-limit-hit`;
- `anon-quota-denied`;
- `parser-timeout`;
- `parser-budget`;
- `ai-timeout`;
- `credit-denied`.

The event type deliberately has no field for prompt text, imported file content,
or raw bytes, so route instrumentation cannot leak content through this path.

## Invariants

1. `ERROR_CODES` are stable API and are not renamed casually.
2. Diagnostic metadata is safe scalar context only.
3. Domain telemetry builders copy allowlisted fields rather than accepting raw
   context bags.
4. Schema telemetry describes persisted-data failures and strips content keys.
5. Abuse diagnostics never log prompt text, imported content, cookies, or raw
   request bodies.

## Primary Tests

- [`src/lib/diagnostics/error-codes.test.ts`](../../src/lib/diagnostics/error-codes.test.ts)
- [`src/lib/diagnostics/domain-events.test.ts`](../../src/lib/diagnostics/domain-events.test.ts)
- [`src/lib/diagnostics/schema-telemetry.test.ts`](../../src/lib/diagnostics/schema-telemetry.test.ts)
- [`src/lib/diagnostics/api-abuse.test.ts`](../../src/lib/diagnostics/api-abuse.test.ts)
