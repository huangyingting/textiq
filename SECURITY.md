# Security Policy

## Supported Versions

Security fixes target the current default branch and the latest deployed release.
Older release branches or forks are unsupported unless this file is updated to
name them explicitly.

| Version                 | Supported          |
| ----------------------- | ------------------ |
| `main`                  | :white_check_mark: |
| Older branches/releases | :x:                |

## Reporting a Vulnerability

Please do not open public issues for suspected vulnerabilities.

Use GitHub private vulnerability reporting from the repository **Security** tab
(**Report a vulnerability**) when it is available. Include:

- affected route, workflow, dependency, or feature;
- impact and exploitability notes;
- reproduction steps or a minimal proof of concept;
- relevant dependency names and versions, if applicable.

Do not include production secrets, private user data, or copied customer content
in the report. If private vulnerability reporting is unavailable, contact the
repository maintainers through a non-public channel and share only enough detail
to establish a secure reporting path.

## Response Expectations

Maintainers should acknowledge new reports within 3 business days, provide an
initial triage result within 7 business days, and keep reporters updated when a
fix or disclosure timeline changes. Critical exploitable issues should be
prioritized ahead of routine dependency update PRs.

## Dependency Security

Dependency update automation is configured in `.github/dependabot.yml` for npm
and GitHub Actions. The operational cadence and review policy live in
`docs/operations/dependency-update-policy.md`.
