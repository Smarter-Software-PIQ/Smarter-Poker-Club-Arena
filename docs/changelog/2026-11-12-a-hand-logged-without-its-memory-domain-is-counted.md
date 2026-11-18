# A hand logged without its memory domain is counted

Finding HVH2D-EXE-002: from 2026-11-07 every ordinary cash hand that reached
showdown was written without `hand_history.public_memory_domain` (589 of 589 in
one production hour), and the exact opponent-memory trigger skipped each one.
`logHandHistory` omits the column silently when the producer's value is not
valid, so nothing reported it. #10631 repairs the producer. This change adds
the signal.

## What changed

- `server/src/services/supabase/handMemoryDomainSignal.ts` classifies each hand
  from the same inputs its row is built from, and `logHandHistory` counts it
  once after the atomic commit accepts it. Nothing written changes.
- Two always-on, zero-seeded counters in
  `server/src/observability/engineInstruments.ts`:
  `poker_hand_memory_domain_logged_total{mode,reached_showdown,learner_scope}`
  and `poker_hand_memory_domain_missing_total{mode,reached_showdown,reason}`,
  with `reason` one of `absent`, `invalid`, `unsupported_variant`.
- One rule, `HandMemoryDomainMissingOnCashShowdown` (warning,
  `club-arena-engine`), in `infra/monitoring/alert-rules.yml`: the missing share
  of learnable cash showdown hands above 0 over 30 minutes, with at least 50
  such hands, for 15 minutes. It reports only.
- Runbook `docs/runbooks/hand-memory-domain-missing.md`; promtool cases in
  `tests/monitoring/hand-memory-domain-missing.test.yml`.

## What is exempt

A hand whose variant is outside the nine the trigger learns can never be
learned, so its missing domain is `unsupported_variant` and is outside both
sides of the alert. No other exemption exists in source.

## Counted once

Identical-request retries all happen inside the one awaited commit; the count
follows it. A refused or unproved commit throws first and is not counted. A
hand completed by a replacement engine through the retained-submission resume
does not pass through `logHandHistory` and is counted on neither side.
