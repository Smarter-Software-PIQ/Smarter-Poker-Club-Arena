# 2026-11-04 - A guarantee is a floor, live, not a top-up stacked on late entries

Dan: "THE 1.5K GUARANTEE IS SHOWING 2445 IN THE PRIZEPOOL WITH ONLY 40 PLAYERS
AND 1 REBUY." and "MAKE SURE THESE ARE ALL FIXED BEFORE ANY PAYOUTS TAKE PLACE."

Cause: fn_ca_fund_overlay_on_lock sizes the overlay at start against the field
present at start; only the pool finalization ever shrinks it. During late
registration the pool printed overlay + every late entry. Wednesday Feature:
1,338 overlay sized on 6 entries, then 52 more entries landed on top (2,904
shown; players had put in 1,566).

Settled now: Wednesday Feature's whole 1,338 returned to the Midway Union bank
through fn_ca_return_excess_start_overlay_locked (probe rolled back first,
amount asserted). Pool 1,566. Late Night PKO and Midweek Mystery are corrected
by the same finalization at their late-reg close, before any payout.

Root fix: migration 20261105034239 adds fn_ca_trim_live_overlay, run at the
commit of every transaction that adds money to a started pool (deferred
trigger on tournament_escrow). The overlay only shrinks; the pool is always
max(guarantee, money in). Bounty money is read from the escrow so a mystery
bounty counts toward its guarantee before activation, the same as PKO/bounty.

Display: displayTotalPool (lobby card) prints prize + bounties against the
guarantee; the lobby panel shows the floored prize pool and a Bounty Pool row.
