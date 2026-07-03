---
type: "plan"
status: "active — hook-dispatcher retirement pending"
last_updated: "2026-07-03"
description: "Remaining P1 work to retire createServerRenderHarness/renderWithReact based presentation tests in favor of controller, descriptor, component, or browser coverage."
---

# Presentation Test Strategy Plan

## Priority And Goal

**Priority:** P1.

Remove presentation test coverage that depends on manually patching React hook
dispatchers, while keeping behavior coverage refactor-safe.

## Remaining Work

| Gap                            | Work                                                                                                                                                                                           | Exit criteria                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Hook-dispatcher retirement     | Replace presentation/editor tests that use `createServerRenderHarness` or `renderWithReact` from `src/test/react-server-renderer.ts` with controller, descriptor, component, or browser tests. | Presentation tests no longer patch React exports to exercise hook state.                                |
| Shared failure harness cleanup | Remove hook-dispatcher use from the shared slide-editor failure harness where region/controller tests can cover the behavior directly.                                                         | Failure tests validate public behavior or extracted owners instead of private hook state.               |
| Focused replacement coverage   | For each retired hook-dispatcher test, identify the behavior owner and focused replacement file.                                                                                               | Coverage remains behavior-readable and can run without mounting the full editor shell when unnecessary. |

## Completed Progress

- 2026-07-03: Extracted `createSlideEditorShellController` and migrated
  `src/components/presentation/use-slide-editor-shell-controller.test.ts` to a
  hook-free controller test.
- 2026-07-03: Extracted `createSourceReviewController` plus source-review
  derivation helpers and migrated
  `src/components/presentation/use-source-review-controller.test.ts` to a
  hook-free controller test.

## Current Harness Inventory

The remaining direct imports of `src/test/react-server-renderer.ts` are:

- `src/components/editor/use-slide-editor-open-coverage.test.ts`
- `src/components/presentation/conflict-recovery-dialog.test.ts`
- `src/components/presentation/deck-generation-preview-render.test.ts`
- `src/components/presentation/filmstrip/filmstrip.test.ts`
- `src/components/presentation/inline-text-editor-render.test.ts`
- `src/components/presentation/inline-text-editor-remaining-coverage.test.ts`
- `src/components/presentation/inspector-render.test.ts`
- `src/components/presentation/inspector/inspector-panels-render.test.ts`
- `src/components/presentation/inspector/layers-panel.test.ts`
- `src/components/presentation/inspector/node-content-panel-render.test.ts`
- `src/components/presentation/interaction-hooks-coverage.test.ts`
- `src/components/presentation/presenter-tools-coverage.test.ts`
- `src/components/presentation/render-surfaces-coverage.test.ts`
- `src/components/presentation/slide-editor-deep-coverage.test.ts`
- `src/components/presentation/slide-editor-failure-test-utils.ts`
- `src/components/presentation/slide-editor-final-coverage.test.ts`
- `src/components/presentation/slide-editor-render.test.ts`
- `src/components/presentation/slide-editor-state-coverage.test.ts`

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
