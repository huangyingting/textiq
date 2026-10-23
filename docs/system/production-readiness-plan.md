---
type: "plan"
status: "in-progress"
last_updated: "2026-10-23"
description: "Evidence-led application review and scoped refactoring batches, with explicit local and external production gates."
---

# Production Readiness Plan

## Success condition

The relational model and authored JSON agree on identity, ownership, lifecycle,
and source of truth. Core workflows persist after reload, report failures, and
recover without losing work. A green local run is not certification of external
providers or a deployed production database.

## Review findings

The high-level model is appropriate: users own documents, workspaces grant
access without changing document ownership, document content and presentations
are independently authored, and visual rows and search text are projections.
Workspace owners are represented separately from editor/viewer memberships.
Document versions retain recovery state; assets have document-scoped access and
delayed cleanup. Do not replace this model with a wholesale rewrite.

Concrete defects identified:

1. The sharing metadata interaction test still targeted a native select after
   the shared SelectMenu migration.
2. Identical slide-image reuploads reused retired asset identities without
   restoring bytes or clearing soft deletion.
3. Document duplication copied presentation references but not protected media,
   leaving the copy dependent on source-document access and retention.
4. The asset-retention scan omitted image and file registries, so registered
   media without a direct slide-node reference could be retired.
5. Parent floating surfaces treated portaled SelectMenu choices as outside
   clicks, breaking guide editing, slide-master controls, and sharing settings.
   Escape also dismissed parents or depended on effect-listener registration
   order when child surfaces opened later. Modal, drawer, sheet, and transient
   surfaces now share hierarchical dismissal ordering without making transient
   menus lock page scrolling.
6. Several browser assertions still expected native selects or used ambiguous
   partial accessible names after the shared dropdown migration.
7. A root-level invite-only specification claimed alignment that the current
   schema and registration/OAuth paths do not implement. It has been moved to
   the auth subsystem as an explicit proposal; workspace membership invitations
   must not be confused with account-admission invitations.
8. Mutating contextual-editor browser checks shared the canonical read fixture
   and interacted before collaboration readiness. They now use dedicated,
   worker-partitioned document rooms and the existing live-editor readiness
   check instead of relying on timing or undo-based cross-test cleanup.
9. Current npm advisory data identified 17 vulnerable package groups, including
   two critical and 14 high groups. Supported Next.js and Prisma upgrades and
   refreshed transitive dependencies remove the audited findings. The scoped
   PptxGenJS `image-size` override is covered by actual PNG/PPTX archive tests;
   the obsolete `sharp` override was removed. The reported `sprintf-js`
   advisory is withdrawn upstream, not a reason to force an incompatible
   `argparse` replacement or dismiss alerts.
10. Real coarse-pointer emulation exposed palette removal buttons expanding
    over their color controls. Paired touch controls now occupy separate space,
    including the equivalent logo/removal arrangement.
11. The public presentation attribution badge covered the mobile Next button.
    Presentation pages now reserve safe-area-aware space above navigation;
    ordinary share-page attribution keeps its existing placement.
12. Inline comments required mouse hover and had no usable gutter on narrow
    document layouts. Touch/pen paragraph activation and a compact reserved
    gutter now expose both new-comment actions and persisted thread markers.
13. Presentation frames resized while point-sized body text did not, causing
    mobile wrapping and clipped bullets. Authored slide content and inline
    editing now share a 960px reference coordinate space. Viewport/zoom scaling
    leaves interaction handles in screen coordinates and does not rewrite
    authored font sizes.
    During this refactor, screenshot inspection also caught selection controls
    escaping over mobile inspector sheets. Unscaled controls now retain a local
    stacking context, guarded by browser hit-testing.
14. Native document-end navigation around a final noneditable visual could
    prepend subsequent typing to the first paragraph. Explicit Lexical boundary
    selection now handles unmodified Ctrl+Home/End and Meta+ArrowUp/Down
    navigation without mutating authored content. Extended selections,
    composition, and read-only navigation retain native behavior.
15. Inline list paragraphs placed noneditable marker spans inside flex rows.
    A minimized Chromium page reproduced native Select All and replacement
    failure even without application handlers or transforms. Generated CSS
    markers retain the same wrapping geometry without blocking text selection
    or entering serialized text.
16. Search and document-card retry handlers removed their error controls as
    soon as retry began. Rapid activation could click through the disappearing
    surface into a document link. Retry controls now remain mounted and disabled
    until the request resolves; successful recovery then clears the error.

The schema's unique `(documentId, anchorBlockId)` constraint already prevents
duplicate non-null visual anchors; hypothetical duplicate-row repair is not a
reason to add runtime complexity. Persisted role/status strings are deliberate
cross-provider storage choices; application validation remains necessary.

## Batches

| Batch | Scope                     | Status           | Exit condition                                                                                                                        |
| ----- | ------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Baseline and model review | Complete         | Schema generation parity, full typecheck, model/document tests, lint/governance baseline, isolated browser inventory                  |
| 2     | Document media lifecycle  | Complete         | Reupload restores usable media; duplicated presentations own independent media; regression tests exercise rollback and references     |
| 3     | UI and workflow repair    | Complete         | Existing production-build Playwright matrix runs; confirmed failures receive focused fixes and reruns                                 |
| 4     | Release evidence          | Complete locally | Format, lint, typecheck, focused tests and relevant governance checks pass; completed evidence and external gates recorded            |
| 5     | Dependency remediation    | Complete locally | Zero audited findings, signed-package checks, schema parity, production build, and application regression matrix                      |
| 6     | Visual feature review     | Complete locally | Inspect desktop and real-touch mobile screenshots; repair reproduced placement/editing defects; rerun persistence and geometry checks |

Each batch preserves existing layout and feature behavior. Add no superseded
payload adapters, speculative abstractions, or schema migrations without a
reproduced requirement.

## Validation loop

For each defect, reproduce with a focused test, repair the owning module, and
rerun the exact failing interaction. Before handoff, format modified files, lint
modified code, typecheck shared contracts, and run the nearest subsystem tests.
Use a separate SQLite database and profile-owned ports for browser execution;
never reseed a developer's live database.

## Remaining release gates

- Exercise Postgres transaction and constraint behavior against the deployment's
  supported database, with a backup/restore and migration rehearsal.
- Confirm the intended account-admission policy before any invite-only rollout;
  current registration remains public. Verify real email delivery, Google OAuth
  redirects, Stripe webhook/payment lifecycle, and configured AI-provider calls.
- Validate deployment storage durability, retention scheduling, collaboration
  topology, observability, load, and recovery. Local filesystem media is not a
  shared multi-instance storage system.
- Run supported browsers/devices and visual comparisons in the release
  environment; Chromium structural checks do not prove all browser combinations.

## Execution evidence

Initial baseline: schema parity and full typecheck passed; 1,379 model/document
checks passed; full lint/governance passed. The full application unit baseline
had 8,067 passes and the one stale sharing-control test described above.
The initial maintained browser profile inventoried 171 tests across 32 files.

The first browser run passed 163 and exposed eight failures; the second passed
167 and exposed four remaining assertion, readiness, and nested-dismissal
failures. Dynamic nested-dismissal defects were reproduced independently with
focused tests before fixing the shared overlay module. Full repository tests and
coverage gates also passed before this final overlay repair.

Verification of the initially published batches on 2026-10-23:

| Check                                                   | Result                                                                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Prisma validation                                       | Postgres and SQLite schemas valid; generated SQLite schema matches its Postgres source                                      |
| `npm run lint`                                          | ESLint, architecture/import guards, E2E inventory, design-system and performance-budget checks passed                       |
| `npm run typecheck`                                     | Application and restricted document-persistence contracts passed, including after browser-profile configuration restoration |
| `npm test`                                              | 8,085 source tests and 708 script tests passed; enforced coverage, breadth, and test-map gates passed                       |
| `npm run test:e2e:profile -- --trace retain-on-failure` | All 171 Chromium tests across 32 files passed against the production build and isolated SQLite database; no retries         |
| `npm run docs:check`                                    | Source inventory, local links, index reachability, and formatting passed                                                    |

Browser coverage includes account lifecycle, document editing/import/export,
independent-media duplication, presentation editing and recovery, sharing and
passcodes, public render/embed, comments/history, workspaces/invitations,
billing-profile behavior, brands, and responsive controls.

One earlier full run reached a client error boundary when signing in after
account deletion. It did not recur in an isolated traced run or the final full
traced matrix. No speculative authentication change was made; retain this
observation on the release watchlist and capture a trace if it recurs.

These are local verification results, not production certification of external
providers, live Postgres transactions, load, or every supported browser.

## Feature-by-feature visual review

The additional production-build browser review uses 1440px desktop and 390px
mobile layouts, with actual touch/coarse-pointer emulation on mobile rather
than viewport resizing alone. It captures screenshots, page-overflow and panel
geometry, and editing/save/reload results. Temporary screenshot-driving checks
are separate from the maintained regression inventory.

| Feature                         | Reviewed interactions                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Public entry and authentication | Landing page, login, signup, responsive form placement                                                                                     |
| Dashboard                       | Search, document actions, mobile navigation drawer                                                                                         |
| Document authoring              | Text-formatting toolbar/sheet, nested color picker, paragraph edits, slash/table insertion, save/reload, boundary navigation after visuals |
| Sharing and recovery            | Sharing controls, version-history placement                                                                                                |
| Comments                        | Desktop gutter, mobile paragraph taps, thread placement, persisted touch-created comments                                                  |
| Presentation authoring          | Stage, themes, guides, speaker notes and reload, responsive text bounds, zoom typography, inline-edit scale and persistence                |
| Workspaces                      | Creation, members page, invitation-role controls                                                                                           |
| Account and billing             | Profile/password surfaces, billing layout, system dark-mode rendering                                                                      |
| Brand Studio                    | Palette/removal hit targets, nested color picker, logo/removal layout                                                                      |
| Public presentations            | Present/embed navigation with actual taps at 320px, 390px, and 640px                                                                       |

The first visual pass executed 20 checks: 16 passed, three product defects were
reproduced, and one failure came from a shared mutating review fixture. Screenshot
inspection and a focused browser probe additionally reproduced slide-text
clipping independently of mobile text inflation and font-loading timing.
A fresh keyboard-only scenario reproduced the document-end editing defect
without involving formatting popovers. Mutating review and regression checks now
use independent document rooms.

The expanded review exercised 24 desktop/touch-mobile checks, including native
inline text replacement and mobile text-inspector editing. Screenshot inspection
also caught selection chrome escaping over an inspector during the scaling
refactor; touch hit-testing now guards the corrected stacking context. Isolated
fixture reseeding clears only its own comment/read rows, making repeated runs
independent of prior comment creation. Dashboard recovery was reproduced with
pending-request component tests and its complete browser lifecycle passed twice
after the retry-surface repair.

Final verification of the dependency and visual-review batches on 2026-10-23:

| Check                                                               | Result                                                                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Dependency integrity                                                | Zero npm vulnerabilities, including development dependencies; 702 registry signatures and 192 attestations verified            |
| Hosted dependency alerts                                            | GitHub's API reports zero open Dependabot alerts after publication; the previous snapshot had 33 alerts                        |
| Prisma validation                                                   | Both provider schemas valid; generated SQLite schema matches the Postgres source                                               |
| `npm run lint`                                                      | Full ESLint and repository governance checks passed                                                                            |
| `npm run typecheck`                                                 | Application and document-persistence contracts passed, including after browser-profile configuration restoration               |
| `npm test`                                                          | All 8,094 source tests and 708 script tests passed; coverage, breadth, ownership-map, and naming gates passed                  |
| `npm run test:e2e:profile -- --workers=1 --trace=retain-on-failure` | All 177 maintained Chromium tests across 32 files passed against the production build and isolated SQLite database; no retries |
| Runtime dependency smoke                                            | All 10 checked runtime modules resolve and the generated Prisma client exists; this is not a fresh omit-dev installation       |
| `npm run docs:check`                                                | Source inventory, browser inventory, links, index reachability, and formatting passed                                          |

Seven reproduced feature/recovery defects were repaired, along with the
inspector-stacking regression caught during refactoring. Native list replacement,
responsive typography, touch targets, persisted comments and edits, document
boundary navigation, and retry recovery now have maintained regression coverage.
The temporary visual gallery remains separate from the maintained test inventory.
The profile restored its configuration and stopped its listeners after completion.

The dependency and feature-review checkpoints were published as `399b9d44` and
`fc58217b`. GitHub's post-publication alert refresh resolved the previous 33 open
alerts (4 critical, 22 high, 7 medium); no alerts were manually dismissed.

The initial green structural matrix alone did not establish correct visual
placement or coarse-pointer usability. These expanded local checks still do not
certify external providers, production Postgres, or every browser/device
combination; the release gates above remain explicit.

## Next planned release batches

1. Run provider-parity and concurrency checks on an isolated Postgres deployment,
   including document-media rollback, billing/credit idempotency, and a
   migration/backup/restore rehearsal. Audit historical dangling asset references
   before designing any repair; this batch does not rewrite malformed old decks.
2. Exercise configured external email, OAuth, Stripe, and AI-provider lifecycles
   with dedicated test accounts. Settle account-admission policy separately;
   adopting the auth proposal is not a prerequisite for public registration.
   Repeat account deletion and rejected sign-in under realistic concurrency,
   retaining traces for the intermittent observation above.
3. Validate the deployment's durable media storage, retention workers,
   collaboration recovery, monitoring, and realistic load. Run the supported
   browser/device matrix and visual review before production sign-off.
