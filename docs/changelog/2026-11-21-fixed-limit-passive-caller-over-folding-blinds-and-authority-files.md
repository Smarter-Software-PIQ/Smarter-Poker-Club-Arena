# Fixed limit: a passive caller, over-folding blinds, and an authority file for every off option

Antigravity Coordinator lane, 2026-11-21. Follows #11565 (the scripted fixed-limit league field) and #11567 (the call-commitment harm lock). Measurement and records only: no option changes its default or its off-only status, no switch row is proposed, no migration.

## What changed

- `server/src/benchmark/FixedLimitScriptedField.ts`: two scripts.
  - `flh_passive_caller_v1`: the calling station of `ExploiterLeague.ts` (calls wide preflop, never folds after the flop, bets only strong hands). Its preflop bars are the recorded ones; its two postflop made-class bars (bet two pair or better, raise a full house or better) are labelled design values, because the recorded policy uses a Monte Carlo equity and a script may consume no randomness.
  - `flh_over_folding_blinds_v1`: never raises, enters and defends on the tight-value bars (a six-max blind folds to one raise 82% of the time) and folds to every postflop wager. The fold-everything postflop and the call-instead-of-raise preflop are labelled design values.
- `HorseLeagueHumanField.ts`, `HorseLeague.ts`: the two personas; two cards in `FIXED_LIMIT_SCRIPTED_FIELD_CARDS` (`flh_river_one_bet_value_raise_vs_passive_caller`, `flh_steal_vs_tight_blinds_vs_over_folding_blinds`); the refusal reasons of `flh_river_strong_hand_leads` and `flh_steal_vs_tight_blinds` record what was measured (both stay refused as Horse-mirror arms).
- `HorseLeagueFixedLimitField.test.ts`: both scripts replay through a real `HandController` (heads-up and six seats), are deterministic, and their cards are pinned.
- `docs/horse-option-authority.d/`: a file for each fixed-limit option that is off in source (ten files). Every one states Evidence NOT MET, or its harm or hold status, with the measured league figures and the exact missing piece. `fixedLimitBetsAreNeverProbes` is on by source default and keeps its record in `docs/horse-default-on.d/`.
- `docs/horse-league-fixed-limit.md`: the personas, the results, a finding about the over-folder read, and what is still owed.

## Results

Seeds 20261120 and 20261121, `npx tsx src/scripts/horseLeagueCard.ts` from server/, working tree of this pull request on base 5bfaa38d0, empty solver stores. bb/100 is the option on minus off, in big blinds. Every run: 0 illegal actions, 0 truncated streets, 0 corrected actions, 0 brain exception fallbacks. Sizes were fixed before the runs from development probes at seed 20261115 (reported in the league doc, not pooled). No sample was enlarged after a result.

| Card | Pairs per seed | Seed 20261120 | Seed 20261121 | Seeds together |
| --- | --- | --- | --- | --- |
| `flh_river_one_bet_value_raise_vs_passive_caller` (heads-up) | 45,000 | +0.04 +/- 0.05, z 0.78, 60 diverged | +0.11 +/- 0.04, z 2.83, 60 diverged | +0.07 +/- 0.03, z 2.41, SIGNIFICANT (marginal) |
| `flh_steal_vs_tight_blinds_vs_over_folding_blinds` (6 seats) | 10,000 | +7.00 +/- 0.39, z 17.93, 388 diverged | +6.68 +/- 0.39, z 16.98, 353 diverged | +6.84 +/- 0.28, z 24.68, SIGNIFICANT |
| `flh_river_strong_hand_leads_vs_passive_caller` (heads-up; not kept on the card) | 20,000 | -0.01 +/- 0.01, 1 diverged | 0 diverged, INERT | not resolved, inert |

## What each result means

- `fixedLimitRiverOneBetValueRaise`: three ranges are measured in aggregate, none negative. Evidence NOT MET: the per-node table and a replay on audited fixed-limit decisions against people do not exist.
- `fixedLimitStealVsTightBlinds`: positive against its single most favourable range, no harm control. It stays off-only under the owner hold on steal options; nothing here lifts it.
- `fixedLimitRiverStrongHandLeads`: a passive caller does not move it. The card used to measure that is not on the nightly list; the arm stays refused with the figures in its reason.
- A finding for the Fixed-Limit lane: a first form of the over-folding script with mixed frequencies never engaged the steal (0 of 10,000 pairs). Read from the code: `HorseOpponentExploit.styleShiftReleased` ages the fold read at the fast rate whenever a fast-window rate differs from the long one by 0.2, which a mixed frequency trips by chance, so the 15 decayed opportunities the option needs were not held. The option's reach against people is therefore not known. Nothing in the engine was changed.

## Still owed

- The per-node table of changed decisions (Value row) for every scripted card.
- Harm controls for the steal.
- An audited fixed-limit-versus-people decision set, without which no fixed-limit option can carry a Replay row.
- The re-run of the other recorded mirror configurations after the 2026-11-20 memory fix (Hybrid at 2,000 pairs, production personas at 600): not done here.
