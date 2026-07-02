---
type: "plan"
status: "active — implementation pending"
last_updated: "2026-07-02"
description: "Remaining P2 work for presentation clipboard interoperability across portable TextIQ payloads, OS clipboard paste/copy, and copy-out fallbacks."
---

# Clipboard Interoperability Plan

## Priority And Goal

**Priority:** P2.

Make presentation editor copy, cut, and paste interoperate with the OS clipboard, other
TextIQ documents/tabs, and external apps without introducing a v6 clipboard
bridge.

## Remaining Work

| Slice                     | Work                                                                                                                                                       | Exit criteria                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Portable payload contract | Add a serializer/parser for `application/x-textiq-nodes+json` version 1 with schema validation, reachable asset collection, id remapping, and size limits. | TextIQ-to-TextIQ clipboard payloads are versioned, validated, and independent of transient editor state.           |
| Copy/cut writes           | Write TextIQ payloads through the async Clipboard API while retaining the current in-memory buffer as same-instance fallback.                              | Keyboard shortcuts and context-menu copy/cut populate OS clipboard where permitted and remain usable when blocked. |
| TextIQ paste reads        | Prefer TextIQ MIME payloads on paste, validate version/schema, import or rebind reachable assets, and insert through existing presentation commands.       | Cross-document and cross-tab paste preserves presentation nodes and reachable assets with fresh ids.               |
| OS image paste            | Read accepted image blobs from clipboard items, upload through `uploadSlideAsset`, add deck image assets, and insert image nodes.                          | Pasted images use the same validation, storage, focus, and error behavior as manual image upload.                  |
| HTML/plain-text paste     | Sanitize HTML with an allow-list and convert sanitized HTML or normalized plain text into presentation text nodes.                                         | Unsafe HTML is rejected or stripped; multiline text and basic formatting decisions have focused coverage.          |
| Copy-out fallbacks        | Write PNG, plain text, and optional safe HTML fallbacks alongside TextIQ payloads when browser capabilities allow.                                         | External apps receive a useful visual or text representation instead of raw JSON.                                  |
| Clipboard UX states       | Add recoverable status messaging for denied permission, unsupported browser, unfocused stage, oversized payload, and upload failure.                       | Clipboard failures are actionable and do not break same-instance editing.                                          |

## Constraints

- Do not add v6 clipboard payloads, conversion bridges, or compatibility paths.
- Clipboard reads/writes must stay tied to user activation and focused editor
  surfaces.
- Paste must not hijack text fields, inspector inputs, table cells, or modals
  unless that owner explicitly delegates paste to the stage.
- Asset-heavy payloads must include only reachable metadata and must not trust
  source-document URLs on cross-document paste.

## Verification

Implementation follow-ups should run focused serializer/parser tests,
presentation command tests, slide asset upload tests for image paste, and
`npm run test:presentation` for integrated clipboard behavior.
