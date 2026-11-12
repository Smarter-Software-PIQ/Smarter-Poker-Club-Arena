# The Classic VPIP Floor Proof Now Runs In CI, Against The Installed Sample

2026-11-12. Hold'em Strategy lane (Classic VPIP acceptance). No engine source,
no migration, no production change.

## What was wrong

`scripts/ci/test-classic-vpip-floor.sh` is the only thing that EXECUTES the
Classic floor rules: the thirty-hand window, the warning, the ten-hand grace,
expiry and exactly-once eviction, rejoin, activation and inheritance. No
workflow ran it. The automatic check was
`tests/the-classic-floor-warns-before-it-boots.law.test.ts`, which matches
source strings, and the script's own header says a string match cannot execute
a rule. The proof had only ever been run by hand.

It also proved the wrong functions. Production's `fn_nit_sample` and
`fn_nit_hands_since` come from the third migration, 20261111093132 (the
bounded read of the sitting). The proof applied only the first two, so every
behavioural assertion ran against the predecessors.

## What changed

- The proof applies 20261111093132 after the activation and before the
  assertions, so all of them run against the installed definitions.
- `.github/workflows/classic-vpip-floor-proof.yml` runs the proof on a native
  PostgreSQL 17 for every pull request that touches the script, its fixtures,
  the three migrations, the shared PostgreSQL install action or the workflow.
  A run that prints SKIPPED fails; the final pass line is required.

## Evidence

Local, Homebrew PostgreSQL 17, before the script change: 25 PASS lines, exit 0.
After it: 26 PASS lines, exit 0, including T7 (two passes over one expired
grace evict exactly once), T13 and T14 (rejoin keeps the sample, warning and
grace, and grace still expires across it) and T20 (a game and table created
after activation inherit the floor).

## Limits

This is executed proof of the SQL rules on a fixture database. It is not a
natural production observation: no warning has expired in production and no
eviction cashout has occurred there. The engine-side merge of evictable seats
and the human felt readout are covered by their own tests, not by this one.
