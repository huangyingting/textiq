---
type: "runbook"
status: "current"
last_updated: "2026-07-04"
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

## Security Disclosure Link

The repository security disclosure process lives in the root `SECURITY.md` so
GitHub can discover it and display it from the repository Security tab.
