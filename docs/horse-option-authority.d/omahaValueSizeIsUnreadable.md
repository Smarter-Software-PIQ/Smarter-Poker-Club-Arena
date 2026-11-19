# omahaValueSizeIsUnreadable: authority for the live switch

WooWoo audit programme, lane NUT-SIZE (2026-11-19). Default OFF in source (read `=== true`). Evidence: mechanism, scope, receipts, tests and off-identity in this file; the declared replay evaluation and its result are in the audit archive (`repairs/NUT-SIZE/EVAL-DECLARATION.md`, `EVAL-RESULTS.md`).

## The owner's order it rests on (verbatim)

- 2026-11-18 23:00 America/Chicago: "HORSES NEED TO VARY THERE BETS WITH THE NUTS, NOT FULL PUT EVERY TIME, BUT LIKE 80-95% POT, HE'S FOLDING TO FULL POT SIZE BETS CAUSE HE SAID WHEN THEY DO THAT, THEY 100% ALWAYS HAVE THE NUTS!"
- Standing rule (2026-11-17): no blanket rules; every decision from ranges, equity, price and EV; constants cite a measurement.

## What was measured (audit archive `repairs/NUT-SIZE/MEASUREMENT.md`)

PLO4/PLO5 cash (table and fast-table cash), one board, no bomb pot, a person seated, 2026-11-05 to 2026-11-19: 9,664 hands, 11,741 Horse postflop bets and raises, Horse cards known for all. Size is the share of the pot-limit increment.

| size of the Horse wager | n     | exact nuts | nuts or near-nuts |
| ----------------------- | ----- | ---------- | ----------------- |
| under 50%               | 5,200 | 6.5%       | 38.7%             |
| 50-70%                  | 2,054 | 18.9%      | 57.1%             |
| 70-80%                  | 1,116 | 13.6%      | 40.9%             |
| 80-95%                  | 2,091 | 11.9%      | 41.7%             |
| 95-100% (the full pot)  | 1,280 | 55.0%      | 85.3%             |

River: the full pot 57.5% exact nuts (n 626) against 2.2% at 80-95% (n 319); 360 of 440 river nut wagers were the full pot. "Always the nuts" is false as stated (about one full-pot wager in seven is neither nuts nor near-nuts) but the full pot is a strong tell. The human WooWoo folded to 65.0% of Horse full-pot wagers (292/449) against 55.9% at 80-95% (328/587); heads-up against Horse nuts or near-nuts 63.7% (174/273) against 47.9% (46/96).

Where the full pot comes from (all on main): omahaNutClassValueSize (HorseOmahaMadeHandDefense.ts, on by release default) sizes every nut-class bet or raise to the pot-limit maximum; riverNutsRaise and fullPotNearPotWager (HorseRiverNuts.ts) do the same for the exact river nuts and round every 90-100% wager up to the full pot, in wager_rules and again at commit (ServerTableEngineTurns.ts); omahaCurrentNutsRaise raises the current nuts to the pot.

## What it does

PLO4/PLO5 cash (table and fast-table cash; never a tournament), pot limit, high only, one board, no bomb pot, not All-In-Or-Fold, flop, turn and river (HorseOmahaValueSizeBand.ts, the last step of the wager_rules node). A bet or raise that is already the full pot (95% of the pot-limit increment or more) with a nut-class hand (omahaNutClassNow, or the exact river nuts), when the pot-limit maximum is not the seat's whole stack:

- stays the full pot with the street's measured keep share: flop 0.094, turn 0.509, river 0.469. Each is the share that makes the nut share of the full pot equal to the nut share of the 80-95% band once the rest move there (flop 16.1%, turn 32.0%, river 38.8%), so neither size tells more than the other;
- otherwise is sized to a uniform share of the pot increment in the owner's band [0.80, 0.95].

Every other wager is unchanged, the full-pot wagers of hands that are not nut class included, so the full pot is no longer nut-only. Checks, calls, folds and all-ins are never touched; a wager is never made larger; the size never goes above the pot-limit maximum, under the legal minimum (a minimum above the band leaves the wager as it is) or to the whole stack. The two draws come from the decision's derived stream (omahaSlowplayUnit, own salts; read, never advanced), so no other rule's draw moves.

The sized wager carries `valueSize: 'unreadable_band'`. At commit the table keeps it while it is still legal and in the band on the fresh menu (omahaValueSizeBandHolds) instead of rounding it back up with riverNutsRaise / fullPotNearPotWager; the river value alarm (HorseRiverValueAudit.ts) excuses exactly an accepted band wager the table registered. With the option off nothing is marked or registered.

## One owner, in order

omahaNutClassValueSize, riverNutsRaise, omahaCurrentNutsRaise and fullPotNearPotWager decide bet or check and make the full pot; omahaSmallBetIsPriced never makes a nut-class bet smaller and runs earlier; omahaBetSizeByPublicState keeps a nut-class size when omahaNutClassValueSize is on; this option runs after all of them and only decides how much of the full pot. It does not fight omahaNutClassValueSize: with that option off a nut wager below the full pot is simply out of this cell.

## Receipts

`omaha_value_size_band_applied`, `omaha_value_size_full_pot_kept` (valid no-change) (HorseDataLedger.ts).

## Tests

server/src/engine/HorseOmahaValueSizeBand.test.ts: on the recorded complaint nodes (hands 59414191 and 59401453) a nut bet is the full pot or 80-95% of it, both occur, never anything else, on the flop, turn and river; off (unset, false, a truthy non-boolean) identical draw for draw with every nut bet the full pot; a hand that is not nut class keeps its size; PLO6 and tournaments unchanged; legal bounds (maximum, minimum, a stack the pot covers, raise increments); the commit guard; the river value alarm.

## Evaluation (declared before the run; the verdict stands as recorded)

Declaration: audit archive `repairs/NUT-SIZE/EVAL-DECLARATION.md` (sha256 9c5e7188defa65c28d49a2d9db7885ad7e7fed054328de3bd019f83c1b3c134a). Results: `repairs/NUT-SIZE/EVAL-RESULTS.md`. Replay of the 5,344 journaled decisions of journal-4 (PLO4/PLO5 cash, 2026-11-18 19:31Z to 2026-11-19 01:18Z) through the production worker runtime, arms BASE (origin/main), OFF and ON. Declared verdict: FAIL / INSUFFICIENT.

- B1 off-arm byte-identical: FAIL as declared. Action and amount with the option off equal main's on 5,240 of 5,240 compared decisions (100%). Instrument note: think time and receipt digest are not reproducible by the replay itself (main replayed twice: 4 of 1,500 equal), so that part of the bar cannot pass on any code; 4 PLO4 decisions error `phase10:identity_authorityKey` on this build only, because the Phase 10 policy digest hashes the bytes of HorseLogic.ts (any HorseLogic.ts change does this; not a decision difference).
- B2 sizes in band: FAIL as declared. 23 of 23 changed decisions are PLO5 postflop nut-class full-pot bets resized to 0.802-0.946 of the pot increment, marked `unreadable_band`, nothing else changed; the declared receipt clause was unobservable because the replayed production requests run with telemetry off (no receipt of any option fired in any arm).
- B3 zero illegal amounts: PASS (0 illegal actions or amounts, 0 new errors).
- B4 value against measured calling: INSUFFICIENT. WooWoo: +0.093 pot per nut wager at the band, 95% CI -0.011 to +0.198 (folds 47.9% at 80-95% n 96 vs 63.7% at the full pot n 273, Horse nuts or near-nuts, heads-up; 1.456 vs 1.363 pot units). All persons pooled: +0.040, CI -0.025 to +0.104.
- Nut-class share by size on journal-4: off, 80-95% 14.3% and full pot 59.0%; on, 39.2% and 43.3%.

## Switch-on

Switch-on: authorized on the owner's direct order of 2026-11-18 23:00 America/Chicago, verbatim: "HORSES NEED TO VARY THERE BETS WITH THE NUTS, NOT FULL PUT EVERY TIME, BUT LIKE 80-95% POT, HE'S FOLDING TO FULL POT SIZE BETS CAUSE HE SAID WHEN THEY DO THAT, THEY 100% ALWAYS HAVE THE NUTS!" Activation delegated to the WooWoo programme lane (owner 2026-11-18: "YOU OWN THE CODEBASE, YOU DECIDE WHAT TURNS ON AND IF ITS READY", relayed by the integrator, session 013U37bYh22). Integrator decision 2026-11-19: the declared verdict stays FAIL / INSUFFICIENT on the record; the switch-on rests on the owner's order, the safety bars that hold (off-arm action and amount identical 5,240 / 5,240; B3 PASS; 23 / 23 changes in band) and the measured direction (WooWoo folds more to the full pot than to 80-95% with Horse nuts or near-nuts).

## Limits

The fold rates by size were measured while the full pot was readable; what an unreadable size earns against a player who folds to it by read cannot be measured before it is live. The keep shares come from 14 days of today's policy and would move if other sizing options change the mix. The nut-class test is the engine's own (omahaNutClassNow); near-nut hands outside it are not resized.

## What the activation row must contain

`option = 'omahaValueSizeIsUnreadable'`, `state = 'on'`, note `authority: omahaValueSizeIsUnreadable docs/horse-option-authority.d/omahaValueSizeIsUnreadable.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` (service role, audited actor), after the follow-up option-switch migration that registers the name is installed and a build carrying the option serves. Rollback: the same function with `off`.
