# Game-specific Horse Hybrid v1

Owner direction, November 4, 2026: create the hybrid first, with Grinder for
cash and Tricky for tournaments. Hold'em, PLO and decision-readiness handoffs
are the next phase. A winning historical result is not a guarantee of future profit.

The live table snapshot and Lightning snapshot now resolve a maintained
mode-specific profile in `HorseHybridProfile.ts`. Every existing and newly
created horse receives the same cash or tournament starting settings:

| Mode                      | Style   | Starting profile | Tightness | Aggression | Bluff multiplier | Sizing multiplier |
| ------------------------- | ------- | ---------------- | --------- | ---------- | ---------------- | ----------------- |
| Cash, including Lightning | Grinder | Pebbles          | 0.98      | 1.18       | 0.91             | 0.94              |
| Tournament                | Tricky  | Flint            | 1.02      | 1.04       | 1.055            | 0.94              |

These multiply the existing style parameters, not probabilities or VPIP
targets. A source-owned `referenceNlhOpenings` setting separately keeps the
maintained NLH opening ranges in both modes. Otherwise Grinder's 1.12 base
times Pebbles' 0.98 would silently tighten those calibrated ranges to a
1.0976 multiplier; the regression reproduces 12.18% six-handed and 8.67%
nine-handed cash UTG RFI before this correction. The opening multiplier also
feeds the V73/V75 opener continuation width, so defense reflects the range
actually opened. Table VPIP floors, variant adjustments, ante/position
targets, short-stack ownership, ICM premiums and other donor decision
thresholds remain intact. No range constants or statistics producers are
replaced.

Pebbles was positive before attributed rake/BBJ in both earlier and
recent windows, with 96,460 cash hands and the largest cumulative adjusted
cash total among the researched candidates. Flint supplied the requested
Tricky starting profile; its positive tournament result is concentrated in
one day and does not establish a stable tournament edge. Reedlockhart is a
cash comparison candidate, not a tournament donor. This change implements
the owner's chosen starting assignment; it does not claim causal validation
of a new strategy pack or transplant one horse's outcomes into another.

The four legacy shared tuning dials no longer influence live hybrid
decisions. Keeping them active would allow a cash-only tuning proposal to
change tournament behavior as well. Historical profiles are preserved;
authored persona and diagnostic counts are parsed through the existing
bounded reader. Neither donor history nor private opponent information is
copied. The common brain, variant policy authorities, payout/ICM logic,
privacy checks, legal-action validation and turn-clock behavior remain the
action owners.

The worker counts `hybrid_v1_cash_grinder_decided` or
`hybrid_v1_tournament_tricky_decided` only after a non-fallback brain decision
ran with all four exact mode dials and the reference-opening setting. These are execution receipts, not
profitability or accepted-action claims. Live verification also requires the
served source identity and accepted natural horse actions. Historical reports
must retain their original style attribution; after this release, grouping
new play by the legacy `horse_profile.style` alone is no longer a valid
description of the effective gameplay style.

Regression coverage exercises every legacy style, absent/malformed profiles,
mode isolation, persona preservation, immutable source defaults, both real
table scheduler routes, Lightning's actual hand path, real worker/brain
execution, and absence of a receipt when a decision throws. The existing
Horse Data Ledger registers the new execution receipts.

Deployment and live proof are recorded in the owning task checkpoint;
source and local tests alone do not establish activation.

## Cash opening, isolation and 3-bet sizing

The owner also requires realistic cash sizes and one extra BB per limper.
The protected V74 opening source already draws 2.5-4BB before limpers; that
module is absent from the serving `eed06fe5` source. Its activation is part
of this delivery. The limper increment is added after the profile dial bends
the base draw, so each limper contributes a full BB (one live straddle unit
in a straddled pot). It is not discounted by the Grinder/Pebbles multiplier.
New regression coverage checks each increment on both chip grids and the
final hybrid decision with zero through three limpers at six- and nine-handed
tables. Stack limits and game-specific legal caps still apply.

The legacy cash 3-bet path multiplied the whole raise by the style and donor
sizing dials. With the hybrid it turned a 3BB open into 7.69296BB IP or
9.67824BB OOP in the regression, and a 2BB open into 5.12864BB IP. Those three
regressions failed before the source repair. Cash NLH now selects a common
card-blind size for value, bluff and squeeze raises: 3-3.5x IP or 4-4.5x OOP
at ordinary depth, with 8BB/10BB floors against small opens. Each cold caller
adds one opening raise. At 40BB or less the bands are 2.7-3.1x / 3.2-3.8x;
above 150BB they add half an opening raise. The legalizer still owns minimum
raises, stack caps and committing-bluff restrictions. Cash 3-bet sizing
ignores profile size dials; other street/game sizing retains its owner.

Position is measured against the opener and callers using public seat order,
including middle versus early position and the different heads-up blind order.
The premium passive-action correction uses the same cash sizer. Tournament,
PLO/pot-limit, fixed-limit and short-deck sizing remain separate. The existing
ledger registers `cash_nlh_three_bet_size` as an execution receipt; final
accepted production wagers must also be verified.

The October 16 opponent-exploit neutrality corpus isolates this later cash
sizing policy by omitting only its sizing context in the test's real preflop
call. The original corpus, opponent reads, RNG comparisons and coverage floor
are unchanged. The current sizing runs through the real brain and accepted
HandController actions in its dedicated regressions; production has no opt-out.

The one-BB-per-limper increment is a standard cash isolation baseline, not a
universal GTO result. Jonathan Little describes it for live and online cash
in [PokerCoaching's limping guide](https://pokercoaching.com/blog/limping-in-poker/).
[GTO Wizard's custom tree documentation](https://help.gtowizard.com/how-to-build-custom-solutions/)
allows position-specific isolation and squeeze increments; its presets are
starting heuristics, not fully optimized solutions. The cash 3-bet baseline
also accounts for the small-open caveat discussed in
[Upswing's preflop sizing lesson](https://upswingpoker.com/podcast/ep29-pfr-sizing/).
These sources support the design rationale, not a claim that this exact
fleet policy has solved or proven positive EV. VPIP/RFI and profitability
remain distinct measurements, separated by game, seats, position and depth.
