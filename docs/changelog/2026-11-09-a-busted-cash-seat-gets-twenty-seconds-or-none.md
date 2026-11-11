# A busted cash seat gets twenty seconds, or none (2026-11-09)

Owner instruction, with a screenshot of a Kings Club / Midway Union PLO5 1/2
table dealing a hand around a seat showing 0.00:

> when a player loses all his chips, there should be a realtime check of the
> database to see if he has chips in his wallet to rebuy, and if he doesn't, it
> kicks him off the table right away. if he does give the player 20 seconds to
> rebuy before kicking them off the table.

## What was wrong

1. **The wallet was asked of the wrong club.** `anyBustedPlayerCanAffordARebuy`
   read `club_members` for `tables.club_id`. At a union table that is the union
   row, which holds no member wallet, so every busted player read as unknown,
   and unknown fails open: the table paused for, and held a seat for, a player
   with nothing to rebuy with.
2. **An open rebuy sheet held the seat with no limit.** Each heartbeat carrying
   `rebuyPromptOpen` restarted the ten-second grace, so a zero-chip seat stayed
   for as long as its owner left the sheet on screen.
3. **A player who could not rebuy still waited out the grace.**

## What changed

Engine (activates with the next certified engine release):

- `server/src/engine/BustRebuyWindow.ts` is the rule: wallet under the table
  minimum is `cannot_rebuy`; otherwise, or when the wallet or the minimum
  cannot be read, `can_rebuy` with a fixed 20 second window.
- `readSeatWalletBalances` reads the wallet each seat was bought from
  (`table_seats.club_id`, table club as fallback). The table pause and the
  release both use it.
- The dealing loop stamps the bust at the end of the hand (`noteCashBust`), so
  the twenty seconds run from the bust and include the table's own pause of up
  to five seconds, which is unchanged.
- `standUpBustedCashPlayers`, for a chip cash seat at a classic table, reads
  the wallet once per bust, before the pending-chip ledger. `cannot_rebuy` on a
  bust the engine watched is released on that sweep with the new reason
  `busted_insufficient_chips`; `can_rebuy` is released at twenty seconds with
  `busted_no_rebuy`. The rebuy sheet heartbeat no longer extends it. A rebuy
  already paid for (an unresolved `table_pending_addons` row) still keeps the
  seat, exactly as before.
- The player is told how long they have in a private `bust_rebuy_window`
  frame.

Client (no engine dependency; inert until the engine sends the frame or the
new reason):

- The bust rebuy sheet shows the engine's countdown in its existing pill.
- A removal for `busted_insufficient_chips` says so, and a confirmed removal
  closes the bust rebuy sheet.

## Limits, stated plainly

- A seat leaves at a hand boundary, like every other departure in this engine.
  A player with the chips to rebuy who lets the twenty seconds lapse while the
  next hand is being played is released when that hand ends, not mid-hand.
- A seat found at zero that the engine did not watch bust (just taken, moved
  in, read back after a restart) and whose wallet cannot cover the minimum is
  held for the existing ten-second grace, not released on sight: its first
  chips may be arriving by a path the ledger read does not show.
- Diamond cash seats and Lightning rooms keep their existing clocks. Horses
  keep their own recovery pass, which already rebuys or releases at the bust.
- Tournament seats are untouched.

## Proof

- `server/src/engine/aBustedCashSeatGetsTwentySecondsOrNone.law.test.ts`
  (17 cases; registered in `docs/laws.d/`).
- Fixtures that pinned the ten-second grace for a chip seat were moved to the
  window in the same change; the dialog-hold pin in
  `tests/run-it-multiple-times-tells-the-truth.law.test.ts` now says the hold
  is Diamond's only.

## Follow-up, 2026-11-10: the timing contract, enforced

Owner acceptance terms: the 20 seconds begin at the bust and include the table
pause; expiry makes the player ineligible for another hand; physical removal
follows the safe departure boundary; reopening the sheet, reconnecting or
restarting must not renew the deadline; a failed lookup is never reported as
insufficient funds.

- **Clock.** The window runs on `maintenanceActiveNow()`, the engine clock a
  freeze stops (the one Lightning's window already uses), so a break neither
  burns the window nor renews it (CLAUDE.md 13.4).
- **Expiry.** A per-seat timer fires at the deadline. A busted player is never
  in the live hand, and Dan's 2026-10-25 ruling lets a player who is not in the
  hand leave at once, so the seat is released at 20 seconds, mid-hand included.
  `atomic_table_rebuy` requires a live seat, so a later purchase is refused.
  The same check runs at every hand boundary before pending add-ons are
  delivered, so a late rebuy is never put on the felt and dealt.
- **Paid in time vs late.** At expiry an unresolved rebuy row the database
  stamped inside the window (1 s clock tolerance, in the player's favour) keeps
  the seat. A row stamped after it does not; the seat is released and
  `resolve_pending_addon` returns the whole debit because the seat was vacated
  (its `addon_refund:<id>` credit, exactly once, into the seat's club). An
  unreadable row list keeps the seat and asks again a second later. The timer
  and the boundary sweep share one release per occupancy.
- **Restart and cutover.** A fresh engine reads the bust instant from
  `hand_atomic_commits.stack_result` (the newest accepted hand listing the
  player, at zero) and excludes every freeze since from
  `engine_maintenance_thaws`, so the window resumes rather than restarts. An
  unreadable record leaves the first-sight clock and the existing grace.
- **Reopen and reconnect.** The sheet's heartbeat is answered with the time
  LEFT (at most every 3 s), never a fresh 20.
- **Minimum.** A wallet is judged against `cashRebuyMinimum`,
  `greatest(min_buy_in, 40 * big_blind)`, the rule the purchase enforces, now
  beside `cashMinBuyIn` in `server/src/config/cashBuyIn.ts`.
- **Wallet.** `readSeatWalletBalances` reads only the seat's own club. A seat
  naming no club is UNKNOWN, never the table club's wallet.

Horses: they answer at the bust (rebought, or released on stop-loss, declined
or unfunded), and the table pause is unchanged for everyone. A human cash seat
has no explicit decline (the client never calls `/reject_rebuy`), so a human
who does not rebuy is held for the full 20 seconds while a declining horse
leaves at once. That asymmetry predates this change and is not altered here.

### Database proof (existing chip-journal fixture route)

`scripts/ci/probes/chip-journal-atomicity/test_bust_rebuy_window.py`, run by
`run-isolated.sh` (beside `test_deferred_settlement.py`), installs the real
`atomic_table_rebuy`, `resolve_pending_addon` and `atomic_credit_wallet_and_log`
closures from migration history (stubs only for branches a cash refund never
reaches) and proves, each case rolled back:

1. Union table: the engine's read returns the seat club wallet the rebuy
   debits; the table club holds no wallet.
2. A wallet of 3 cannot rebuy at `min_buy_in` 2 (minimum `greatest(2, 4)`).
3. A rebuy after release is refused with no debit, row or receipt.
4. A rebuy racing the release is refunded whole, once, into the seat club;
   resolving again and replaying the purchase key move nothing.
5. An in-time rebuy is charged once and delivered once; a duplicate request
   replays.
6. A seat naming no club yields no wallet row (unknown).
7. The unresolved row carries the purchase stamp the window is judged by.

Duplicate keys and concurrent replay of the purchase itself are also covered by
the existing `test_rebuy_receipts.py` cases.

### Deployment (2026-11-11)

- Merged: #10325 (squash `5b6e25a0`) and #10374 (squash `993c8ed3`).
- Activated by the sealed engine release of `05ab41c30fc21a8a98001827e9921ffc314b81e7`,
  which contains both (workflow run 42965360845, sealed with exact-SHA proof).
- Freeze 05:27:52 UTC, thaw 05:31:32 UTC by `05ab41c3`; platform not frozen afterwards.

### Live behaviour observed (natural play only; no player was busted and no chips spent to test)

- **Insufficient wallet, observed.** PLO5 1/2 Madness
  (`8aea2cc5-e05a-4aa2-9404-ffa34a9fb33e`, union table, ordinary chip dealing).
  A human whose seat club wallet (`a41434bb...`) read 0.00 against a minimum of
  100 busted in the hand ending 05:52:15.694. The engine released the seat at
  05:52:38.159 (`system`, zero stack, nothing credited) and the next hand
  started at 05:52:38.591 without them. No later hand dealt them in. The 22.5 s
  is this table's ordinary end-of-hand cadence (gaps between the eight hands
  from 05:41 to 05:53 ran 18.6 to 23.9 s); the release came at the first
  boundary after the bust, with no rebuy pause and no further deal. The wallet
  row was readable, so the verdict was "cannot rebuy", not the fail-open path.
- **Sufficient wallet: 20 s offer, paid rebuy, expiry without rebuy, and
  exactly-once charging:** OUTSTANDING as natural observations. No human cash
  rebuy row (`table_pending_addons`) and no other human cash bust occurred
  between the thaw and 06:10 UTC. These paths are covered by the 33 engine
  cases in `aBustedCashSeatGetsTwentySecondsOrNone.law.test.ts` and the seven
  rolled-back database cases above.

### The offer leaves with the bust (2026-11-11, acceptance gap fixed)

**What was wrong.** The window opened at the bust (`noteCashBust`, right after
the hand-completion display and the hand-free broadcast, the moment the client
opens the rebuy sheet). But the wallet verdict and the private
`bust_rebuy_window` frame carrying the deadline came only from the next
boundary sweep (`standUpBustedCashPlayers`), which runs after the table's
rebuy pause (up to 5 s), the settlement wait, the roster reload and the
pending-add-on pass. The sheet opened without a clock and got one seconds
later. Where the boundary came 20 s or more after the bust, the frame said
0 ms left; the client ignores a non-positive frame, so the clock never
appeared. Gaps that long are ordinary on PLO5 1/2 Madness: 18.6 to 23.9 s
between hands on 2026-11-11.

**Fix.** `offerCashBustWindows` runs at the bust, immediately after
`noteCashBust` and before the pause. It reads the seat wallets once, records
each human's verdict, sends a player who can rebuy their full remaining time
(20 s), and arms the expiry timer. The table pause is decided from that same
read (`anyBustedPlayerCanAffordARebuy(justBustedPlayers, bustWallets)`), so
there is still exactly one wallet query per bust. The sweep finds the verdict
already made, so it neither reads again nor re-announces. An unreadable
wallet is still "can rebuy" (offered the 20 s, never stood up on it). Horses
are untouched: they answer at the bust through their own recovery.

**One deadline.** The engine's `bustedSince` (maintenance-excluding clock) is
the only deadline. The heartbeat resend tells a reopened or reloaded sheet
what is left. The client now keeps the earliest deadline it has been told for
the current bust (`Math.min`), so a late or repeated frame can bring the clock
forward but never push it back; it is cleared when chips arrive or the seat
goes. Remaining transit delay on a single frame (sub-second) is the only
difference between the sheet's clock and the engine's.

**Tests (isolated, not production evidence).** Seven cases added to
`aBustedCashSeatGetsTwentySecondsOrNone.law.test.ts` (42 total), plus two
wiring pins:

- an affordable bust is told 20 000 ms and the expiry is armed at the bust;
- a boundary sweep at 22.5 s releases it (`busted_no_rebuy`) with no second
  read or frame;
- a rebuy stamped inside the window keeps the seat through both the expiry
  and the sweep, and requests delivery;
- an empty wallet gets no offer and is released on the first sweep;
- an unreadable wallet is offered the 20 s and not released at 10 s;
- the pause is decided from the same read with no second query;
- a horse is not judged here.

Concurrent and retried payment and exactly-once charging are proven at the
database by the rolled-back cases above (4, 5 and `test_rebuy_receipts.py`).

### Empty-wallet production evidence, restated precisely

The 05:52 observation stands, and two separate claims come out of it.
**Ineligible throughout: verified.** `hand_atomic_commits` lists the player at
0 in hand 58496184 (committed 05:52:15.987) and does not list them in
58496463 or any later hand on the table. **Released "right away": not the
claim.** Removal came 22.5 s after the bust, at the first boundary. That is
the table's ordinary inter-hand gap, not a wait for the player.

### Natural observations still outstanding

From the thaw (05:31 UTC) through the checks at 09:30 and 13:15 UTC there was
no human cash rebuy row, and the only human zero-stack cash exit was the
05:52 empty-wallet release above. Nobody was busted and no chips
were spent to manufacture one. What closes them, once this change is live:
a human with at least the table minimum in the wallet their seat was bought
from busts at a regular chip cash table (not Lightning, not Diamond). The
evidence is one bust where (a) the sheet shows a countdown starting at 20 s,
(b) the player either rebuys before it ends and is dealt the next hand with
one `table_pending_addons` row and one wallet debit, or lets it end and the
seat is released about 20 s after the bust with no debit. A person doing this
deliberately needs a funded account at a 1/2 chip table and must lose a
stack, which spends their chips. That is the owner's call, not an agent's.

### Cleanup handoff (2026-11-11)

The retired worktree `wt-bust-rebuy` held nine staged migration files when it
was removed. All nine are recoverable from origin, and none was another
agent's unsaved work. Each file's exact blob exists in this repository's
history:

| File (supabase/migrations/) | Blob | Where it lives |
| --- | --- | --- |
| 20261110045731_reliability_controller_health_function_and_seed_corrections.sql | 86126397 | main |
| 20261110144203_reliability_controller_drift_mirrors_are_incidents_and_push_.sql | 7016ab1a | main |
| 20261110144739_a_spin_waits_out_its_horse_ladder.sql | cd4e72e0 | main |
| 20261110151500_v31_r8_is_rejected_at_seal_and_the_program_returns_to_parked.sql | 330d180e | main |
| 20261110152729_collusion_scan_index_plan_conservation_and_operational_alert.sql | b681ba46 | main history, #10357 (superseded on main by #10382) |
| 20261110155259_charles_rule_doubles_are_judged_before_the_house_take.sql | 1c70fc58 | main |
| 20261110160345_lightning_blinds_and_button_go_to_the_longest_waiting_player.sql | 4c9521f9 | main history, #10373 (renamed to its own version by #10380) |
| 20261110160345_table_seats_live_partial_indexes_keep_a_real_row_estimate.sql | c34fe5bd | main |
| 20261110162314_ca_hand_transfers_played_at_index_for_the_collusion_pair_flo.sql | 2a980599 | main |

They were snapshots of main taken into that worktree while it was synced, not
edits. The worktree's own two commits shipped as #10374 (squash `993c8ed3`).
Verified 2026-11-11 13:12 UTC: the saved patch holds all nine files, and each
of its nine blobs resolves to a commit in `origin/main` history (the table
above), so nothing in it exists only in a session.

Durable copies: the backup branch `backup/wt-bust-rebuy-2026-11-11`
(`1d3e79ae`, the worktree's two commits, shipped as #10374) is pushed to
origin, because its source branch was deleted after the squash merge. The
patch in session storage is not relied on; origin holds every blob.

Owners notified on their pull requests, because their versions differ from
the file now on main: #10357 (collusion scan, blob `b681ba46`) and #10373
(Lightning blinds, blob `4c9521f9`). The other seven files are byte-identical
to main and belong to merged work.

### Each frame names its bust (2026-11-11, follow-up to #10481)

**Gap.** #10481 kept the earliest deadline a sheet had been told, cleared on
chips or seat exit. Two holes remained. A frame reaching a seat that already
had chips again set a deadline nothing cleared, and the earliest-deadline rule
then held that stale, already-past deadline over the next bust: no clock. And
a frame carried no occupancy or bust identity, so a late frame of an earlier
bust could not be told from the current one.

**Fix.**
- Engine: `bust_rebuy_window` now carries `occupancy_id` and `deadline_at_ms`,
  the bust's deadline on the engine's wall clock (bust + 20 s, sent as
  `Date.now() + remaining_ms`). Every resend of one bust names the same
  instant; a later bust is at least a hand later.
- Client: `src/utils/bustRebuyDeadline.ts` (`nextBustRebuyClock`) decides each
  frame. It ignores a frame that reaches a seat with chips, ignores one whose
  deadline is more than 5 s before the current bust's (an earlier bust), starts
  over for one more than 5 s after (a new bust), and otherwise only lets the
  clock come forward. Server deadlines are compared only with each other,
  never with the device clock; the sheet counts on "time left when told" plus
  the device clock, as before.

**Tests (automated, not production evidence).** `tests/unit/bustRebuyDeadline.test.ts`
(9 cases: delayed wallet read, resend and reload, late frame of an earlier
bust in both directions, stale deadline replaced, funded seat, malformed
frame, an engine that names no bust, and the page wiring). The law file gains
"every resend of one bust names it by the same deadline" and its frame pins
carry the new fields (43 pass). `SitOutClockAndEviction` 20 pass. Server and
client typecheck clean. No browser fixture exists for this sheet, and none was
built: the rendered countdown is not browser-verified.

### Delivery status, 2026-11-11 22:10 UTC

- **Client:** live. `ca-static.smarter.poker` and `smarter.poker/hub/club-arena`
  both report `ca_sha` `88441c3d6e27f847f086e6b7fda307ea26ebb187` (run 43076646205),
  which carries #10481 and #10510.
- **Engine:** NOT live. Serving `f7735cca6862b9add06841b8a41c305b3f3ebe01`
  (process started 09:55:38 UTC; break log 10:00-10:05 UTC `thaw_ok` true),
  which contains neither #10481 (`aabef33a`) nor #10510 (`88441c3d`).
  `3e5ef38473` (contains both) holds `backup-engine/certified` success at
  19:32:34 UTC. The owner-authorized booking
  `2026-11-11-horse-realtime-10454-engine-1930z` (#10514, custodian Codex
  `01a1cbbb`, admission 19:30-22:30 UTC) was never dispatched: the receiver's
  last run is 42994475679 (09:21 UTC) and a GitHub Actions outage from 20:48 UTC
  queued every run. This lane notified the custodian in `COORDINATION-INBOX.md`
  (18:21 UTC) and on #10514 (21:38 UTC); no acknowledgement was received. This
  lane took no custody and dispatched nothing.
- **Next route:** the routine 04:00 America/Chicago release on 2026-11-12
  (Stage 03:30-03:50), which selects the newest certified main commit; every
  certified candidate at or after `3e5ef38473` carries both changes. After it:
  confirm `/health` `releaseSha` descends from `88441c3d`, the receiver run's
  sealed receipt, and the break log row's `thaw_ok` and `engine_version`.
- **Natural observations:** none yet of an affordable bust (offer, timely paid
  rebuy, or unpaid expiry). They can only be judged against this fix once the
  engine above is live.
