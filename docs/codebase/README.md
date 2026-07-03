---
type: "reference"
status: "current"
last_updated: "2026-07-03"
description: "Codebase onboarding index for stack, structure, architecture, conventions, integrations, testing, and concerns."
---

# Codebase Knowledge

These documents summarize the current repository from verifiable files, config,
source code, and terminal output. Source code, tests, schemas, and subsystem
docs remain authoritative.

| Document                           | Scope                                                                 |
| ---------------------------------- | --------------------------------------------------------------------- |
| [STACK.md](STACK.md)               | Runtime, package manager, production dependencies, tooling, config.   |
| [STRUCTURE.md](STRUCTURE.md)       | Top-level layout, entry points, boundaries, organization rules.       |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Architectural style, data flow, module responsibilities, patterns.    |
| [CONVENTIONS.md](CONVENTIONS.md)   | Naming, formatting, imports, errors, logging, testing conventions.    |
| [INTEGRATIONS.md](INTEGRATIONS.md) | External APIs, data stores, credentials, reliability, observability.  |
| [TESTING.md](TESTING.md)           | Test stack, layout, scope matrix, isolation, coverage signals.        |
| [CONCERNS.md](CONCERNS.md)         | Risks, technical debt, security/performance concerns, open questions. |

The generated scan evidence lives in `.codebase-scan.txt` and is intentionally
not linked as a primary document.
