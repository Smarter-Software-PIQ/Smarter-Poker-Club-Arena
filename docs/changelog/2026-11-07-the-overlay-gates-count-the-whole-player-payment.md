# The overlay gates count the whole player payment (2026-11-07)

Owner rulings: a buy-in guarantee counts the whole player payment (2026-11-05);
the total prize pool is the buy-ins net of rake and the bounty pool comes
straight out of it (2026-11-06). The close-out (#9591) and every player screen
(#9786) already follow them. Six doors that size an overlay before the close
were still reading guarantee minus the place pool, which charged the bank the
bounty pool and the rake as if they were still owed:

- `fn_tournament_management_readiness_for_row`: Game Management's Overlay
  Required and Short By, and the `funding_blocked` state the publish and start
  guards refuse on. On the registering 40 Chip Bounty Freezeout 2.5K GTD it
  read 2,448 against the ledger's 2,420; at 46 entries it would read 1,304
  against a true 660, so a bank that covers the real overlay could be told it
  does not.
- `trg_tournaments_guarantee_affordable`: the same arithmetic on the event
  being announced and on every other open guaranteed event.
- `fn_notify_guarantee_bank_short`: the owners' bank-short notice.
- `fn_ca_fund_overlay_on_lock` and `fn_ca_return_excess_start_overlay_locked`:
  a satellite's guaranteed seats were funded and returned against the places
  alone; the guarantee half now uses the ledger place floor, the seats keep
  their full value.
- `fn_audit_overlays`: the digest estimate now counts entries x (buy-in + fee)
  against places + bounties + rake.

Migration `20261107183629_overlay_gates_count_the_whole_player_payment.sql`
rewrites the six doors by md5-pinned anchored substitution. Proven in a rolled
back production transaction: the postimages were installed in `pg_temp` and
compared to the live doors across all 290 open, unfinalized tournaments; no
other key moved, no overlay rose, no event became blocked, and on every chip
event with a guarantee the new `overlay_required` equalled
`fn_ca_guarantee_funding(id).house_required`. The readiness read also reports
`current_prize_pool` as places + bounties (the total prize pool), plus
`current_place_pool`, `current_bounty_pool` and `guarantee_credit`.

The Diamond arms keep their recorded place-based guarantee. Pinned by
`tests/a-buyin-guarantee-counts-the-whole-payment.law.test.ts`; the diamond
capture `tests/sql/diamond-tournament-current.manifest.json` carries the
rewritten readiness door.
