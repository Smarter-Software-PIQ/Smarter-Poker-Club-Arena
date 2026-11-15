# A regular is not a maniac (option holdemManiacSampleGate, default off)

The preflop maniac width (`maniacRaiseWidth`, the key every maniac response reads) had no sample floor. An unknown
player who raised 4 (full ring), 5 (short-handed) or 6 (heads-up) hands in a row already read as a maniac, and
short-handed and heads-up a regular's first-in raising alone (mostly button and small-blind opens at 70 to 85
percent) could carry it. This adds a sample gate behind an option that is off.

## CLASS-DEFINITIONS (declared before measurement, 2026-11-15 ~15:15Z)

Declaration record: extreme-archive/agy-holdem-elite-c2072436/DECLARE-C3-maniac-honest-reach-20261115T1515Z.md.
With the option on, a no-limit hold'em read has a maniac width only if, in addition to today's rule:

1. SAMPLE: at least 15 decayed hands in the counters the read stands on (the style read's unknown line).
2. OPENER ROUTE: PFR over all hands credibly above L(size) = Horse PFR P99 of the cell + 0.10, P(pfr > L) >= 0.90 on
   the read's own Beta posterior (prior strength 6 at the Horse mean). First-in raising alone no longer qualifies.
   L: full 0.2985, short 0.4566, heads-up 0.5326.
3. RE-RAISE ROUTE: today's lines plus at least 8 decayed 3-bet opportunities.

Declared targets: M1 realistic aggressive regulars (full 30, short 35 to 45, heads-up 45 to 55 percent PFR) are not
maniacs at any sample; M2 an unknown player raising 4 to 6 hands in a row is not a maniac; M3 true maniacs still are
once 15 decayed hands are in (a jammer at every size; full 60, short 70, heads-up 80 percent PFR sustained; a 40
percent 3-bettor on 10 opportunities); M4 option off, every read unchanged.

## What was measured (synthetic counters, aRegularIsNotAManiac.test.ts)

- M2 holds at every size: 4 / 5 / 6 straight raises read maniac today and not with the gate.
- M1 holds at 15.6, 30 and 43.8 decayed hands. Measured today: a heads-up player at PFR 0.50 with 90 percent first-in
  raises, and a short-handed one at 0.40 / 0.85, are read as maniacs by the first-in route alone.
- M3 holds: a player raising every hand reads maniac from about hand 19 (18 counted hands are not enough); sustained
  0.60 / 0.70 / 0.80 PFR by size reads maniac; a 40 percent 3-bettor on 10 decayed opportunities reads maniac at 20
  hands and not at 12 (under the sample floor). In every case tried the base 3-bet read itself needs about 8
  opportunities, so the declared 8-opportunity floor did not bind on its own; it is kept as declared.
- M4: a 1,536-read option-off grid hashes to the value captured on the base commit (bedb1dd6407e52da8312c14e).

Stated cost: with the option on a true maniac is recognised at about hand 19 instead of hand 4 to 6.

## What it changes when on

Only no-limit hold'em reads returned by `HorseMind.opponentRead`; Omaha and fixed-limit are untouched. Every maniac
response keyed on `maniacRaiseWidth` sees the gated read. Receipt `maniac_sample_gate_withheld_seen` (the ungated
read had a width, the gated one has none). League card `nlh_maniac_sample_gate`. Evidence:
docs/horse-default-on.d/holdemManiacSampleGate.md.
