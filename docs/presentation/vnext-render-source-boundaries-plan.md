---
type: "plan"
status: "active — P2 provenance follow-up pending"
last_updated: "2026-07-02"
description: "Remaining P2 plan for typed provenance. vNext render, export, source, diagnostic, present/public, and document-plan boundary splits are implemented."
---

# vNext Provenance Typing Plan

## Priority And Goal

**Priority:** P2.

Replace loose provenance payloads in deck/node `extra` metadata with typed
helpers or branded payloads where possible, without changing runtime behavior.

The boundary split work that previously lived here is implemented: shared node
tree operations, render resolver passes, source/diagnostic action descriptors,
present/public shell sharing, modular export lowerers, and document plan module
splits. This plan remains only for the P2 provenance cleanup.

## Remaining Work

| Slice                  | Work                                                                                                                                   | Exit criteria                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Provenance inventory   | Identify deck/node `extra` metadata written by source planning, derivation, import, and repair paths.                                  | Each provenance payload has an owner and either a typed helper or an explicit reason to stay loose.         |
| Typed helpers          | Add typed/branded helpers for provenance reads and writes where the current schema can support them.                                   | Call sites stop hand-assembling loose provenance objects when a stable helper can express the same payload. |
| Schema-coupled cleanup | If stricter provenance typing requires a DeckV7 schema change, update schema, fixtures, tests, docs, and generated artifacts together. | Runtime validation, repair, export, present/public render, and document-derived generation remain stable.   |

## Constraints

- Do not change runtime output unless a downstream product change explicitly
  opts in.
- Do not reintroduce v6 bridges, aliases, conversion paths, flat arrays, or
  `groupId` as vNext architecture.
- Do not block editor decomposition or boundary refactors on this P2 cleanup.
- Keep faithful source compression as the default AI deck generation behavior
  unless product explicitly chooses a presentation-rewrite mode.

## Verification

```bash
npx prettier --write <touched files>
npx eslint <touched lintable files>
npm run test:unit -- <focused presentation-vnext test files>
npm run test:presentation
npm run test:public-render
npm run test:visual
npm run typecheck
```

Use the focused test files for the touched boundary first. Run
`npm run typecheck` whenever exported types, schema-adjacent helpers, or shared
runtime modules move.
