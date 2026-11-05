# 2026-11-04 - A guarantee moves no chips until registration closes

Dan: "THE 1.5K GUARANTEE IS SHOWING 2445 IN THE PRIZEPOOL WITH ONLY 40 PLAYERS
AND 1 REBUY." / "MAKE SURE THESE ARE ALL FIXED BEFORE ANY PAYOUTS TAKE PLACE." /
"YOU JUST DISPLAY THE 1500 YOU DON'T ACTUALLY ADD ANY CHIPS FOR THE GUARANTEE
TO THE PRIZE POOLS, ONLY IF THERE IS AN UNDERLAY DO CHIPS GET ADDED AFTER
REGISTRATION CLOSES FOR ANY AND ALL SHORTAGES."

Cause: fn_ca_fund_overlay_on_lock paid the shortfall from the union bank at
START, sized on the start field; late entries landed on top. Wednesday Feature
paid in 1,338 on 6 entries and read 2,904 once 58 entries covered 1,500 alone.

Settled before any payout (rolled-back probe first, amounts asserted):
Wednesday Feature 1,338, Late Night PKO 84, Midweek Mystery 352 returned to the
Midway Union bank. Pools now hold player money only.

Root fix (migration 20261105034239): the start trigger no longer moves chips
for a guarantee (satellite seat guarantees excepted - the close-out does not
cover seats). The existing close-out, fn_apply_prize_guarantee ->
fn_ca_apply_prize_guarantee_core, pays exactly max(0, place guarantee - pool)
when late registration closes. Screens show the guarantee as a floor
(effectivePrizePool; lobby card displayTotalPool = prize + bounties against GTD;
lobby panel adds a Bounty Pool row).

Pinned: tests/a-guarantee-moves-no-chips-before-close.law.test.ts.
