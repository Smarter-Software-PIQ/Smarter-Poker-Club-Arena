# 2026-11-12: partial: the Hold'em persona reaches two V87 preflop limp mixes

This is a PARTIAL wiring correction. It is not the persona overhaul and it
does not complete the persona requirement of the approved Hold'em plan. It
connects two persona fields that nothing read to two V87 preflop limp mixes
that already existed (the early-position premium trap and the
suited-connector limp-reraise bluff) and makes those two draws differ per
Horse. A third mix, the early suited-connector open-limp, was wired, measured
outside its approved frequency in play, and WITHHELD: it ships exactly as
before. Not delivered by this change:

- distinct per-archetype cash VPIP bands. Every archetype still measures
  about 28.4 to 28.5% VPIP, and wiring existing persona outputs cannot change
  that;
- persona-specific ordinary 3-bets, squeezes and reshoves.

## Where the persona requirements stand

| #   | Requirement                                        | Status after this change                                                                                                                                                                                               |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Per-archetype cash VPIP bands (plan line 152)      | Still missing. Needs per-archetype range width, a strategy change. Owner decision 2026-11-11: Hybrid's calibrated ranges are preserved in production for now; the requirement is NOT withdrawn; offline research only. |
| 2   | 3-bets seeded per hand plus persona (plan line 85) | Unresolved. Identity now seeds two V87 limp mixes only (premium trap, limp-reraise bluff). Ordinary 3-bet and squeeze bluffs remain PRNG rolls shared with Omaha.                                                      |
| 3   | `nlh3BetMix`                                       | Partially consumed: the suited-connector limp-reraise bluff only.                                                                                                                                                      |
| 4   | `epLimpTrapMix`                                    | Delivered for the premium trap only. The suited-connector open-limp scaling is withheld (historical, unverified measurement 19.27%, interval 18.79 to 19.75, against the approved 20%).                                |
| 5   | Tricky limp-reraise behaviour                      | Delivered in part: the premium trap rate and the limp-reraise bluff rate follow the persona. The suited-connector limp that feeds the bluff does not.                                                                  |
| 6   | Squeeze by persona                                 | Still missing.                                                                                                                                                                                                         |
| 7   | Reshove by persona                                 | Still missing.                                                                                                                                                                                                         |
| 8   | Nit Hunter's described behaviour                   | Still missing.                                                                                                                                                                                                         |

## The gap this touches

`HorseHoldemPersona` (server/src/engine/HorsePersona.ts) has two preflop
fields: `epLimpTrapMix` (early-position open-limp trap and suited-connector
limp rate) and `nlh3BetMix`, documented as the frequency of 3-bets, squeezes
and shallow 4-bet reshoves. Neither had a reader outside tests. The V87
preflop mix seed hashed seat, dealer, stack, pot and table size and nothing
about the Horse, so every Horse in the same public state made the same draw
at the same fixed probability.

## What changed

1. `HorsePersona.ts` keeps the archetype split and the base and span of the
   two preflop fields in one table, `HOLDEM_ARCHETYPE_PREFLOP_MIX`.
   `holdemPersonaFor` reads the table and returns the same persona as before
   (a test checks 1,000 synthetic ids against the old literals).
2. Two constants are computed from that table and exported:
   `HOLDEM_HASH_MODEL_MEAN_EP_LIMP_TRAP_MIX` (0.176463) and
   `HOLDEM_HASH_MODEL_MEAN_NLH_3BET_MIX` (0.42143). Each is the expected value
   of its field under the id-hash model: the 25/20/40/15 split and 1,000
   equally likely hash buckets, with the persona's two-decimal rounding.
3. `holdemPreflopPersonaMix(horseId)` returns the two fields divided by those
   constants, and an identity seed hashed from the Horse id. Each scale has
   expectation 1 under the id-hash model with equal opportunities. On a real,
   finite set of ids the mean is near 1, not 1: on the 1,000 synthetic test
   ids it is 0.98735 for the limp scale and 1.00332 for the 3-bet scale. The
   real Horse ids were not read by anyone.
4. `HorseLogic.ts` puts that on the preflop context for V87-on two-card
   no-limit hold'em with a non-empty id.
5. `HorsePreflop.ts` uses it in two V87 hash-threshold mixes:
   - early-position premium trap (QQ, KK, AA open-limp): 3/18 times the
     Horse's limp scale, 9.4% to 26.4%;
   - suited-connector limp-reraise bluff against an iso-raise: 22% times the
     Horse's 3-bet scale, 11.5% to 33.4%.
     Each is clamped to the range 0 to 1 (the clamp never binds). For these two
     mixes the identity seed is folded into the mix seed, so two Horses in the
     same public state no longer make the same draw. It is still a pure hash:
     no random draw is consumed, and one Horse in one state always gives the
     same answer.
6. The early suited-connector open-limp is unchanged: fixed 20% on the
   public-state seed. See "Opportunity-weighted rates in play" for why.

## The single reader of `nlh3BetMix`

`nlh3BetMix` is documented for 3-bets, squeezes and shallow reshoves. Only
the suited-connector limp-reraise bluff reads it. That bluff is the only V87
mix that is both a 3-bet and decided by a hash threshold. Every other V87
3-bet, squeeze or shallow reshove is fixed range membership, and the ordinary
3-bet and squeeze bluffs are older random rolls that the owner lane ruled stay
exactly as they are. So the field controls far less than its description
says.

## What did not change

- Every eligibility guard, legality guard and anti-pattern control around
  the mixes. Only the probability on the right-hand side of two comparisons
  changed.
- The suited-connector open-limp, opening ranges and widths, value 3-bet
  ranges, the tournament 16 to 26 big blind reshove sets, the 26 to 35 big
  blind 4-bet shove sets, and the ordinary 3-bet and squeeze bluff rolls.
- Pot-limit Omaha, pot-limit hold'em, short deck, fixed limit and every
  other game. With V87 off, or with no Horse identity on the context, every
  decision is exactly what it was; tests pin that against decisions recorded
  on the base source.
- No VPIP clamp, no target steering, no new feature flag.

## What is not guaranteed about the approved frequencies

The scales have expectation 1 only under the id-hash model, with every Horse
meeting the same eligible spots with the same hands. That is a statement
about a model, not about play. In play:

- a finite id set does not average to exactly 1 (above);
- archetypes can meet eligible spots at different rates: the top-up rotator
  and the postflop persona both move stack depths by archetype, and the mixes
  need depth;
- the limp-reraise bluff is reached only after a limp.

So the opportunity-weighted rate in play is NOT guaranteed by the design. It
was measured, once, in the synthetic setting below, and that measurement is
the only basis for what ships.

Consequence for one Horse: its limp-reraise range is value (the premium
pairs it limped) and bluffs (the connectors it limped and then re-raised).
Its premium limps scale by its limp scale and its bluffs by its 3-bet scale,
so the bluff-to-value ratio of one Horse moves by (3-bet scale / limp scale):
from about 0.45 times the approved balance (a Tricky Trap with the lowest
3-bet value 0.30 and the highest limp value 0.28: 0.712 / 1.587) to about
1.91 times (a LAG Shark with 0.64 and 0.14: 1.519 / 0.793). Had the
connector limp also been scaled, the limp scales would cancel and the range
would be the 3-bet scale alone, 0.22 / 0.42143 = 0.52 to 0.64 / 0.42143 =
1.52 times. Either way the approved balance can hold
for the fleet in aggregate, never for a single Horse an opponent can
identify.

## Opportunity-weighted rates in play (synthetic measurement)

900 synthetic ids with real personas in exactly 25/20/40/15: from the ids
`00000000-0000-4000-8000-%012d`, i = 0 to 999, the first 225 LAG Shark, 180
Tricky Trap, 360 TAG Crusher and 135 Nit Hunter by index. Dealt into 100
nine-seat tables, every table played in all nine seat rotations, 700 hands
per rotation: 630,000 hands, preflop only, 100 big blinds, Horses against
Horses. "Eligible" means the decision reached the mix comparison. Intervals
are 95% Wilson intervals and treat opportunities as independent, which they
are not quite. Reading rule: a mix is COMPATIBLE with its approved value when
that value lies inside the pooled 95% interval, and does not ship scaled
otherwise. Compatible means the measurement cannot tell the rate apart from
the approved value; it is not proof that the rate is preserved or equivalent.
The plan states no tolerance and none is introduced. This rule was written
down after the first measurement below had been read, and before the shipped
measurement was rerun.

Provenance. The first two runs below (historical) were made with an earlier
version of the measuring tool that was not kept, so they cannot be
reproduced exactly and are HISTORICAL, UNVERIFIED measurements. The shipped
configuration was then rerun once per source with the final, retained tool,
under a declaration written before the rerun; that rerun is the evidence for
what ships (see "Rerun with the retained tool" below).

First measurement (historical, unverified), all three mixes scaled:

| Mix (approved)           | Source | Eligible | Taken | Rate    | 95% interval     | Compatible?  |
| ------------------------ | ------ | -------- | ----- | ------- | ---------------- | ------------ |
| Premium trap (16.667%)   | Base   | 19,864   | 3,293 | 16.578% | 16.067 to 17.101 | yes          |
| Premium trap (16.667%)   | Branch | 19,847   | 3,295 | 16.602% | 16.091 to 17.126 | yes          |
| Connector limp (20%)     | Base   | 25,561   | 5,076 | 19.858% | 19.374 to 20.352 | yes          |
| Connector limp (20%)     | Branch | 25,565   | 4,925 | 19.265% | 18.786 to 19.753 | NO: withheld |
| Limp-reraise bluff (22%) | Base   | 3,511    | 860   | 24.494% | 23.100 to 25.944 | NO (base)    |
| Limp-reraise bluff (22%) | Branch | 3,432    | 783   | 22.815% | 21.442 to 24.249 | yes          |

"Base" is the same source with the persona kept out of preflop; a run of the
untouched base source gave identical decision and taken counts. Note the base
limp-reraise bluff already sits outside its approved 22%; that is not caused
by this change and nothing was done about it.

The connector limp was then reverted to its base behaviour and the branch
measured again (historical, unverified):

| Mix (approved)           | Eligible | Taken | Rate    | 95% interval     | Compatible? |
| ------------------------ | -------- | ----- | ------- | ---------------- | ----------- |
| Premium trap (16.667%)   | 19,838   | 3,301 | 16.640% | 16.128 to 17.164 | yes         |
| Limp-reraise bluff (22%) | 3,518    | 787   | 22.371% | 21.024 to 23.777 | yes         |

Per archetype, as shipped (taken of eligible, rate, 95% Wilson interval):

| Archetype   | Premium trap                            | Limp-reraise bluff (per bluff-eligible) |
| ----------- | --------------------------------------- | --------------------------------------- |
| LAG Shark   | 828 of 4,933, 16.78% (15.77 to 17.85)   | 240 of 829, 28.95% (25.97 to 32.13)     |
| Tricky Trap | 870 of 3,962, 21.96% (20.70 to 23.27)   | 141 of 717, 19.67% (16.92 to 22.73)     |
| TAG Crusher | 1,258 of 8,027, 15.67% (14.89 to 16.48) | 335 of 1,439, 23.28% (21.17 to 25.53)   |
| Nit Hunter  | 345 of 2,916, 11.83% (10.71 to 13.05)   | 71 of 533, 13.32% (10.70 to 16.47)      |

The limp-reraise bluff follows the Horse's own connector limp. As shipped,
per connector limp taken: 15.48% pooled, 787 of 5,085 (14.51 to 16.50);
LAG Shark 19.85% (17.70 to 22.19), Tricky Trap 13.49% (11.55 to 15.70), TAG
Crusher 16.29% (14.76 to 17.95), Nit Hunter 9.16% (7.33 to 11.40). On the base
source: 16.94%, 860 of 5,076 (15.94 to 18.00). Per original early connector
opportunity: about 3.08% pooled, 787 of about 25,563 (2.87 to 3.30); the
eligible count was not re-counted on the shipped code and is taken from the
two earlier runs. On the base source: 3.36%, 860 of 25,561 (3.15 to 3.59).

In the log of the shipped measurement, the suited-connector open-limp lines
(eligible equal to taken, 100%) and the linked "early connector limp eligible"
and "per original eligible" columns are an instrumentation artefact, not a
measurement, and are not used anywhere above. The harness counts eligibility
by re-running the decision with both persona scales forced very high; the
withheld connector limp no longer reads a scale, so that probe takes it
exactly when the real decision does.

Harness version: the measurement harness was edited after both 630,000-hand
runs, and the version that produced them was not kept, so the binding between
those two logs and a harness version is not verifiable. The counts above are
as logged.

### Rerun with the retained tool

The final measuring tool (sha256 088f6857...) was run once in each mode on
2026-11-12 under a declaration written before the runs: persona and anon
mode on this commit (350c15f7), and main mode (taken counts only) on the
untouched base 4850f853. Same ids, seed 20261112, 630,000 hands per run. The
tool, the declaration, the source file hashes and the raw outputs are bound
in one manifest in the evidence folder (`rerun-final-tool/MANIFEST.json`).

| Mix (approved)           | Run                      | Eligible | Taken | Rate    | 95% interval     | Compatible? |
| ------------------------ | ------------------------ | -------- | ----- | ------- | ---------------- | ----------- |
| Premium trap (16.667%)   | This commit, persona     | 19,838   | 3,301 | 16.640% | 16.128 to 17.164 | yes         |
| Premium trap (16.667%)   | This commit, persona out | 19,864   | 3,293 | 16.578% | 16.067 to 17.101 | yes         |
| Limp-reraise bluff (22%) | This commit, persona     | 3,518    | 787   | 22.371% | 21.024 to 23.777 | yes         |
| Limp-reraise bluff (22%) | This commit, persona out | 3,511    | 860   | 24.494% | 23.100 to 25.944 | no (base)   |

Every eligible and taken count above is identical to the historical shipped
and base figures, so the rerun reproduces them. The untouched base source
gives the same taken counts as "persona out" for all three mixes (premium
trap 3,293, connector limp 5,076, limp-reraise bluff 860), which is consistent with "persona out" being the base behaviour on these three mixes; it is not a proof of equivalence. Bluff share of all limp-reraises,
pooled: 23.36% (21.96 to 24.82) with the persona, 25.01% (23.59 to 26.48) on
the base. Per archetype with the persona: LAG Shark 26.79% (23.99 to 29.78),
Tricky Trap 16.99% (14.59 to 19.69), TAG Crusher 25.79% (23.48 to 28.24),
Nit Hunter 20.64% (16.70 to 25.23).

What the rerun cannot reproduce: the suited-connector open-limp. Its
eligibility probe works by forcing the persona scales high, and the
withheld mix no longer reads a scale, so the retained tool reports it at
100% on every source (an artefact, not read). The decision to withhold it
rests on the historical all-three-scaled measurement (19.27%, 18.79 to
19.75), which is unverified. It stays withheld; withholding keeps main's
behaviour and needs no further evidence. The per-original-opportunity
denominator (about 25,560) likewise comes only from the historical runs.

What this measurement cannot show: it has no top-up rotator, no postflop
play, no real Horse ids and no humans. Early-limp opportunities were balanced
across archetypes here (24.7 / 20.3 / 40.0 / 14.9%), which is what this
harness produces by construction, not evidence about production. No constant
was retuned.

## Table-level frequencies (synthetic measurement, earlier variant)

Measured when all three mixes were scaled; not re-run after the connector
limp was withheld, so the open-limp column overstates the shipped
differences. Nine-seat no-limit hold'em cash, 100 big blinds, preflop only,
all nine seats of the same archetype, 8 seeds of 5,000 hands (360,000
seat-hands per row).

| Table             | VPIP   | PFR    | 3-bet facing an open | Early open-limp rate |
| ----------------- | ------ | ------ | -------------------- | -------------------- |
| Before (any)      | 28.46% | 15.83% | 9.02%                | 0.58%                |
| After LAG Shark   | 28.49% | 15.85% | 9.01%                | 0.51%                |
| After Tricky Trap | 28.44% | 15.82% | 9.01%                | 0.84%                |
| After TAG Crusher | 28.43% | 15.84% | 9.06%                | 0.50%                |
| After Nit Hunter  | 28.51% | 15.80% | 9.00%                | 0.42%                |

The standard error of VPIP across seeds is about 0.08 points; none was
computed for the open-limp column. VPIP, PFR and 3-bet facing an open do not
differ between archetypes.

## The plan's per-archetype VPIP bands are not delivered

Stated plainly: this change does NOT deliver the plan's per-archetype cash
VPIP bands (about 29 to 31% for LAG Shark down to about 25 to 27% for Nit
Hunter), and they cannot be delivered by wiring the existing persona outputs.
The hands these mixes govern are played either way, by a limp or by a raise.

## One existing test gains a pre-declared 40-seed assertion

`server/src/engine/HorseHoldemEliteOverhaul.test.ts` asserts, on one seed
and 1,000 hands, that V87 produces more than 8 points more multiway
single-raised pots than pre-V87. The lift has a per-seed standard deviation
of about 2, so one seed decides it: 10.0 points on the base source, 9.2 as
shipped here, and 6.9 (red) in the earlier variant that also scaled the
connector limp. The table in that test seats nine fixed ids in fixed seats
(one Nit Hunter, six TAG Crushers, two LAG Sharks, no Tricky Trap), so it
measures nine personas, not the fleet.

The original single-seed line is kept unchanged and passes. Added beside it:
the same 8 points asserted on the pooled share over a confirmatory block of
40 seeds, 1,000 hands each, same table and arms.

EXPLORATORY results (outcomes read before any declaration; not the test):
seeds 101 to 140 gave lifts of 8.26 on base and 8.60 with all three mixes
scaled; seeds 20261110 to 20261149 gave 8.514 and 8.428.

CONFIRMATORY block: seeds 20261150 to 20261189, fixed mechanically as the 40
seeds after the exploratory block and written down, with the metric, the
standard-error formula and the decision rule, before any outcome on it was
computed. Run once on each source, no reruns:

| Source                 | Pooled V87 | Pooled pre-V87 | Pooled lift | Standard error | 95% interval | Per-seed min / median / max | Per-seed sd | Seeds above 8 |
| ---------------------- | ---------- | -------------- | ----------- | -------------- | ------------ | --------------------------- | ----------- | ------------- |
| Base source            | 45.293%    | 36.963%        | 8.330       | 0.301          | 7.72 to 8.94 | 3.87 / 8.51 / 12.63         | 1.905       | 24 of 40      |
| This change as shipped | 45.379%    | 36.963%        | 8.417       | 0.347          | 7.72 to 9.12 | 3.93 / 8.23 / 13.75         | 2.192       | 22 of 40      |

The standard error is the across-seed standard deviation of the per-seed
lift divided by the square root of 40; the interval is the pooled lift plus
or minus 2.0227 standard errors. The point estimate clears 8 on both
sources, so the test passes. Both intervals include 8: this does not
establish that the lift exceeds 8 points, on main or here. Whether "more
than 8 points" is a supported product claim is an open owner question.

Two separate statements, kept apart:

- Compatibility with the baseline lift: on the same 40 seeds, this change
  moves the lift by +0.07 points against the base source (95% interval -0.42
  to +0.56, paired by seed). It is not distinguishable from main on this table.
- An absolute lift above 8 points: not established on either source (both
  intervals above include 8).

How the figures reconcile: the pooled lifts are computed from pot counts
summed over all 40 seeds, 8.330302 on main (V87 10,041 of 22,169 =
45.292977%, pre-V87 9,794 of 26,497 = 36.962675%) and 8.416729 here (10,047 of
22,140 = 45.379404%, same pre-V87 arm), a pooled difference of 0.086427. The
paired difference is the plain mean over the 40 seeds of (this change's lift
minus main's lift) for each seed: 8.398658 minus 8.329007 = 0.069650. The two
differ because pooling weights each seed by its number of single-raised pots
while the paired mean weights every seed equally; these means are computed from the per-seed lifts as logged, which are rounded to four decimals, so each mean is within 0.00005 of its unrounded value.

## Limits

- Every measurement here is synthetic: Horses against Horses, preflop only,
  synthetic ids. There is no production evidence and the real Horse ids were
  not examined.
- This changes decision behaviour, so the earlier 52,000-hand benchmark does
  not describe it. It needs its own qualification and an engine release
  before any Horse plays this way.
- Decisions recorded by an earlier engine release can replay differently on
  the two wired branches. The exact replay already refuses a record made by
  a different release; the looser replay will report a divergence.
