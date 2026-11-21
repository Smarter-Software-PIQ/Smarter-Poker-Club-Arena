# tests/a-shipped-or-stale-incident-claim-stops-blocking.law.test.ts

A reliability incident claim cannot hold an incident hostage (incident 1e532243 stayed claimed for hours after its fix PR #11520 merged and the incident recurred, 2026-11-20): a claim blocks for at most 8 hours after its last progress (taken, or a changed branch or PR), stops blocking once its PR has merged and the incident fires again after the merge (merge read from GitHub, unknown kept unknown), every takeover is recorded as a claim_superseded incident event, and the handoff and CLAUDE.md 10.88 say so.
