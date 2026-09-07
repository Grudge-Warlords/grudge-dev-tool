# Security Policy

## Supported versions

Security fixes target the current release and `main`. Older local packages are assessed case by case and should not be assumed supported.

| Version | Support |
| --- | --- |
| Current release / `main` | Supported |
| Older releases and unpacked trials | Not guaranteed |

## Report a vulnerability

Use the repository's private **Security → Advisories → New draft security advisory** flow. Do not open a public issue for an unpatched vulnerability and do not include credentials, tokens, private user data, or destructive proof-of-concept material in public channels. If private advisories are unavailable, open a minimal public issue asking the maintainers for a private reporting route without disclosing vulnerability details.

Include the affected version or commit, platform, impact, reproduction prerequisites, the smallest safe reproduction, and any known mitigation. No response-time SLA is published.

## Maintenance handling

Automated discovery is observational. A security advisory never authorizes an install, dependency upgrade, permission change, secret change, data migration, deployment, release, or process termination. Candidates follow the provenance, quarantine, budget, validation, rollback, and approval controls in [docs/daily-maintenance.md](docs/daily-maintenance.md).
