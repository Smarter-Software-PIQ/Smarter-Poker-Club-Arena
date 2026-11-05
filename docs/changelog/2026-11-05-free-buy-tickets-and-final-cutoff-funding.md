# Free Buy tickets, and every Free Buy is funded only at its final cutoff

Owner ruling, 2026-11-05 14:24 America/Chicago. Supersedes "the Midway promo
wallet pays 1 chip into the prize pool at signup" (#9515, migration
20261105035220).

## The rules, as built

- **Tickets.** Every Club Arena account gets five Free Buy tickets per
  tournament day. One row per (user, day) makes the grant exactly once; a daily
  job grants every account (offline ones too) and a user who joins later is
  granted that day's five on first use. A ticket covers the first entry into
  any Free Buy, guaranteed or not; one ticket per user per event. Rebuys,
  re-entries after the first entry and add-ons are paid from the player's
  wallet by the unchanged purchase owner. Issuing or holding a ticket moves no
  chips. An unplayed unregister or cancellation restores the ticket. No new
  expiry, carryover or transfer rule was invented: a ticket is good for the
  Free Buys of its own tournament day.
- **Which day the 12:30 AM event belongs to.** The tournament day is the
  daily window's operating day (`smarter_private.daily_window_policy`), which
  turns over at 04:00 Chicago. The Friday 12:30 AM Midnight Free Buy is
  Thursday's fifth Free Buy and uses a Thursday ticket.
- **Guaranteed Free Buy.** C is the players' full wallet payments (rebuys and
  add-ons) before any bounty or rake share is set aside. U = max(0, G - C),
  P = (prize share of C) + U. With no bounty or rake that is P = max(G, C).
  Tickets add no chip.
- **Non-guaranteed Free Buy.** V = 1 chip per valid first-entry ticket,
  P = V + C, U = V. A Mystery ticket splits its chip 0.50 bounty / 0.50 prize;
  a PKO ticket is all bounty.
- **Timing.** Nothing reaches a prize pool before registration and every rebuy
  and add-on window have closed (the existing finalization window guard). At
  the cutoff, inside `fn_apply_prize_guarantee` and before the close-out core,
  `fn_ca_free_buy_fund_at_cutoff` takes the lane and the event row, computes P
  and U, subtracts promo chips already recorded (pre-ticket entries), moves
  only the remainder from the Midway promo wallet (or returns an excess by a
  compensating entry before anything is paid) and writes one
  `ca_free_buy_cutoff_fundings` row. It is in the same subtransaction as the
  finalization, so a refused or interrupted finalization keeps nothing, and a
  retry moves nothing.
- **Bounties.** A bounty head is live from the first hand and paid at each
  knockout, so the bounty share of a ticket (PKO 1, Mystery 0.50) is booked
  from promo when the head is created. Only the prize-pool share waits for the
  cutoff. Nothing is ever moved from the bounty pool to the prize pool.
- **Rollout.** Every registration standing in an unfinalized Free Buy when the
  migration installs gets a `rollout_compat` record: free entry kept, no
  charge, no refusal, and it does not use one of the user's five tickets.
- **Other guaranteed tournaments** are funded by the close-out core at the same
  cutoff from their own source (union bank, club treasury fallback). Migration
  `20261105220120` makes that close-out count the full buy-in, bounty and rake
  included (see `2026-11-05-a-guarantee-counts-the-full-buy-in.md`).

## Files

- `supabase/migrations/20261105204917_free_buy_tickets_and_guarantees_fund_at_the_final_cutoff.sql`
- `supabase/migrations/20261105204918_midway_free_buy_watch_reads_the_schedule_not_event_ids.sql`
  (replaces never-installed `20261105183114`, now `SUPERSEDED BY`, which
  exempted three events by id)
- `supabase/migrations/20261105220120_a_guarantee_counts_the_full_buy_in.sql`
  (every guaranteed event: C counts bounty and rake; see its own changelog).
  The earlier carry-over of #9566 (overlay guard sizes horse attendance by
  prize + bounty only) was dropped: under the full-buy-in rule rake counts
  toward the guarantee, so the existing guard's buy-in + fee sizing is the
  correct one.
- Native proof: `scripts/ci/test-free-buy-tickets.py` (CI shard 1);
  law: `tests/free-buy-tickets-fund-at-the-final-cutoff.law.test.ts`.

## Review of 20261105034239 against the timing rule

It stops funding ordinary guarantees at start, so the close-out at the final
cutoff pays only the real shortfall: that matches the rule. Two arms of the
same lock trigger still fund at START and do not match it: a satellite's
guaranteed seats, and the Diamond Arena guarantee arm. Neither is a Free Buy
and neither is changed here; each needs its own change to the close-out.
