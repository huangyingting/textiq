---
type: "contract"
status: "current"
last_updated: "2026-07-31"
description: "This document defines the UI action and keyboard shortcut contract. It sits between visible controls and domain-specific command execution: actions describe labels, tooltips, shortcut ids, and disabled states; shortcuts define discoverable key mappings; action ports keep client components from importing route actions directly."
---

# Actions And Shortcuts

This document defines the UI action and keyboard shortcut contract. It sits
between visible controls and domain-specific command execution: actions describe
labels, tooltips, shortcut ids, and disabled states; shortcuts define
discoverable key mappings; action ports keep client components from importing
route actions directly.

## Source Anchors

| Area                  | Source                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Action descriptors    | `src/lib/actions/action-descriptor.ts`                                                                     |
| Action ports          | `src/lib/action-ports.ts`                                                                                  |
| Action-port guard     | `scripts/check-action-ports.mjs`                                                                           |
| Shortcut registry     | `src/lib/shortcuts/catalog.ts`                                                                             |
| Shortcut domain files | `src/lib/shortcuts/catalog-global.ts`, `catalog-editor.ts`, `catalog-canvas.ts`, `catalog-presentation.ts` |
| Shortcut matcher      | `src/lib/shortcuts/match.ts`                                                                               |
| Shortcut React hook   | `src/lib/shortcuts/use-keyboard-shortcuts.ts`                                                              |
| Shortcut help UI      | `src/components/keyboard-shortcuts.tsx`, `src/components/shell-utility-slots.tsx`                          |

## Action Descriptors

An `ActionDescriptor` is UI metadata for a command-like affordance:

```ts
type ActionDescriptor<TContext = void> = {
  id: string;
  label: string;
  description?: string;
  shortcutId?: ShortcutId;
  tooltip?: string;
  disabledReason?: string;
  run?: (context: TContext) => void;
};
```

The descriptor does not own persistence. The owning surface decides how to run
the action, usually by dispatching a Lexical command, calling a Deck editor
command, or invoking an injected action port.

`actionTooltip` resolves tooltip text in this order: explicit tooltip,
description, label. `actionAriaKeyShortcuts` maps a `shortcutId` to the
canonical shortcut string for accessible controls.

## Shortcut Registry

The shortcut registry is framework-free and split by domain:

- global and dashboard shortcuts;
- document editor shortcuts;
- slide canvas shortcuts;
- presentation-mode shortcuts.

Each shortcut entry has a stable id, scope, display tokens, canonical string,
and matcher metadata. `shortcutsForScope` powers the global help dialog, while
`shortcutById` and `matchesShortcut` keep action labels and event handling tied
to the same registry.

The authenticated app shell mounts shortcut-help triggers in both its desktop
rail and mobile drawer, but only the persistent desktop instance registers the
global `?` listener. The mobile instance is trigger-only. This keeps one global
handler and one help dialog active even while the drawer is open.

Shortcut matching must not hijack typing. `isEditableTagName` marks inputs,
textareas, selects, and contenteditable targets as text-entry surfaces. The
React `useKeyboardShortcut` hook ignores text-entry targets unless the caller
explicitly opts into `allowInInput` for modifier-based shortcuts.

## Action Ports

Action ports are typed interfaces for route actions that a shared client
component needs but must not import directly. Examples include:

- deck fetch/save ports;
- slide asset upload ports;
- document list/search/mutation ports;
- import ports;
- comment mutation ports;
- visual generation ports;
- brand list/apply ports.

The port interface lives in `src/lib/action-ports.ts`; route shells supply the
actual server actions. Shared `src/components/**` and `src/lib/**` code must not
import `src/app/**/actions` modules directly.

`npm run action-ports:check` enforces this boundary. It fails when:

- shared `src/components/**` imports app route action modules;
- shared `src/lib/**` imports `src/app/**` route modules.

Small route-only client components under `src/app/**` may import sibling route
actions directly when they do not become shared library code.

## Relationship To Command Envelopes

Action descriptors and shortcuts describe UI affordances. Command envelopes
describe serializable command traffic across document-adjacent surfaces. They
are related but not interchangeable:

- action descriptor: label, shortcut, tooltip, optional local runner;
- shortcut entry: key matching and global help metadata;
- action port: injected server-action capability;
- command envelope: serializable mutation intent with actor, target, payload,
  schema version, and coalescing metadata.

## Invariants

1. Shortcut ids are stable and registry-owned.
2. Bare-key shortcuts are ignored while typing unless a surface explicitly opts
   in.
3. Shared components receive server actions through typed ports.
4. Route action imports stay in route shells, not shared components or shared
   libraries.
5. Action descriptors may reference shortcuts, but domain execution remains with
   the owning editor, visual, deck, or route surface.

## Primary Tests

- `src/lib/shortcuts/catalog.test.ts`
- `src/lib/shortcuts/match.test.ts`
- `src/lib/shortcuts/features.test.ts`
- `scripts/check-action-ports.test.mjs`
