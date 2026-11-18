# A gear shift is reachable (option holdemGearShiftReach, default off)

Audit I (audits-a7965514/I-upgrade-10-gear-shift.md) found the "player changed gear" read reachable only for a
player who raises nearly every hand: the gear-shift branch of `opponentExploitRead` judged the 8-hand window at 0.95,
and once the long mean crossed the envelope edge it was not tried at all (the 0.97 fast-engage line applied alone).
In full ring no case reached it. This adds a reach behind an option that is off.

## DECLARED before measurement (2026-11-15 ~17:45Z)

With the option on, for a no-limit hold'em read from `HorseMind.opponentRead`, a statistic whose long read is not
engaged, with 8+ fast opportunities and a confirmed regime break (`styleShiftReleased`, unchanged), is engaged HIGH
from the fast window at the ordinary credibility (`EXPLOIT_CREDIBILITY`, 0.90), on pfr, rfi, threeBet and
betCheckedTo only:

1. in the gear-shift branch, when the 0.95 line is missed;
2. after the fast-engage branch, when the 0.97 line is missed.

No new threshold. Unchanged: the sample floor, the regime-break test, the envelope edge, the low sides, foldToBet and
riverCall, the fast-window OFF switch (a maniac who settles down is already read calm by it), Omaha, fixed limit.

Targets: G1 a tight full-ring player who starts attacking is read earlier; G2 no reach without a regime break; G3 a
read the stricter lines already make is identical; G4 option off, every read unchanged.

## What was measured (synthetic counters, aGearShiftIsReachable.test.ts)

- G1: full ring, history 8 to 18 percent PFR on 20 or 40 decayed hands: 6 raises in the last ~12 hands engage with
  the option (7 to 8 needed today). The read then carries a preflop maniac width.
- G2: 5 raises in the last 12 engage neither way; a steady player is not touched. SHORT-HANDED AND HEADS-UP ARE NOT
  REACHED: the lines stay at 9 and 10 raises in the last 12 at every history tried, because those envelopes are wide.
- G3, G4 hold; the maniac read grid keeps its base pin.

## Limits

- The gain is one to two raises earlier, full ring only. Short-handed and heads-up reach needs a different rule and
  is not built.
- Interaction with holdemManiacSampleGate (C3): with both on, the gate judges the maniac WIDTH on the long counters
  (15 decayed hands, PFR credibly beyond the regular line), so a gear-shifted read can be withheld from the maniac
  preflop responses while still feeding the other effects of the read. Which of the two should govern is not decided.
- The second surface the manifest names, `HorseScopedOpponentModel.buildGearShiftAwareScopedOpponentModel`, still has
  no caller; the foldToBet low side stays unattainable. Neither is changed here.
- Not measured against humans or on production nodes.
