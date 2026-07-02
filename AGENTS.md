# AGENTS.md

Project rules for AI coding agents.

## Rules

- Treat source, tests, and schemas as authoritative; docs are background.
- Keep edits scoped; prefer nearby code, tests, helpers, and patterns.
- Do not add compatibility layers for superseded payloads or legacy paths unless asked.
- When schemas change, update code, fixtures, tests, docs, and generated artifacts together.
- Preserve user work: never revert uncommitted changes, commit, branch, or run destructive git commands unless asked.
- Use structured parsers/APIs instead of brittle string manipulation.
- Presentation/editor work targets the current presentation subsystem; no v6 bridges, aliases, or conversion paths unless asked.
- Presentation UI changes start from existing behavior/layout parity before adding new visual structure.
- Docs describe current behavior, stay flat under `docs/<subsystem>/`, and update indexes/references on rename or delete.
- Docs must declare `Type`, `Status`, and `Last updated`; put future work in owning-subsystem `*-plan.md` files.

## Verification

Before handoff, run the smallest reliable checks for touched files.

- Format modified files first: `npx prettier --write <files>`.
- Lint modified lintable files after formatting: `npx eslint <files>`.
- Typecheck next with the smallest reliable scope; use `npm run typecheck` for shared types, routes, generated Next types, or broad contracts.
- Run nearest focused tests last; prefer `npm run test:subsystem -- <subsystem>` and add `--with-e2e` only when mapped E2E coverage matters.
- Broaden checks only for shared behavior or cross-module contracts.
- Before any requested code commit, re-stage formatter changes and commit only code that passed lint.
