# A checked aggressor does not block multiway value

The heuristic initiative gate treated every player who was not last to act as
leading into the previous aggressor. In a multiway river pot that remained true
after the aggressor had already checked. Synthetic top-full-house cases in PLO4,
PLO5 and PLO6 checked for every tested seed; removing that gate made the existing
value policy bet.

The gate now reads the identity of the last prior-street aggressor and releases
when that player checked this street. A different player's check, an earlier
aggressor's check or a check on another street does not release it. The existing
value evaluator and legal sizing still choose the action; this is not a blanket
full-house bet or call override and does not change facing-bet policy.

Regression tests failed before the correction in all three variants and pass
afterward. They cover twenty fixed seeds per variant, retained initiative when
the aggressor is behind, last-raiser identity and street isolation. A connected
test passes the resulting bet through HandController's authoritative menu and
action validator with the normal variant-policy options. Existing HorseLogic
and river-nuts tests also pass. The legality fuzz logs an undefined-opponent
diagnostic on unchanged HEAD as well; it is not introduced by this change and
is not evidence of a clean error-free fuzz run.

The public-history predicate is a pure source-bound module. Two historical
layer-isolation suites mock only this later predicate to retain their original
pre-repair corpora, digests, action streams and RNG controls. Their assertions
and golden data remain unchanged; dedicated connected regressions exercise the
real predicate without a production opt-out. The module is included in every
reference policy digest so existing qualifications cannot silently cover changed
decision behavior.

This fixes a specific source decision condition. It does not certify historical
counterfactual EV, prove all full-house checks incorrect, or establish production
adoption. Protected checks, engine installation and observed behavior remain
separate delivery requirements.
