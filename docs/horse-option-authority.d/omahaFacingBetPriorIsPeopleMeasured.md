# omahaFacingBetPriorIsPeopleMeasured: Authority For The Live Switch

Built 2026-11-26 by PLO-OWNER lead-7 (session 01TLQer8) from the daily audit root cause (plo-lead7-01TLQer8/audit-rootcause/REPORT.md section B) and the PLO5 deep dive (plo-lead7-01TLQer8/woowoo/REPORT.md gap 1). Evidence NOT MET: the option is registered, default off (read `=== true`), and has replay counts, a league mirror and scripted-opponent probes only (tables below); the scored replay on audited decisions was not run. This file does not authorize switching the option on.

## What It Does

PLO4/PLO5 cash (tables and Lightning), turn and river, heads-up, a first bet (not a raise), inside `omahaFacingBetEv` (it acts only where that verdict decides; `HorseLogic.omahaFacingBetEvCount` -> `HorseOmahaEquilibriumAnchor.ts`).

Today's verdict prices the bettor as a value region plus a non-value share q taken from `OMAHA_EV_PRIOR_BLUFF`, a constant measured on a field (turn 0.22 and river 0.19 at 0.7 pot and over), then moved by public reads measured against the Horse mean. With the option on, q is the balanced share for the price and nothing else:

- river, or a turn call after which no river bet can follow: b = call / (pot after the deduction + call), which is bet / (pot + 2 bet) before the deduction (0.25 at half pot, 0.333 at pot);
- a turn bet with a river bet to come: 1 - (1 - b)^2, the share of a bettor balanced on both streets (0.44 at half pot, 0.556 at pot);
- his own shown bets of this street, size and line (`HorseOmahaBetRead` per-opponent cell: shown, and how many were value) move it and nothing else does: q = (8 x anchor + shown weak) / (8 + shown). Shown value 8 times of 8 halves it; 40 of 40 leaves a sixth.

No constant is fitted. The field prior, the bet-when-checked-to ratio against the Horse mean, and the value-leader and maniac labels do not act while the option is on. The hand side is unchanged: the same exact count of the Horse's share against the value region and the rest, the same realization, caps and 2% margin, so the order of defence is the verdict's own: hands with a share against his value (draws to the nuts on the turn, made hands inside his value region, holdings whose cards remove his strongest hands) first. On the river a hand with no win or tie against his value region never calls on the anchor (law test). Receipts `omaha_people_prior_priced`, `omaha_people_prior_record_read`, `omaha_people_prior_changed`.

Untouched: a raise (no per-opponent record of shown raises exists to move an anchored raise price; the owner rule keeps Horse raises nut class), every multiway spot (the defence there is shared: byte-identical), the flop, PLO6, tournaments, hi-lo, bomb pots, hold'em and every other game. No input reads whether an opponent is a person or a Horse, a user id beyond the record lookup every bettor gets, or a name; no unshown card is read. Scopable per game (`horse.omahaGameScope.<option>`); staged for shadow re-decision on the turn and river.

It does not raise: the non-nut rule for turn and river raises and the out-of-position 3-bet / 4-bet call rules are not on this path.

## What Was Measured

All in `plo-lead7-01TLQer8/plo-defence/BUILD.md` (harness in `plo-defence/src`).

GRADES_PLACEHOLDER

## Prior anchor

- Baseline: the balanced non-value share for the price: bet / (pot + 2 bet) on the river (the share at which a hand that beats all of his non-value hands and none of his value hands breaks even), and 1 - (1 - b)^2 on a turn bet with a river bet to come.
- Population weight: none. No measured population rate enters: `OMAHA_EV_PRIOR_BLUFF` and the public reads against the Horse mean do not act while the option is on (the field is on the exploitable side of the baseline: it bets big almost only for value, 1 bluff among 148 shown bettors in the audited cell).
- Own record: only the bettor's own shown bets of the street, size and line move the share, as a Beta-binomial mean with 8 prior bets at the anchor (`OMAHA_EQUILIBRIUM_ANCHOR_PRIOR_BETS`), from the first shown bet; it dominates as his sample grows.
- No unshown cards: nothing is fitted. At decision time the option reads the public table state, the deciding Horse's own cards and the bettor's record of hands shown at showdown (`HorseOmahaBetRead`: a player the showdown lists as mucked never counts).

## Replay

- Replay: NOT RUN (2026-11-26: the scored replay on audited decisions with server/scripts/audited-decision-replay.ts was not run; what exists is an unjudged fold-rate replay of 790 PLO4 and 2,254 PLO5 recorded decisions on public state and the deciding Horse's own cards, in plo-lead7-01TLQer8/plo-defence/BUILD.md, and six real audited decisions in anOmahaFacingBetPriorIsPeopleMeasured.law.test.ts)
