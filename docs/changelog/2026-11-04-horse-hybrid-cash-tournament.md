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
