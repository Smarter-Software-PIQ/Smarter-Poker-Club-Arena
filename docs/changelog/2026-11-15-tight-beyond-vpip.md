# Tight beyond VPIP (option styleTightMultiSignal, default off)

The style read calls a player tight on participation: VPIP credibly below the Horse mean minus 0.02, or the call share
(VPIP minus PFR) credibly low. Hand Analysis graded one human (VPIP 0.165 to 0.172, PFR 0.088 to 0.091 over 1,000+
tournament hands) tight by the observation method's 0.18 line; the engine read him neutral. This adds a second,
corroborated route, behind an option that is off.

## CLASS-DEFINITIONS (declared before measurement, 2026-11-15)

Participation is unchanged when the existing routes call it tight or loose. When they leave it neutral, it is TIGHT by
the multi-signal route iff all of:

1. VPIP credibly below the Horse VPIP mean of the cell: P(rate < mean) >= 0.90 on at least 15 decayed hands, in the
   window the VPIP signal reads (the 120-hand window when it speaks, else the 30-hand one).
2. Corroborated at 0.90 on at least 8 decayed opportunities by raise share (PFR over VPIP, over the VPIP hands of the
   same window) credibly above the Horse share plus 0.02, or by fold to 3-bet credibly above the Horse mean plus 0.04
   (pre-repair discount applied).
3. No contrary evidence: VPIP and call share not high; raise share not credibly below the Horse share minus 0.02.

Why: the method's 0.18 line at 90% needs VPIP at or below about 0.145 even on a saturated long window, stricter than
the existing route (0.156), so it cannot be the gate. The Horse mean is the reference every style side uses; dropping
the 0.02 margin on VPIP is paid for by an independent second signal at 90%. Ceilings at 90% (full ring, 43.8 / 100 /
173.6 decayed hands): 0.138 / 0.163 / 0.175; short 0.299, heads-up 0.374 at saturation. Horse raise share: 0.644
full, 0.755 short, 0.768 heads-up; fold to 3-bet line about 0.70 (43.8 opportunities) to 0.90 (8) full ring.

Declared targets: T1 a full-ring 15 to 17.2 percent player raising 80 percent or more of what he plays reads tight
with the option on; T2 a 17 percent caller-heavy player never does; T3 loose and average players unchanged; T4 the
graded human as measured; T5 option off byte-identical.

## What was measured

- T1 holds, but it held BEFORE this change: such a player is already tight through the call-share route (call share
  0.03 against the Horse 0.076). The raise-share corroborator needs about the same raise share (0.78) as that route,
  so it adds nothing in practice. A player raising 70 to 75 percent of what he plays is read tight by neither.
- What the route adds is fold to 3-bet: a 17 percent player raising 53 to 60 percent who folds 80 to 85 percent of
  25 to 30 three-bets is neutral today and tight with the option on.
- T4: the graded human (raise share about 0.53, below the Horse 0.644, not credibly caller-heavy either) stays neutral
  without a fold-to-3-bet read; tight only if he folds to 3-bets credibly more than Horses. No line was moved to change
  that.
- T2, T3 hold; T5: a 672-read option-off grid hashes to the value captured on the base.

## What it changes when on

Only the participation side of players the existing routes leave neutral. The preflop tight consumers (#6a, #6b)
still need PFR credibly low, which a raise-heavy player does not have; #2's tight route (callDownMod 1.0 instead of
the legacy 1.2 against an aggression factor above 2.5) and the style labels see the side. Receipt
style_tight_multi_signal_seen. League card nlh_style_tight_multi_signal. Evidence:
docs/horse-default-on.d/styleTightMultiSignal.md.
