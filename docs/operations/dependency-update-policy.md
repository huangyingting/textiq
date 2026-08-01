---
type: "runbook"
status: "current"
last_updated: "2026-08-01"
description: "Dependency update automation policy for npm packages and GitHub Actions workflows."
---

# Dependency Update Policy

Dependency update automation is repository-native and configured in
`.github/dependabot.yml`. It keeps dependency intake explicit without changing
application code or hand-editing versions outside normal review.

## Automated Cadence

| Ecosystem      | Directory | Cadence                  | Labels                                   | PR limit |
| -------------- | --------- | ------------------------ | ---------------------------------------- | -------- |
| npm            | `/`       | Weekly, Monday 09:00 UTC | `dependencies`, `security`, `type:chore` | 5        |
| GitHub Actions | `/`       | Monthly, 09:00 UTC       | `dependencies`, `type:chore`             | 3        |

npm updates are grouped into production and development dependency PRs so
runtime changes can receive security-sensitive review while tooling-only changes
remain separate. GitHub Actions updates are grouped by Dependabot's normal PR
creation behavior and use the chore/dependencies labels used elsewhere in the
repository.

## Review Policy

1. Treat Dependabot PRs like any other code change: inspect release notes,
   changed lockfile entries, and transitive dependency movement before merging.
2. Prioritize security advisories and production dependency updates ahead of
   routine development-tool updates.
3. Run the smallest reliable checks for the affected surface. For most npm
   updates, start with `npm run docs:check`, `npm run typecheck`, and focused
   subsystem tests when a dependency maps to a subsystem. Use the full release
   gate for framework, Prisma, auth, database, import/export, or build-tool
   updates.
4. Do not hand-edit dependency versions as part of routine Dependabot review;
   let the bot refresh `package-lock.json` unless a human-authored dependency
   change is explicitly scoped.

## Release Enforcement

`npm run security:audit` is a release blocker and runs immediately after
`npm ci` in the main CI quality gate. It combines two npm registry checks:

1. `npm audit --omit=dev --audit-level=high` fails for high or critical
   advisories affecting production dependencies. The command reports
   lower-severity findings without failing, while development-only advisories
   remain tracked through Dependabot and optional full-tree audits.
2. `npm audit signatures` verifies registry signatures and attestations for the
   installed dependency tree. An invalid signature or attestation fails the
   gate.

Both checks require npm registry access. Resolve or explicitly replace an
affected dependency; do not bypass the command or weaken its audit threshold to
make a release pass.

## Security Disclosure Link

The repository security disclosure process lives in the root `SECURITY.md` so
GitHub can discover it and display it from the repository Security tab.
