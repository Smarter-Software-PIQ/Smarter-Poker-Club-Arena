# Horse Option Shadow Watch

`scripts/ops/horse-option-shadow-watch.mjs` reads one live Horse option shadow trial (PLO or hold'em) and prints one
line `VERDICT=CLEAN|DIRTY`. Read-only: SELECTs through `supabase db query --linked`; it writes nothing.

```bash
node scripts/ops/horse-option-shadow-watch.mjs <option> --since 2026-11-26T05:00:00Z [--release <sha prefix>] [--json]
```

Exit 0 CLEAN, 1 DIRTY, 2 when it cannot run (a bad argument, an unregistered option, a failed read).

## What Makes A Trial Dirty

No re-decision in the window, an acted leak, the stage or inline breaker tripped, a re-decision failed or could not be
encoded, an error in `horse_error_log`, or 1% or more of re-decisions over 100 ms. The trial's own counters
(`option_shadow_<option>_<changed|same>[_person]_seen`, the direction counters, the stage latency scopes) and the
guards are described in `docs/ops/horse-option-shadow-stage.md`.

## Acted Receipts Come From The Ledger (2026-11-26)

In shadow the acted decision passes nothing for the option, so the receipts the option fires only when it acts must be
absent from the window: any of them is an acted leak. Until 2026-11-26 the watcher knew those receipts for four
options by a table in the script and printed `VERDICT=DIRTY reasons=acted_leak_unchecked` for every other option, so a
clean trial read as dirty.

Now each option's acted receipts are derived from its own ledger entries (`server/src/engine/HorseOptionActedReceipts.ts`):

- every receipt entry in `HorseDataLedger.ts` whose consumer names the option (a whole word, or a glob such as
  `holdemTournament*DefenceIsPriced`); exact keys are matched exactly, `x_*` families by prefix;
- a receipt whose consumer also names other registered options is legitimate while one of those is `on` or
  `on_shadow` (`unlessOn`);
- where the receipts do not name the option, `OPTION_ACTED_RECEIPTS_DECLARED` in the ledger declares them, or declares
  `none` with the reason (the option fires no receipt of its own; the report says so and the leak check does not make
  the trial dirty);
- an option on (or code-decided) by release default acts in shadow by design, so the check does not apply
  (`release_default`).

The resolved table is `scripts/ops/horse-option-acted-receipts.json`, written from `server/` by
`npx tsx scripts/gen-horse-option-acted-receipts.ts` (`--check` exits 1 when stale). The build gate
`server/src/engine/everyShadowOptionKnowsItsActedReceipts.law.test.ts` fails when a registered option that is off by
release default and takes shadow has no acted receipt and no reasoned `none`, or when the JSON's data differs from
the derivation. So "unchecked" is a build failure for a registered option, never a runtime verdict; the watcher refuses an
unregistered name outright. `--acted-prefix <prefix>` still adds a prefix for a one-off read.

## Adding An Option

Register its receipts in the ledger with a consumer that names it (for example
`receipt('holdem_new_rule_seen', 'HorseLogic (holdemNewRuleIsPriced)', ...)`), then regenerate the JSON. If it fires
no receipt of its own, add `none` with the reason to `OPTION_ACTED_RECEIPTS_DECLARED`.
