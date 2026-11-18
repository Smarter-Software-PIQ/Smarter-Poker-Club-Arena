# Lightning: A Thin Pool Deals Four-Handed

Owner direction (Dan, 2026-11-10 15:31 Chicago), follow-up item 4: form tables sooner when the pool is thin. Coordinator requirements applied: four-player minimum under races, concurrency proof, fairness at four and five, a hard dependency on the position fairness migration, and an engine model that follows whichever matcher image is live.

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

- `supabase/migrations/20261110214134_lightning_a_thin_pool_deals_four_handed.sql` is a **daily-maintenance window file**. It patches five functions by exact anchor:
  - `fn_lightning_formation_sizes`
  - `fn_lightning_match_plan`: sizing, the pool guard, the newcomer hold and the group's 1.5 s test
  - `fn_lightning_form_hand`: a direct caller may ask for four, and gets `WAITING_FOR_FIFTH_PLAYER` inside 1.5 s
  - `fn_lightning_instance_begin_dealing`: deals 4 to 6
  - `fn_lightning_config`: `thin_pool_four_handed: true`
- Every anchor must occur exactly once or the transaction aborts.
- **It requires 20261110173033 (position fairness) and refuses without it.** Its first statement checks for that file's installed image (the `hands_since_button` column and the `BY RECENCY (20261110)` text in the matcher and the barrier). It raises before changing anything, so the file stays queued. A four-handed table is only fair with that rule.
- **Order in the window.** It declares `-- @locks: public.lightning_pool_slot`, the fairness file's relation, so `scripts/ci/install-window-migrations.mjs` sends it in the same group, after 20261110173033, in the same run. The file itself takes no table lock; the declaration is for that order.
- **Edits don't collide.** Checked read-only against production's current images: each file's anchors occur exactly once in the current image, after the other file alone, and before it.
- **The engine follows the database.**
  - `LightningMatcherModel` plans four-handed tables only when `fn_lightning_config` says `thin_pool_four_handed: true` (`lightningMatcherParams`, exactly `true`).
  - An engine reading a database without this file plans five or six only, and an engine without this model change ignores the key. Whichever activates first, the engine's plan is the live matcher's.
  - The engine's matcher snapshot is not changed; its key set is validated strictly, so a new key there would have broken an older engine.
  - `LightningClusterWorker` adds a deadline pass at the four's 1.5 s.
  - `LightningMatcherSim` lists players in hands as the database does, counts table sizes, and takes a `fourHanded` option.
- **Activation.** The database part installs at the next daily window after fairness. The engine part reaches production only in a release whose candidate the release owner selects; nothing here promises inclusion.

## Proof

- `scripts/dev/test-lightning-matcher-parity.sh` on PostgreSQL 17 over the real chain:
  - **Refusal:** on the image without position fairness the file is refused and changes nothing (match_plan and config md5 unchanged).
  - **Section 15:**
    - a thin four is formed, dealt and settled by the real barrier, `begin_dealing` and settlement, with a button and both blinds
    - inside 1.5 s nothing forms, from the plan or from a direct caller
    - ten deal 6+4, 22 deal 6+6+6+4, and a healthy 28 keeps sixes
    - five is unchanged at one second, and three never deal
    - in twelve passes of four and fifteen of five, no blind or button repeats back to back, and every share is within one
  - **Section 15R, real concurrent backends:**
    - four matcher passes at once on ten aged players form exactly 6+4
    - three barrier calls at once for the same four form one hand
    - a direct call for three forms nothing
    - nobody is seated twice, and every hand has four to six players
  - **Sections 12 and 13A:** section 12 admits four only in a pool of at most 24, and section 13A (the entry big blind) is unchanged.
  - **Parity:** the TypeScript port decides exactly what `fn_lightning_match_plan` decides: `PARITY 21 fixtures 64 groups identical`.
- `server/src/lightning/LightningThinPoolFourHanded.test.ts` covers the same rule, the newcomer hold, and the old rule when the database flag is absent.
- Server Lightning suite (54 files) passes; `tsc` is clean.
- **One pin moved:** `LightningFormWorker.test.ts` gains the deadline pass at 1950 ms. Tests that construct params without the flag keep the five-or-six rule unchanged.

## Blind fairness at four and five (simulated, the same plan)

Big blinds per 100 hands, standard deviation across players, rule without and with four-handed tables:

| Pool | std dev without | std dev with | longest big-blind gap without | with |
| ---- | --------------- | ------------ | ----------------------------- | ---- |
| 12   | 1.74            | 1.83         | 13                            | 14   |
| 16   | 1.60            | 1.95         | 14                            | 15   |
| 20   | 1.83            | 1.96         | 16                            | 16   |
| 25   | 1.88            | 1.72         | 17                            | 17   |

The parity fixtures above prove the recency rule itself (no repeats, shares within one) at four and five.

Horses are players (CLAUDE.md 10.5): nothing here reads a horse marker. No money, seat or ledger row is written by the migration.
