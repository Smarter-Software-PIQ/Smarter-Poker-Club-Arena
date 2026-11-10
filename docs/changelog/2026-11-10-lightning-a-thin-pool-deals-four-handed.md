# Lightning: A Thin Pool Deals Four-Handed

Owner direction (Dan, 2026-11-10 15:31 Chicago), follow-up item 4: form tables sooner when the pool is thin.

## The rule

- Six ready players deal at once; five deal after one second from the fifth (latest) arrival. Both unchanged.
- **New:** four ready players deal four-handed when the latest of them has waited **1.5 seconds** with no fifth, **and** the Cluster's whole pool (every open-pool player `fn_lightning_player_legality` lists, free or still in a hand) is **at most 24**.
- Never fewer than four. A healthy pool keeps six as the target, so short tables cannot fragment it.
- New players are still the big blind first. The hold that keeps a newcomer for the next pass's big blind is decided without the four-handed size, so a four never holds a newcomer out of a five or six. The newcomer posts an entry big blind exactly as before, and a pass that holds a newcomer deals no four-handed table.
- Blinds, button and the position fairness rule (20261110173033) scale to four: `fn_lightning_form_hand` already seats btn, sb, bb and co at four.

## Measured (production, read only)

Every player of the hands formed in minutes 0, 15, 30 and 45 of each hour, 2026-11-09 15:00Z to 2026-11-10 21:30Z. `waited_ms` is pool entry to formation.

| Hour's players seen | wait p50       | p90          | p99           | over 3 s     |
| ------------------- | -------------- | ------------ | ------------- | ------------ |
| 80 to 88            | 0.38 to 0.45 s | 1.2 to 1.5 s | 1.9 to 3.3 s  | 0.15 to 1.2% |
| 40 to 54            | 0.63 to 1.09 s | 1.6 to 2.9 s | 5.0 to 10.4 s | 2.2 to 8.8%  |

Hours 06 to 09Z and 14 to 16Z were the tournament settlement lock storm (fixed by 20261110160345) and are not the pool's doing. Five-handed hands were 0 to 5% of hands.

A player's time in a hand, formation to release (7,825 player-hands, 17:30Z to 21:30Z): p10 2.7 s, p50 3.4 s, p70 7.2 s, p80 13.0 s, p90 28.8 s, p99 68.4 s. A free player waits on other players' hands, and a thin pool often leaves four ready players idle for a fifth.

## Simulated

The engine's own simulator (`LightningMatcherSim`, the same plan, 20,000 hands, 250 ms passes, fast folds, sit-outs, arrivals and departures), origin/main against this change:

| Pool | wait p95 before / after | p99 before / after | hands per hour before / after | four-handed |
| ---- | ----------------------- | ------------------ | ----------------------------- | ----------- |
| 12   | 16.8 / 9.7 s            | 31.4 / 22.4 s      | 427 / 510                     | 31%         |
| 16   | 8.8 / 5.5 s             | 21.1 / 13.6 s      | 593 / 679                     | 20%         |
| 20   | 5.1 / 4.5 s             | 10.9 / 7.0 s       | 799 / 859                     | 13%         |
| 25   | 4.1 / 3.9 s             | 6.2 / 5.5 s        | 1,029 / 1,039                 | 5.5%        |
| 40   | 2.7 / 2.7 s             | 4.0 / 3.9 s        | 1,618 / 1,626                 | 0.2%        |

The median rises slightly in a thin pool (20 players: 1.38 s to 1.46 s), because a few players now wait the 1.5 s for a fifth before a four deals.

## Where it lives

- `supabase/migrations/20261110214134_lightning_a_thin_pool_deals_four_handed.sql` patches four functions by exact anchor:
  - `fn_lightning_formation_sizes`
  - `fn_lightning_match_plan`: sizing, the pool guard, the newcomer hold and the group's 1.5 s test
  - `fn_lightning_form_hand`: a direct caller may ask for four, and gets `WAITING_FOR_FIFTH_PLAYER` inside 1.5 s
  - `fn_lightning_instance_begin_dealing`: deals 4 to 6
- Every anchor must occur exactly once or the transaction aborts. It takes no table lock and is applied on merge.
- **Order with the position fairness file (20261110173033, queued for the 03:30 window):** checked read-only against production's current images before merge. Each file's anchors occur exactly once in the current image, after the other file alone and before it, so either may install first. The parity harness installs fairness, then this file.
- **Engine model (live at the 04:00 America/Chicago engine release):**
  - `LightningMatcherModel`: `LIGHTNING_FOUR_HANDED_WAIT_MS`, `LIGHTNING_FOUR_HANDED_POOL_MAX`, `lightningPassSizes`, and the group's 1.5 s test
  - `LightningClusterWorker`: a deadline pass at the four's 1.5 s, as at the five's second
  - `LightningMatcherSim`: lists players in hands as the database does, and counts table sizes
- Until the engine release the database decides, since it forms every hand, and the worker's routine pass serves the 1.5 s.

## Proof

- `scripts/dev/test-lightning-matcher-parity.sh`, section 15, on PostgreSQL 17 over the real chain:
  - a thin four is formed, dealt and settled by the real barrier, `begin_dealing` and settlement, with a button and both blinds
  - inside 1.5 s nothing forms, from the plan or from a direct caller
  - ten deal 6+4, 22 deal 6+6+6+4, and a healthy 28 keeps sixes
  - five is unchanged at one second, and three never deal
  - in twelve passes of four and fifteen of five, no blind or button repeats back to back, and every share is within one
- Section 12 now admits four only in a pool of at most 24, and section 13A (the entry big blind) is unchanged.
- The TypeScript port decides exactly what `fn_lightning_match_plan` decides: `PARITY 21 fixtures 64 groups identical`.
- `server/src/lightning/LightningThinPoolFourHanded.test.ts` covers the same rule plus the newcomer hold.
- Four pins moved in the same commit, by the owner's change of rule. Each now admits four only when the pool is at most 24:
  - `LightningFormWorker.test.ts` (the deadline pass at 1950 ms)
  - `ANewPlayersFirstLightningHandIsTheBigBlind.law.test.ts`
  - `ALightningConversionSeatIsNotANewcomer.law.test.ts`
  - `tests/lightning-matcher-parity.test.ts`

Horses are players (CLAUDE.md 10.5): nothing here reads a horse marker. No money, seat or ledger row is written by the migration.
