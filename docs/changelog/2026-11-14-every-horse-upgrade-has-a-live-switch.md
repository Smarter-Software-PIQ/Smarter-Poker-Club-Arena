# Every Horse decision upgrade has a live switch

The style read switch (2026-11-13) could carry seven options. Other built Horse
decision options that ship switched off could only be turned on, or turned back
off, with an engine release. This change widens the same switch so it also
carries fourteen of them. It is the same table (`ca_horse_style_switch`), the
same audit table, the same 30 second engine read and the same worker message.
There is no second table.

**Nothing is switched by this change.** The migration adds no row. With no row
for an option the engine does not pass that option at all, so the code default
decides exactly as before; a real decision with an empty switch is handed the
same options and journals the same replay state as one with no switch wired.

## What an operator can do after the migration is installed and an engine carrying this change serves

Service role only; every change is recorded in `ca_horse_style_switch_audit`
with the actor, the time and a note.

    SELECT public.fn_ca_horse_option_switch_set('<option>', 'off', '<actor>', '<note>');  -- 'on' only with evidence, below
    SELECT public.fn_ca_horse_option_switch_clear('<option>', '<actor>', '<note>');  -- back to the release default
    SELECT public.fn_ca_horse_option_switch_effective();

A change reaches every decision worker within about 30 seconds. The switch is
fleet-wide per option: there is no per-Horse, per-lane, per-club or per-table
setting.

## Switchable options (release default of every one: off)

The seven style options, unchanged, with off, shadow, canary and on:
`styleValueBettorNotManiac`, `styleBigBetHonesty`, `styleRaiseRespect`,
`styleTightReRaiserRespect`, `styleFoldRatePreRepair`, `styleValueExtraction`,
`styleFoldBluff`.

Fourteen more, with no shadow arm, offered `off` (and clear) only until each
earns its promotion evidence (see the next section): `v16Hu`,
`v16Ratio`, `v17RiverProbe`, `v23ShortDeck`, `v32FacingDefense`,
`v33DepthCeiling`, `v55OmahaRiverTripsFlat`, `commitUnderPot`,
`v62RiverBettorPolarity`, `readPostflopFoldRate`, `readShrinkResponse`,
`readBreakEvenBluff`, `readScopedShrink`, `omahaNeutralUnknown`.

## 'on' needs promotion evidence (HA-10878-1)

A fleet-wide `on` row for one of the fourteen is the same behaviour as turning
that option on by default, with no review between the row and the decision. So
the switch offers `on` only for an option whose evidence file
`docs/horse-default-on.d/<option>.md` exists: the same directory and naming rule
as `HorseDefaultOnNeedsEvidence.law.test.ts`, and the file must also name the
option (its title), its pull request, the scope it was measured for
(`Switch scope:` equal to the registry scope, `Variants:` and `Formats:`), the
head it was reviewed at (`Reviewed head:`) and the digest of the option's code
path (`Code digest:`). The code path is every runtime file under `server/src`
that reads the option, outside the switch registry itself; the digest covers
the option name and each file's path and exact content, so any change to that
path makes the evidence stale and the law fails until the file carries the new
digest, re-affirmed in the same pull request. A file that measured another scope
leaves the law failing, so the option cannot be enabled where its evidence does
not reach. **Today none of the fourteen has one, so none can be set `on`.**
`off` and clear stay available for every registered option.

The refusal is enforced at every boundary:

- Engine registry: `OPTION_SWITCH_EVIDENCED_ON` (empty) decides which options
  are registered with `on`; registering `on` without evidence throws at load.
- Engine parser: a configuration carrying `on` for an option without evidence is
  invalid, so every non-style option runs at its release default, on the first
  read of a new worker exactly as on later reads; a replay record carrying one
  is not a valid record.
- Database: `fn_ca_horse_option_switch_states` answers `{off}` for such an
  option, `fn_ca_horse_option_switch_set` raises on `on` before any write, and a
  table check (`ca_horse_style_switch_on_needs_evidence`) refuses an `on` row
  from any writer, the owner role included.
- Law: `everyUpgradeHasALiveSwitch.law.test.ts` fails when the evidenced list,
  the two migration lists and the evidence directory diverge, or when an
  evidence file does not bind (name, pull request, scope, variants, formats,
  reviewed head, current code digest).

The seven style options keep their own states and their shadow and canary
controls, unchanged. None of the seven has a file in `docs/horse-default-on.d/`.

## Never switchable here

Refused by name by the engine registry, by the database functions and by the
worker: the authority-gated options (the cash feature pack, `v53PloTourneyIcm`,
the Phase 8 guard), the phase packs, Pillar 2 and the deep-dive discipline it
lives in, the V31 solver store (R7/R8), held-out packs, All-In-Or-Fold
widening, blind steal, the two withdrawn PLO6 rules, and every option that
changes a preflop range while the owner's preflop range hold stands
(`v46ShortDeck`, `nashPushFoldIcm`, `huBbDefendsToPrice`,
`huOpenerDefendsToPrice`, `huLimpDefendsToPrice`, `facingOpenFullRingZone`,
`committedStackPricedIn`, `vs3BetShortStack`, `holdemPersonaReRaiseMix`).
Lifting a hold for one option is a source change to the registry and to the
migration whitelist, reviewed like any other.

## Failure and restart

The lifecycle rule (HA-10878-1): a started, restarted or replaced decision
worker resolves the persisted, authorised switch state before it serves a
decision that reads a switched option.

- Process start or restart: the decision lane is not handed out, so the dealer
  gate does not open, until the first database read has been posted to every
  worker or has failed. That read is bounded by its 10 second timeout; a failed
  first read leaves every worker exactly as an unreadable read leaves a running
  one.
- A replaced worker (one shard lost and replaced alone) is handed the last
  delivery its siblings hold as its first message, before any request. Its age
  is still measured from the database read, so what the siblings would refuse
  as stale or unreadable it refuses too.
- There is no separate reconnect: a database reconnect is simply the next read,
  and a worker keeps one message port for its life.

In every case the engine refuses on the first read exactly what it refuses
later (an un-evidenced `on`, a held option), so a restart never revives a row
the engine would not apply. The same rule carries the seven style options,
whose states and fail-safe are otherwise unchanged: a replaced worker no longer
runs them off for up to one delivery interval.

A worker delivered nothing (no reading yet, or the first read failed), a read
that fails twice in a row, an answer
that is not the documented shape, an answer naming an option the engine does
not know, and an answer older than 120 seconds all leave every one of the
fourteen options at its release default (not at its last value, and not forced
off). The seven style options keep their own rule: they read as off. A
malformed answer never stops a decision.

An engine that predates this change keeps working: it reads
`fn_ca_horse_style_switch_effective`, which keeps its shape and names only the
style options. An engine with this change on a database without the migration
falls back to that same function and switches nothing else.

## Replay

A decision made with any of the fourteen options switched journals the switched
set in its replay state (`horse-decision-replay-state-v5`). Replay restores the
set from the record and never reads the live switch. A decision with nothing
switched keeps the version it had (v3, or v4 with a style state), byte for byte.

## Proof

`scripts/ci/test-horse-option-switch-evidence-postgres.sh` (a step of the
required `accounting_postgres` job in `.github/workflows/ci.yml`, shard 7, where
the repository's other `scripts/ci/test-*-postgres` proofs run; the law fails if
it leaves that job) installs both switch migrations on a throwaway PostgreSQL 17
and proves by execution (295 assertions): the options offered `on` equal
the style options plus those with an evidence file; for each of the fourteen
the set function and the table refuse `on`, and the old style setter refuses
the name; `off` and clear work and each writes one audit row with its actor;
the refused options are refused by states, set and clear; the style options
still take shadow, canary, on and off; a style row written before the migration
survives it. Run against the migration as it was at 0260f14b, 60 of its
assertions fail; with only the states function offering `on`, 30 fail; with only
the table check removed, 29; with only the set function's evidence guard
removed, 15; with a held option whitelisted, 5.

`server/src/engine/horseDecision/everyUpgradeHasALiveSwitch.law.test.ts` (real
worker decisions, the migration whitelist against the registry, the refusals on
both sides, grants, audit, failure and replay) and
`server/src/engine/HorseOptionSwitch.test.ts` (registry, parser, holder);
the lifecycle rule in `server/src/engine/horseDecision/lane.test.ts` (start) and
`oneShardsLossIsOneShardsLoss.law.test.ts` (replacement).
`HorseUpgradeManifestRuntimeParity.law.test.ts` and the manifest digest test
are unchanged.

Limits: beside the PostgreSQL proof above, the database half is proven from the
migration source and by the migration's own read-back block, which raises at install if a held option
answers as switchable or a browser role holds a grant. An answer naming an
option an older engine does not know sets that engine's fourteen options back
to their release defaults until the engine is released, so a later addition to
the whitelist must ship in the engine before its row is set.

## Update, 2026-11-14 22:01 Chicago: the switch is registry-driven (no option enabled)

Owner order (retained as OWNER-MESSAGE-20261114-2201CT-EVERY-FEATURE-ON-WITH-SWITCH.md, sha256 2080c2026d5553e11ac288a74fcef51d20f81b30c0a9da446b5063a9f7196bf1): "YOU NEED TO MAKE SURE THAT EVERY SINGLE FUNCTION FEATURE, SKILL ETC ACROSS ALL GAMES TYPES, CASH AND TOURNAMENTS FOR ALL 9 CHATS IS FULLY ACTIVATED AND EVERY SINGLE ONE HAS AN ON OFF SWITCH BUILT AND ACTIVATED AT THE NEXT CUT OVER". This replaces what the sections above say about the evidence-file rule (HA-10878-1) and the preflop range hold for the switch only. The registry is now derived at module load from HORSE_DATA_LEDGER: every on/off ledger option is registered with off and on, a parameter is listed in OPTION_SWITCH_NOT_A_SWITCH, and the refused names (the held-out packs, the phase packs, Pillar 2, V31 and R7/R8, leak maps, the withdrawn rules) stay refused everywhere. An option under an owner hold (the preflop range hold) or measured harmful (commitUnderPot, RESULTS-HU-NLH-016) is registered and its hold or verdict is recorded on its entry (OPTION_SWITCH_HOLDS). The engine accepts on for any registered option; the database writes on for a non-style option only with a note that cites the authority ("authority: <file and sha256>"), at the set function and at the table, and the audit row keeps the note, the actor and the time. The migration (still not installed anywhere, edited in place, one transaction) adds no row, so this step enables nothing. The 21:30 ruling text stays in the evidence records, and nothing here is described as passing promotion evidence; the source-default law (HorseDefaultOnNeedsEvidence) is untouched. The migration's name lists are written by `npx tsx scripts/gen-horse-option-switch-sql.ts` in server/.
