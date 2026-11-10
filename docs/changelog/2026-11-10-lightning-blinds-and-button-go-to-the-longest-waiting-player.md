# Lightning: The Blinds And The Button Go To The Longest Waiting Player

Dan, 2026-11-10 09:52 Chicago: "investigate how players are seated on the BB, SB and Button. I was SB 3 hands in a row and was on the button or in the bb multiple times within a couple hands. this needs to be truly fair and corrected."

## The rule as it was

A Lightning hand is formed from a pool, so there is no ring for the blinds to walk round; each formation decides them.

- Big blind: `fn_lightning_blind_order` (an unresolved big blind obligation, then a newcomer, then the oldest `last_bb_at`). Fair.
- Small blind: the next player in that same big-blind order. Paying a small blind does not move `last_bb_at`, so the player who just posted it is still second in line and posts it again whenever somebody older is the big blind. `hands_since_sb` was kept and never read.
- Button (P3, `position_fairness` on in both Clusters): the member with the fewest lifetime buttons in the Cluster (`lightning_blind_ledger.btn_count`). A player whose lifetime count lags takes the button every hand until they catch up.

## Measured before (production, read only)

2026-11-10 12:54Z to 15:54Z: 8,439 hands in two Clusters, 76 players with 100 or more hands, 49,207 player hands, 5.95 seated on average (fair share of each seat: 16.8 per 100). Gaps are counted in each player's own hands.

|             | per 100 | per player   | back to back | gap p50 / p90 / max |
| ----------- | ------- | ------------ | ------------ | ------------------- |
| Big blind   | 16.81   | 13.9 to 21.0 | 1.3%         | 6 / 9 / 15          |
| Small blind | 16.83   | 12.9 to 20.1 | 28.5%        | 5 / 13 / 47         |
| Button      | 16.57   | 0.0 to 61.8  | 22.3%        | 4 / 12 / 217        |

Dan's own run (15:47Z to 15:49Z): small blind, small blind, big blind, -, -, small blind, -, small blind, small blind, big blind. The heaviest button holders took it 49% to 61% of their hands; others never held it.

## The rule now

Each blind and the button go to the player who has gone longest without it, counted in that player's own dealt hands.

- Big blind: unchanged.
- Small blind: the most hands since a small blind (`hands_since_sb`), then the big-blind order. Same key in `fn_lightning_match_plan` and in the barrier `fn_lightning_form_hand`.
- Button and the seats behind it: filled from the button backward by the most hands since the button (new `lightning_pool_slot.hands_since_button`), then the oldest `last_button_at` (never held first), then queue order. The cut-off is the next button, as at a ring table.
- `hands_since_button` is kept exactly like `hands_since_sb` (zero for the hand's button, one more for every other seat) and given back by the voided-hand trigger.
- The shadow snapshot and the engine's model (`LightningMatcherModel`, `LightningMatcherSnapshot`, `LightningShadowRunner`) carry the same keys; a snapshot without them is planned by the old rule, so a database and an engine on different days still agree.

The same model on a simulated 40-player pool reproduces production's old small-blind repeats (26 to 27%, gaps to 55) and, with the new rule, gives small blind repeats 0 to 0.025%, button 0.05% (a new table whose every candidate has just held it elsewhere cannot avoid one), every gap at most 11 and every player's share 15.6 to 17.9 per 100.

## Proof

- `server/src/lightning/LightningPositionFairness.test.ts`: the recency rule over three seeded pools (repeats under 0.2%, shares 15 to 18.5 per 100, gaps at most 13), the old rule shown failing the same pool, the exact small blind, button and fallback choices.
- `scripts/dev/test-lightning-matcher-parity.sh` section 14 (`scripts/dev/fixtures/lightning-position-fairness-parity.sql`): eighteen players dealt through the real matcher, barrier and terminal path on PostgreSQL 17 until each has thirty hands; no blind or button twice in a row, each share within two of hands / seats, counters exact, a voided pass gives them back, and the TypeScript port compared with the SQL on a mid-run plan.

## Delivery

`supabase/migrations/20261110175018_lightning_blinds_and_button_go_to_the_longest_waiting_player.sql` adds a column to `lightning_pool_slot` (ACCESS EXCLUSIVE on a table every formation writes), so it is a daily-window migration (`@install-window: daily-maintenance`, `@locks: public.lightning_pool_slot`) and installs at the next 04:00 America/Chicago break, with the engine model in the same window. The functions are patched in place by exact anchors (each must occur once or the transaction aborts); all eleven were checked against production on 2026-11-10 with a self-aborting dry run. Horses and humans are not distinguished anywhere. No money, seat or ledger row is written.
