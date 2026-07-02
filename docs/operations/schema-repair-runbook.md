---
type: "runbook"
status: "current"
last_updated: "2026-07-01"
description: "Epic: #493 — Persisted schema and cross-projection consistency gates Issue: #504 — Schema parse-failure telemetry + repair playbook"
---

# Persisted-schema repair playbook

**Epic:** #493 — Persisted schema and cross-projection consistency gates  
**Issue:** #504 — Schema parse-failure telemetry + repair playbook

This playbook is the operator's guide for diagnosing and repairing persisted
payloads that fail their schema validators (`Document.deckJson`, embedded
`Document.contentJson` visuals, `Visual.data`, active Deck source metadata).

---

## 1. Detect — parse-failure telemetry

The server emits a structured diagnostic whenever it fails to parse a persisted
payload. The helper lives in `src/lib/diagnostics/schema-telemetry.ts` and logs
through `src/lib/log.ts` (`logError`) with **safe identifiers only** — never
document content.

Diagnostics are emitted from the document persistence service
(`src/lib/document/persistence-service.ts`): `persistDeck`, `patchDeck`,
`sanitizeRestoredDeck`, `reconcileDeckAfterMirror`, and the visual mirror
rebuild (`mirrorVisualNodesInTx`).

Each line carries:

| Field           | Meaning                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `scope`         | `schema.persisted`                                                                             |
| `category`      | `deck-parse-failed`, `visual-parse-failed`, `content-visual-parse-failed`, `sourceref-invalid` |
| `area`          | Where it came from (e.g. `Document.deckJson`, `Visual.data`)                                   |
| `documentId`    | Affected document (when known)                                                                 |
| `rowId`         | Affected row primary key (when known)                                                          |
| `anchorBlockId` | Visual anchor id (when applicable)                                                             |
| `reason`        | Opaque validator message (describes the schema breach, not content)                            |

Alert on a rising `category` count, then pivot to the audit CLI for a full
picture.

---

## 2. Locate — audit CLI (#501)

Scan the whole database for every violation:

```bash
npm run audit:schema           # human-readable summary (exit 0)
npm run audit:schema -- --ci   # exit 1 if any violation (release gate)
npm run audit:schema -- --json # machine-readable
```

- Core: `src/lib/schema-audit/audit.ts`
- CLI: `src/scripts/audit-persisted-schema.ts`

The report lists `area`, `documentId`, `rowId`, `anchorId`, and `reason` only.
For `Document.deckJson`, serialized JSON strings are reported as
persisted-schema drift; runtime readers expect Prisma JSON values to be parsed
objects and do not parse string decks. Current deck rows are validated with
`safeParseDeck`.

---

## 3. Repair options

Pick the smallest remediation that resolves the violation.

### 3a. One-off offline repair script

For systematic drift affecting many rows, write a scoped one-off repair script
for that incident, review it like application code, run it against a backup or
staging copy first, then delete it after the target data is repaired and audited.
Do not add runtime readers that accept the non-current shape.

### 3b. Visual mirror rebuild

`Visual` rows are a derived projection of the visual nodes in
`Document.contentJson`. When a `Visual.data` row is invalid but the source node
in `contentJson` is valid, rebuild the mirror — saving the document
re-mirrors visuals atomically (`mirrorVisualNodesInTx`), and
`reconcileDeckAfterMirror` strips any deck references that no longer resolve.
The reconciliation vocabulary (`found` / `stale` / `missing` / `invalid`) is
centralized in `reconcileDocumentDeckDependencies`
(`src/lib/document/source-ref-model.ts`).

### 3c. Document version restore

When a single document's `deckJson` is corrupt and no migration applies, restore
it from an earlier good snapshot (`DocumentVersion`). `restoreVersion`
(`src/lib/document/persistence-service.ts`) snapshots the current state first
("Before restore"), writes the restored content + deck (sanitized against the
restored content so orphaned visual refs are stripped), atomically rebuilds the
visual mirror, reconciles the deck, and revalidates public share/embed/present
caches.

### 3d. Stale source links

Stale source links (`slides[].source`, `slides[].children[].source`) are
**surfaced, not auto-deleted** — `reconcileDocumentDeckDependencies` counts them
as `stale` and leaves them in the deck so the author can re-link or unlink
intentionally.

---

## 4. Verify

After any repair, re-run the audit and confirm the application gate:

```bash
npm run audit:schema -- --ci
export DB_PROVIDER=sqlite DATABASE_URL="file:./prisma/dev.db" AUTH_SECRET=ci-placeholder
npm test && npm run typecheck && npm run lint && npm run format:check
```

---

## Related

- Audit CLI (#501): `src/lib/schema-audit/audit.ts`
- Telemetry helper (#504): `src/lib/diagnostics/schema-telemetry.ts`
- Reconciliation model (#503): `src/lib/document/source-ref-model.ts`
- Release gate: [`release-gate.md`](./release-gate.md)
