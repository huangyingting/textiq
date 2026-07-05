---
type: "runbook"
status: "current"
last_updated: "2026-07-04"
description: "Operational docs cover deployment, runtime constraints, readiness checks, and manual release procedures."
---

# Operations Docs

Operational docs cover deployment, runtime constraints, readiness checks, and
manual release procedures.

| Document                                                                             | Type      | Scope                                                                                               |
| ------------------------------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------- |
| [runtime-config.md](runtime-config.md)                                               | Reference | Environment-variable inventory across app, client, scripts, Prisma, and E2E tooling.                |
| [quality-gates.md](quality-gates.md)                                                 | Reference | Local/CI quality gates, lint chain, focused test router, and governance scripts.                    |
| [developer-bootstrap.md](developer-bootstrap.md)                                     | Runbook   | Local developer doctor/setup, worktree-safe development, local CI parity, and browser QA commands.  |
| [collaboration-deployment.md](collaboration-deployment.md)                           | Runbook   | Yjs collaboration server deployment, authorization, durability window, and scaling options.         |
| [release-gate.md](release-gate.md)                                                   | Runbook   | Release readiness checklist and local/CI quality gate.                                              |
| [schema-repair-runbook.md](schema-repair-runbook.md)                                 | Runbook   | Repair playbook: parse-failure telemetry, audit CLI, mirror rebuild, version restore (Epic #493).   |
| [resource-limits.md](resource-limits.md)                                             | Contract  | Central limit inventory for import, AI, deck persistence, assets, documents, and timing budgets.    |
| [privacy-dsar-runbook.md](privacy-dsar-runbook.md)                                   | Runbook   | Personal-data inventory, account export coverage, erasure verification, and public metadata policy. |
| [retention-runner.md](retention-runner.md)                                           | Runbook   | Scheduled purge runner for expired tokens, rate-limit windows, and soft-deleted asset bytes.        |
| [dependency-update-policy.md](dependency-update-policy.md)                           | Runbook   | Dependabot cadence, dependency labels, and review policy.                                           |
| [../security/api-route-security-matrix.md](../security/api-route-security-matrix.md) | Reference | API route classification, denial semantics, and abuse-control diagnostics (Epic #495).              |

## Rule Of Thumb

If a document describes how to run, deploy, verify, or release the system, it
belongs here rather than under a product subsystem. If a document describes what
must stay green in local or CI checks, it belongs in [quality-gates.md](quality-gates.md)
and is referenced from release-facing runbooks.
