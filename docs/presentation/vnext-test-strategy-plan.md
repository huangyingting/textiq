---
type: "plan"
status: "active — React internals retirement pending"
last_updated: "2026-07-02"
description: "Remaining P1 presentation test strategy work. Oversized command and failure suites are split, and present/export parity has focused coverage; full React-internals retirement remains pending."
---

# vNext Test Strategy Plan

## Priority And Goal

**Priority:** P1.

Keep presentation tests refactor-safe: protect public contracts, controller
behavior, and user-visible workflows without adding coverage that depends on
private React internals or fake DOM assumptions.

The oversized command suite and slide-editor failure suite have been split by
command family and editor region. Present/export parity is covered by focused
unit/integration and E2E checks. Remaining work is limited to retiring the
quarantined React-internals harness.

## Remaining Work

| Gap                            | Work                                                                                                                                       | Exit criteria                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| React-internals retirement     | Replace remaining `src/test/react-internals.ts` and shared failure-harness usage with controller, descriptor, component, or browser tests. | No presentation test reaches private React state to prove behavior.                                        |
| Refactor acceptance discipline | Keep new refactor PRs tied to a behavior owner and focused test file.                                                                      | PRs identify the preserved behavior, new owner, replaced oversized/internals-coupled test, and validation. |

## Test Principles

- Prefer pure command/controller tests for logic that does not require React.
- Prefer component tests around public UI behavior for toolbar, inspector,
  filmstrip, and shell wiring.
- Use browser/E2E coverage for interactions whose correctness depends on real
  DOM selection, pointer movement, composition events, focus, or fullscreen.
- Do not mock React internals to reach private state. Extract a controller or
  action descriptor instead.
- Do not treat DOM overlays as the source of truth for stage geometry; test
  geometry helpers and registry outputs directly.

## Validation commands

Focused validation:

```bash
npm run test:unit -- <focused presentation test files>
npm run test:presentation
```

Broader validation when touched behavior crosses boundaries:

```bash
npx prettier --write <touched files>
npx eslint <touched lintable files>
npm run typecheck
npm run test:public-render
npm run test:visual
```

Use `npm run test:presentation` as the default subsystem guard. Use
`npm run test:unit -- <files>` for split command/controller files when the
runner can target the slice directly.

## Acceptance template for refactor PRs

Each presentation refactor PR should answer:

- [ ] Which current behavior is intentionally preserved?
- [ ] Which controller, descriptor, or boundary now owns the behavior?
- [ ] Which oversized or internals-coupled test was split, deleted, or replaced?
- [ ] Which focused test file proves the behavior?
- [ ] Did any source/schema/export/public-render contract change?
- [ ] Were `npx prettier --write`, lint for touched lintable files, focused
      tests, and necessary typecheck/subsystem checks run?

## Definition of done

- Tests read like product/controller behavior, not coverage padding.
- New controller boundaries can be tested without mounting the full editor.
- React internals mocking is removed from presentation tests.
