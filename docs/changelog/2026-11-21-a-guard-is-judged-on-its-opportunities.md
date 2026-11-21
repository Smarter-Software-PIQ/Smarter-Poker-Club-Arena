# A guard is judged on its opportunities, and upgrade 04 is counted where it is used (2026-11-21)

Evidence only. No Horse decision changes.

## What the evidence said

`horse_upgrade_evidence_daily` (read-only, Nov 18 to 20) read two upgrades as dead:

- `upgrade_09_preaction_purge`: invoked 0 of 3,552,206 decisions (0 fires on any day on record, 9.6 million brain
  decisions in all). Those decisions were every FAST brain decision, because the worker fold credits each enabled
  upgrade with every decision in its declared games. None of them is an opportunity for this upgrade: it is a guard
  that clears a stale pre-action at a server-owned Horse turn, and only a person who piloted a Horse account through
  the client, armed a pre-action and dropped off can leave one.
- `upgrade_04_plo5_plo6_reservoir`: invoked 192 of 1,502,984 Omaha decisions. Its only counter
  (`upgrade04_omaha_reservoir_*_seen`) fires in `buildOmahaReservoir`, once per worker process and shape, so it
  counted worker starts. Every Omaha percentile and band draw reads the reservoir and counted nothing.

## Upgrade 09 is a guard

- `HorseUpgradeEvidence.PER_HORSE_GUARD_UPGRADES` = { upgrade 09 }. The worker fold credits a guard nothing. Its cell
  holds its own opportunities (decisions) and the ones it acted on (invoked), both from `noteHorseUpgradeEvent`, which
  takes `acted` (default true).
- Both hosts count the opportunity apart from the act: `upgrade09_preaction_purge_opportunity_{table,lightning}_seen`
  on every armed pre-action at a server-owned Horse turn; the purge counter only when the pre-action is gone after the
  clear (re-read; `getPreAction` / `hasPreAction` are plain map reads).
- `judgeHorseUpgradeEvidence`: `guard_idle` (no opportunity, healthy), `guard_held` (acted every time, healthy),
  `guard_missed` (an opportunity it did not act on, flagged). `scripts/ops/per-horse-upgrade-evidence-daily.sql`
  adds a `verdict` column with the same rule and always lists every guard (an idle guard has no rows). Days before
  this release still hold upgrade 09 with every brain decision as decisions and read `guard_missed`.

## Upgrade 04 has a per-decision use receipt

- Every reservoir read (`omahaPreflopPercentile`, `placeOmahaBandCombo`, `placeOmahaPressureCombo`) increments one
  module integer (`HorseEval.omahaReservoirReadsTotal`). No counter call sits in the equity loops.
- `workerRuntime.executeFastWithUpgradeEvidence` reads it before and after one FAST execution and, when it moved,
  fires `upgrade04_reservoir_used_seen` once, inside the fire scope, after `executeFast` has returned. That is upgrade
  04's needle now; the build counter stays a separate build receipt.
- Limit: the style-shadow re-decision runs inside the FAST execution, so a decision whose only reservoir read was in
  the shadow is counted too.

## Cost

Micro-benchmark (numbers in the PR): the added work per decision is one integer increment per reservoir read plus one
comparison and at most one `noteFire` per decision.

## No migration

The daily table and its writer are unchanged (the classification lives in TypeScript and in the read-only operations
script).
