# 2026-11-20: A shipped or stale incident claim stops blocking

## What happened

Reliability incident `1e532243` (money_integrity, `fn_ca_hand_gap_watch`) was
claimed on 2026-11-19 17:56 UTC with PR #11520. The PR merged on 2026-11-20 at
16:51 UTC. The incident recurred at 17:51 (a residual `all_in_showdown` cause)
and refired five more times by 22:56. Every reminder still said "claimed by ...
Coordinate with that owner; do not start a second fix", and the owner kept
renewing the claim with the same branch and PR (expiry pushed to 2026-11-21
16:54 UTC), so no lane could act for hours.

## Root cause

`smarter_private.fn_claim_reliability_incident` (20261118191706):

1. never learned that the claim's PR had shipped, so a merged fix followed by a
   fresh firing still blocked every other lane;
2. let the holder renew without limit: each call with a TTL of up to 24 hours
   pushed `expires_at` out again, with no evidence of progress.

## Fix

Migration `20261121000852_a_shipped_or_stale_incident_claim_stops_blocking.sql`:

- `progress_at` on each claim: set when it is taken or when the holder renews
  with a changed branch or PR. Every claim and renewal is capped at
  `progress_at + 8 hours` (two 4-hour terms with no visible change); past it the
  holder cannot renew without a new branch or PR and the claim no longer blocks.
- `pr_merged_at` on each claim. When another lane is refused by a claim naming a
  PR with no recorded merge, the claim call reads the PR from GitHub through the
  existing `smarter_private.ca_cutover_http_json` (8 s timeout, NULL when it
  cannot tell) before taking any row lock, and records the merge. No table in
  the database records PR merges, so GitHub is the source; the controller tick
  and the renderer never make a network call.
- A claim whose PR merged stops blocking once the incident fired again after
  the merge (`recurrence` or `refire` events). Continuous firing that never
  resolved is not a recurrence, so a merged fix still waiting to go live is not
  superseded by the firing it is about to cure.
- One state function, `smarter_private.reliability_incident_claim_state`, decides
  `none | live | expired | lifetime_spent | shipped_and_recurred` for both the
  claim call and the handoff.
- A takeover appends a `claim_superseded` event (reason, previous claim row, new
  owner) to the append-only `reliability_incident_events`.
- The handoff line (`smarter_private.reliability_claim_owner_line`) says which
  state the claim is in; the escalation renderer calls it (anchored edit of
  production's body, verified to match exactly once).

Existing rows get `progress_at = claimed_at`, so the `1e532243` claim stops
blocking when the migration installs. No claim row was edited by hand.

## Proof

`scripts/ci/qualify-reliability-incident-claims.py` (Stage B harness, real
PostgreSQL): the original contract still holds on top of the new migration, and
11 new behaviours, including the lifetime cap, refused unchanged renewal,
supersession records, GitHub-unknown keeps the claim, merged-without-recurrence
keeps the claim, merged-and-recurred supersedes, and the holder's follow-up
branch. Law: `tests/a-shipped-or-stale-incident-claim-stops-blocking.law.test.ts`.
CLAUDE.md 10.88 updated.

## Install

Installs from protected main through the normal applier. Installers are
disabled until window `2026-11-20-owner-no-notice-engine-2330z` is sealed, so
the migration stays queued until then.
