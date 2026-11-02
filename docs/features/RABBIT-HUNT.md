# Rabbit Hunt

Rabbit Hunt shows the board cards that would have come after a hand ended early. The cards go only to the player who asks, and only after the engine has charged for them.

## Who Can Use What

| Feature                                                                         | Who                              | Where                                                   |
| ------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------- |
| Rabbit Hunt on the hand that just ended (the 90 second felt window)             | Every player dealt into the hand | The HUD tile at the table                               |
| Auto Run Rabbit Hunt (reveals the run out automatically on every eligible hand) | VIP only                         | Table Settings, "Auto Run Rabbit Hunt" (off by default) |
| Rabbit Hunt on a previous hand                                                  | VIP only                         | The table's hand viewer and the Hand History page       |

## Price

Every reveal is charged the same way, in this order: Lifetime VIP (free), expiring purchased or won Rabbit Hunt credits, the VIP monthly allowance, then the live diamond price from `feature_pricing`. Reopening a hand you already paid for is free.

## The One Day Limit

- The engine saves the undealt cards of every hand that ends before the river on one board, in `rabbit_hunt_offers`. That table is sealed: no player or anonymous role can read it, and the cards leave the server only through the engine's paid reveal.
- Saved run outs are kept for **1 day** after the hand. The limit is enforced where the cards are read: the engine only reads back a run out saved less than 1 day ago (`RABBIT_HUNT_SAVED_RETENTION_MS`), and `fn_rabbit_hunt_replay_status` answers `expired` after 1 day. The prune (`sp_prune_rabbit_hunt_offers`, every ten minutes) only deletes rows that are already unusable.
- After 1 day, a previous hand can no longer be rabbit hunted, including one you already bought. Within the same app session, a hand you bought still reopens from that session's receipt.
- The hand viewer states the limit: "VIP Rabbit Hunt On A Previous Hand Is Available For 1 Day", "Available Until ..." for a saved hand, and "Past The 1 Day Limit" once a hand is older than 1 day.

## What The Hand Viewer Shows Past The Felt Window

The viewer asks `fn_rabbit_hunt_replay_status` (no cards are returned) before offering a purchase:

| Status        | Shown                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `saved`       | The purchase button for a VIP, with "Available Until ..." (non VIPs see the VIP note)          |
| `unavailable` | "Previous Hand Rabbit Hunt Is Not Live Yet" (no run out has been saved anywhere in 30 minutes) |
| `not_saved`   | "This Hand Was Not Saved For Rabbit Hunt"                                                      |
| `expired`     | "Past The 1 Day Limit"                                                                         |

A player who was not dealt into a hand gets exactly the answer a hand with nothing saved gets (`not_saved` or `unavailable`), from both the status check and the engine ("Rabbit Hunt Is No Longer Available For That Hand"). Neither says anything about another player's hand. The viewer keeps its "You Were Not Dealt Into This Hand" copy for an older server that still answers `not_eligible`.

## Correcting A Charge

`fn_correct_rabbit_hunt_charge(player, table, hand, credit, operator, reason)` gives back what one reveal consumed. It is service role only, and players cannot call it.

- It finds the reveal by the engine's own request id and requires both receipts (`digital_purchase_receipts` and `rabbit_hunt_reveals`).
- A charge paid from a credit restores one use to the named credit. The credit must be the player's rabbit hunt credit, of the receipt's credit source, created before the charge and still unexpired.
- A charge from the Lifetime or monthly VIP allowance releases one count from the month the charge was made in.
- Diamond charges are refused here; diamonds have their own ledger.
- One correction per reveal. A second call returns the recorded correction and changes nothing.
- Every correction is recorded with operator, reason, before and after in `rabbit_hunt_charge_corrections`, which is append-only. The player keeps the cards they saw.

## Who Decides

The engine (`revealRabbitHunt`) is the only authority: the felt window, the VIP rule for previous hands (checked before any charge, failing closed), the dealt in set, the table's `allow_rabbit_hunt` switch, and the free reopen. The client only decides which control to show.

## The Price Before The Tap

`fn_rabbit_hunt_charge_preview()` (signed in players, read only) answers what the caller's next rabbit hunt would draw on, in `fn_consume_rabbit_hunt_v2`'s own order: Lifetime VIP, the soonest expiring credit, the monthly VIP allowance, another credit, then diamonds. The Hand History button shows it under the tap ("Uses 1 VIP Rabbit Hunt (63 Left This Month)", "Costs 5 Diamonds (You Have 2)"). The engine still decides and charges; the preview never changes anything.

## Auto Run Allowance

The Auto Run Rabbit Hunt setting says each automatic reveal is charged like a tap, and under it shows the live allowance from the same preview ("Lifetime VIP: Unlimited Reveals", "40 VIP Rabbit Hunts Left This Month", "VIP Rabbit Hunts Used Up This Month. Next Reveals Cost 5 Diamonds").

## A Bought Run Out Is Kept

The shared saved run out is deleted after one day. When a reveal is recorded (`rabbit_hunt_reveals` insert), the trigger `rabbit_hunt_reveal_keeps_the_bought_runout` copies only the cards that player paid for and saw into `rabbit_hunt_owned_runouts` (one row per player, table and hand). `fn_rabbit_hunt_owned_runout(table, hand)` returns only the caller's own row, so Hand History re-shows that run out free at any age with "You Bought This Run Out. It Stays In Your Hand History". No other player's purchase, and no card beyond the run out, is ever returned.

## Rabbit Hunt Desk (Staff)

`/rabbit-hunt-desk` (Financial Admin hub, platform staff only, behind `PlatformStaffGuard`) finds a player by username, player number or id through `fn_staff_rabbit_hunt_receipts` and lists their last 50 charges with any correction. "Correct" calls `fn_staff_correct_rabbit_hunt_charge`, which checks `fn_is_platform_admin()` in the database and runs the same audited core as the service correction, recorded as `staff <username> (<id>)`. Diamond charges are refused and go to the Diamond desk.
