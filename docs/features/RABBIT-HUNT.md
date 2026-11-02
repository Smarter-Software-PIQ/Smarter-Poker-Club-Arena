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
- Saved run outs are kept for **1 day** after the hand. The prune (`sp_prune_rabbit_hunt_offers`) runs every ten minutes.
- After 1 day, a previous hand can no longer be rabbit hunted, including one you already bought. Within the same app session, a hand you bought still reopens from that session's receipt.
- The hand viewer states the limit: "VIP Rabbit Hunt On A Previous Hand Is Available For 1 Day", "Available Until ..." for a saved hand, and "Past The 1 Day Limit" once a hand is older than 1 day.

## What The Hand Viewer Shows Past The Felt Window

The viewer asks `fn_rabbit_hunt_replay_status` (no cards are returned) before offering a purchase:

| Status         | Shown                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `saved`        | The purchase button for a VIP, with "Available Until ..." (non VIPs see the VIP note)          |
| `unavailable`  | "Previous Hand Rabbit Hunt Is Not Live Yet" (no run out has been saved anywhere in 30 minutes) |
| `not_saved`    | "This Hand Was Not Saved For Rabbit Hunt"                                                      |
| `not_eligible` | "You Were Not Dealt Into This Hand"                                                            |
| `expired`      | "Past The 1 Day Limit"                                                                         |

## Who Decides

The engine (`revealRabbitHunt`) is the only authority: the felt window, the VIP rule for previous hands (checked before any charge, failing closed), the dealt in set, the table's `allow_rabbit_hunt` switch, and the free reopen. The client only decides which control to show.
