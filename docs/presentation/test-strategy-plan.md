---
type: "plan"
status: "active — hook-dispatcher retirement pending"
last_updated: "2026-07-02"
description: "Remaining P1 work to retire hook-dispatcher based presentation tests in favor of controller, descriptor, component, or browser coverage."
---

# Presentation Test Strategy Plan

## Priority And Goal

**Priority:** P1.

Remove presentation test coverage that depends on manually patching React hook
dispatchers, while keeping behavior coverage refactor-safe.

## Remaining Work

| Gap                            | Work                                                                                                                                                                                          | Exit criteria                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Hook-dispatcher retirement     | Replace presentation tests that use `createReactHookRenderer` or `withReactTestDispatcher` from `src/test/react-server-renderer.ts` with controller, descriptor, component, or browser tests. | Presentation tests no longer patch React exports to exercise hook state.                                |
| Shared failure harness cleanup | Remove hook-dispatcher use from the shared slide-editor failure harness where region/controller tests can cover the behavior directly.                                                        | Failure tests validate public behavior or extracted owners instead of private hook state.               |
| Focused replacement coverage   | For each retired hook-dispatcher test, identify the behavior owner and focused replacement file.                                                                                              | Coverage remains behavior-readable and can run without mounting the full editor shell when unnecessary. |

## Test Principles

- Prefer pure command/controller tests for logic that does not require React.
- Prefer component tests around public UI behavior for toolbar, inspector,
  filmstrip, and shell wiring.
- Use browser/E2E coverage for interactions whose correctness depends on real
  DOM selection, pointer movement, composition events, focus, or fullscreen.
- Do not treat DOM overlays as the source of truth for stage geometry; test
  geometry helpers and registry outputs directly.

## Verification

```bash
npx prettier --write <touched files>
npx eslint <touched lintable files>
npm run test:unit -- <focused presentation test files>
npm run test:presentation
npm run typecheck
```
