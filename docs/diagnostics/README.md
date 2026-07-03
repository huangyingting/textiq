---
type: "reference"
status: "current"
last_updated: "2026-07-04"
description: "TextIQ uses layered diagnostics:"
---

# Diagnostics and Logging

| Document                   | Type     | Scope                                                                          |
| -------------------------- | -------- | ------------------------------------------------------------------------------ |
| [taxonomy.md](taxonomy.md) | Contract | Stable error codes, domain telemetry, schema telemetry, and abuse diagnostics. |

TextIQ uses layered diagnostics:

1. **Base structured logs** (`src/lib/log.ts`) for safe operational facts:
   ids, counts, statuses, timings, and non-content reasons.
2. **Diagnostic codes** (`src/lib/diagnostics/error-codes.ts`) when callers or
   operators need a stable code such as `SAVE_CONFLICT` or
   `UNSUPPORTED_COMMAND`. Existing `ERROR_CODES` values are stable and must not
   be renamed.
3. **Domain telemetry categories** for high-risk allowlisted events such as
   persisted-schema failures and public-route abuse denials. These categories are
   stable telemetry values, but they are not user-facing error codes.

## Scope names

New and touched runtime log scopes use:

```text
area.subsystem.operation
```

Examples:

- `billing.ledger.reserve`
- `asset.slide.purge`
- `collab.flush.result`
- `command.validation.unsupported`

Use lowercase dot-separated segments. Each segment should be a stable noun or
verb phrase with no raw ids or user content. When an owning code path changes,
keep its scope aligned with the current domain name.

## Choosing the layer

- Use **base logs** for routine lifecycle events and unexpected errors that do
  not have a stable product/operator code.
- Use **diagnostic codes** when behavior is part of a stable contract or the UI,
  automation, or alerting needs a code from `ERROR_CODES`.
- Use **domain telemetry categories** when the event is high-risk for content
  leakage and must be built from an allowlist, such as schema parse failures or
  API abuse denials.

## R18.2 schema-category decision

Schema failure categories stay separate from `ERROR_CODES`. They describe
allowlisted persisted-data telemetry (`deck-parse-failed`,
`visual-parse-failed`, etc.), not user-facing or cross-domain diagnostic codes.
Promoting them to first-class `ERROR_CODES` would expand the stable code
taxonomy without a current caller that needs code-level handling.

## Redaction and no-content policy

Shared key normalization and redaction live in
`src/lib/log-redaction-core.cjs`. App logs, schema telemetry, and plain `.mjs`
collaboration scripts use that helper. Domain telemetry builders copy only
allowlisted scalar fields; raw document text, prompt/input text, cookies, tokens,
payloads, and nested values must not be logged.
