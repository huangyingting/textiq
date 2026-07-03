# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Architecture, scope, cross-subsystem contracts | Morpheus | Decide boundaries, review deck/editor/data-flow changes, resolve trade-offs |
| Frontend, editor, presentation UI | Trinity | Next/React UI, Lexical editor UX, slide editor, inspector, visual authoring components |
| Backend, persistence, auth, API routes | Tank | Prisma services, document/deck persistence, auth/account, route handlers, permissions |
| AI generation, visual schemas, render/export | Neo | Generate flows, visual registry/schema, deck commands, render resolver, PPTX/PDF export |
| Collaboration, runtime, operations, governance scripts | Dozer | Yjs rooms, custom server, env/runtime config, CI/local scripts, perf/import graph gates |
| Code review | Morpheus | Review PRs, check subsystem boundaries, suggest implementation direction |
| Testing | Mouse | Write tests, find edge cases, verify fixes, map subsystem coverage |
| Scope & priorities | Morpheus | What to build next, trade-offs, decisions |
| Session logging | Scribe | Automatic — never needs routing |
| Backlog monitoring | Ralph | Scan issues, queue work, keep the board moving |
| RAI review | Rai | Content safety, bias checks, credential detection, ethical review |

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Lead |
| `squad:morpheus` | Architecture, scope, contracts, lead triage | Morpheus |
| `squad:trinity` | Frontend/editor/presentation UI work | Trinity |
| `squad:tank` | Backend, persistence, auth, APIs | Tank |
| `squad:neo` | AI generation, visual system, render/export | Neo |
| `squad:dozer` | Collaboration, runtime, operations, scripts | Dozer |
| `squad:mouse` | Testing, QA, regression coverage | Mouse |
| `squad:rai` | RAI/security-sensitive content review | Rai |
| `squad:{name}` | Pick up issue and complete the work | Named member |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, the **Lead** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Lead review.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what port does the server run on?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If a feature is being built, spawn the tester to write test cases from requirements simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. The Lead handles all `squad` (base label) triage.
