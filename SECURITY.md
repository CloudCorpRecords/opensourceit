# Security Policy

## Supported versions

The latest release on npm (`@reneturcios/opensourceit`) and the `main` branch.

## Reporting a vulnerability

Please report privately via GitHub's "Report a vulnerability" (Security → Advisories) on this repository. Include reproduction steps and impact. We aim to acknowledge within 72 hours.

Do not open public issues for undisclosed vulnerabilities.

## Design notes

- Zero runtime dependencies: the supply chain is Node.js itself.
- The frontend escapes all user content before rendering; markdown is rendered from escaped text with an http(s)-only link whitelist.
- Moderation and write endpoints are handle-based (no passwords in v0.x); self-hosters who expose an instance publicly should put it behind their own auth proxy until account auth ships. Rate limits and a spam guard are built in, but an open public instance is a community, not a vault — do not store secrets in posts.
- Webhook deliveries are HMAC-SHA256 signed with the subscription secret (`X-Opensourceit-Signature`).
