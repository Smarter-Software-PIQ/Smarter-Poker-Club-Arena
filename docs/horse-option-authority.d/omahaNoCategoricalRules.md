# omahaNoCategoricalRules: authority for the live switch

**State: OFF in source (read `=== true`), no switch row, Evidence NOT MET (unevaluated). Pair with omahaMathCore.** Mechanism, scope, law tests and off-identity only.

Owner order it rests on, 2026-11-19 8:37 PM America/Chicago (verbatim): "You said you removed any and all laws or rules that force a Horse to do something, yet they are still here! Every decision needs to be made independently on each and every hand. No law or rule should ever prevent the correct decision from happening." Owner 8:27 PM: "DON'T TOUCH PLO6". Built by lane UNBLOCK on #11401 (b83b44ffa7d).

## What it does

In a PLO4 or PLO5 cash decision (table or Lightning, one board, no hi-lo, no bomb pot; `HorseOmahaNoCategoricalRules.omahaNoCategoricalRulesInScope`), `HorseLogic.decide` runs with every option in `OMAHA_NO_CATEGORICAL_RULES_OFF` set false (each one's off path is "the rule does not run"): the rules `HorseOmahaRuleSites` classes categorical or open (the hidden default-on `omahaRiverNutRaiseOnly`, `ploPairedBoardFold`, `ploPairedBoardRiverCheck` among them), `v74OmahaSemiBluffNeedsDraw`, `v81OmahaBigBetCalls`, `v84OmahaRiverReraiseCalls`, the preflop class gates, the label reads, the slowplay and priced-mix random draws, the street-plan priors and `v9Mood`; and the V81 / V84 / V86 / V87 big-bet call cells (`omahaBigBetCallFoldCells`) stand aside. With `omahaMathCore` on, nothing categorical decides before the core answers or when the core falls back on an error.

Not covered (no option of its own that leaves the rest of the brain unchanged; superseded by the core when it applies): the V15 / V40 classifier caps inside the reference brain, the preflop charts and percentile bars (v46Charts, HorsePreflop BAR_CAP), the persona mods, the Omaha pack's heads_up_position_stab prior.

Off (absent or false): byte-identical. PLO6, PLO8, hold'em and tournaments: byte-identical with it on.

## Tests

`server/src/engine/HorseOmahaNoCategoricalRules.law.test.ts`: on the HorseOmahaNoBlanketRule corpus (built spots, the paired-board spots against a labelled value leader, 56 recorded Horse decisions) categorical receipts fire with it off and none with it on in PLO5 and PLO4; PLO6 byte-identical on and off; false and unset byte-identical.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; lane UNBLOCK's exact-replay measurements of the switchable parts are in repairs/EMERG/UNBLOCK.md)
