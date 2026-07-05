---
Type: "plan"
Status: "completed — hook-dispatcher harness retired"
Last updated: "2026-07-04"
description: "Completed P1 work retiring hook-dispatcher presentation tests in favor of controller, descriptor, component, or renderer coverage."
---

# Presentation Test Strategy Plan

## Priority And Goal

**Priority:** P1.

Remove presentation test coverage that depends on manually patching React hook
dispatchers, while keeping behavior coverage refactor-safe.

## Completed Work

| Gap                            | Resolution                                                                                                                                                        | Exit criteria                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Hook-dispatcher retirement     | Removed the React export-patching helper and migrated surviving component tests to stable React renderer, server markup, controller, descriptor, or DOM coverage. | Presentation tests no longer patch React exports to exercise hook state.    |
| Shared failure harness cleanup | Removed the shared slide-editor failure harness and retired redundant full-shell failure tests now covered by region, stage, toolbar, and controller tests.       | Failure coverage validates public behavior or extracted owners.             |
| Focused replacement coverage   | Retained focused coverage in editor controllers, inline-text DOM adapters, stage interaction controllers, inspector panels, filmstrip, and render surfaces.       | Coverage remains behavior-readable without private hook dispatcher patches. |

## Completed Progress

- 2026-07-04: Removed `src/test/react-server-renderer.ts` and the remaining
  direct presentation/editor hook-dispatcher consumers; retained stable coverage
  through controller, descriptor, DOM-adapter, server-render, and React-renderer
  tests.
- 2026-07-03: Extracted `createSlideEditorShellController` and migrated
  `src/components/presentation/use-slide-editor-shell-controller.test.ts` to a
  hook-free controller test.
- 2026-07-03: Extracted `createSourceReviewController` plus source-review
  derivation helpers and migrated
  `src/components/presentation/use-source-review-controller.test.ts` to a
  hook-free controller test.

## Retired Harness Inventory

The retired direct imports were:

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
