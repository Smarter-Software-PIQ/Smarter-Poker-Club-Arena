# 2026-11-05 - Five Free Buy Tickets A Day For Every Player

Owner rule (Dan, 2026-11-05): five Free Buy tickets per player per day across Club Arena; a ticket covers the first entry into any Free Buy (guaranteed or not), one per player per event; rebuys, re-entries and add-ons are paid from the wallet; offline and new users have the day's allotment; issuing a ticket moves no chips.

Before: the first entry was the one-chip promo-funded head (#9515) with no daily limit.

Now (migration 20261105223835): the allotment is a right (five per player per gaming day, written once on first use, so no grant job and no duplicate grant). Both registration doors redeem one ticket in the same transaction as the promo head; a sixth first entry in a gaming day is refused with FREE_BUY_TICKETS_USED_TODAY before anything is charged; one live ticket per player and event; an unplayed entry returned before play restores its ticket. The gaming day turns at the end of the 04:00-06:00 Chicago window, so the 00:30 Midnight Free Buy counts on the day before. `fn_ca_free_buy_tickets()` returns the signed-in player's used and remaining tickets.

Funding: a guaranteed Free Buy's voucher chips are house/promo funding inside H = max(0, G - C) (no extra one-chip transfer on top of H); a Free Buy without a guarantee keeps its voucher funding V.

Probe (rolled back, 22:37 UTC): both registration doors and the promo head patch and compile; gaming-day boundaries 2026-11-06 00:30 CT -> Nov 5, 08:30 CT -> Nov 5, 05:59 CT -> Nov 4.
