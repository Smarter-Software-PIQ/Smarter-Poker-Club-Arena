# A cash hand never waits on a shared row (incident 075013fd)

**Severity:** critical, money integrity. **Window:** 2026-11-16 23:57 UTC to
2026-11-18 04:59 UTC. **Alert:** `LightningHandHost.post_commit_obligations_pending`,
9,087 source alerts, reliability incident `075013fd`, drift incident `e842cb87`.

## What players saw

Every hand's financial follow-up (rake, BBJ drop, promo play-through, pending
add-ons) runs after the hand commits, in one call to
`fn_ca_process_hand_post_commit_obligations`. Hands on the seven Midway Union
Lightning tables started finishing that follow-up late from about 19:00 UTC on
the 17th, and the lag grew to 6,410 s by 00:00 UTC on the 18th.

**No money was lost, doubled or skipped.** Re-measured read-only after the
backlog drained:

| Obligation (7 Midway tables, 48,029 hands) | Hands | Amount | Missing / duplicate / mismatch |
| --- | --- | --- | --- |
| Rake | 21,347 | 41,289.43 | 0 / 0 / 0 |
| BBJ drop | 21,223 | 7,867.20 | 0 / 0 / 0 |
| Pending add-ons | 73 | 29,200.00 | 0 / 0 / 0 |

Across all 197 tables, the 12,486 hands that finished late were all receipted.
I1-I9 were 0, BBJ booked equalled BBJ received (16,273.57), and the Midway union
rake ledger drift was 0.00.

## Why it broke, one cause at a time

1. **Promo-fee triggers read whole histories inside the hand's transaction.**
   Hands carrying promo play-through went from a 0.4 s p95 to 140 s, while
   hands with no obligations stayed at 0.3 s. Fixed before this lane started:
   #11225, #11229, #11231, #11237.

2. **Every raked hand in the union wrote one row.** `atomic_distribute_rake`
   updated `union_wallets.rake_wallet`, Midway's single union row, and held it
   until the follow-up committed. A tournament settlement held the same row
   for about 45 s per attempt, so every cash table queued behind it.
   - This broke the owner's ruling that a tournament never affects a cash game.
   - It was the third time this pattern had shipped: `clubs.total_rake` on
     2026-09-29 and `club_wallets` on 2026-10-02 (1,518 timeouts) were each
     fixed for one row only.
   - The BBJ union pool (`bbj-pool:` lock plus a `bbj_pools` row) and
     `union_wallets.insurance_wallet` had the same shape.

3. **The follow-up queued without a bound.** The function took the per-table
   lock with no `lock_timeout` and only then checked whether an earlier hand
   was still pending.
   - Lightning hosts commit many hands per table at once, so every later hand
     waited on one slow hand until the 8 s statement timeout, holding a
     connection the whole time.
   - Each host then re-walked the same predecessor chain, and the RPC ran 38
     million times.
   - It filed one critical alert per hand: 1,736 deliveries.
   - The stranded watchdog paged only after 10 minutes, at 23:30 UTC, more than
     four hours after the slowdown began.

4. **The alert closer could not close.** `zz_ca_alert_resolution_reaches_the_incident`
   re-checked the whole drift incident (7,693 member events) for every alert it
   resolved.
   - Job 354 timed out on every run from 02:44 UTC and rolled back everything it
     had resolved.
   - Job 227 timed out every hour for the same reason.
   - 5,661 settled alerts stayed open.

5. **Two production-only DDL guards refused merged migrations.** Both migrations
   had passed CI.
   - #11256 was refused by the applier's stale-pin guard:
     `original_erased_cash_base_discharge` pins `fn_ca_tally_balance_move`.
     It was reverted in #11260 and re-landed as #11270.
   - #11266 was refused by `fn_ca_money_rpc_registry_guard`, because the new
     banker was unregistered. Fixed by #11288.
   - Neither guard runs before merge.

6. **A latent production defect.** Every union net insurance payout has been
   refused since the 2026-09-04 constraint `union_wallets_insurance_wallet_nonneg`,
   because the upsert's proposed INSERT row is checked before the conflict.
   Insurance is unused today.

## What fixed each one (installed and verified in production)

| PR | Fix | Installed |
| --- | --- | --- |
| #11270 (re-land of #11256) | Cash rake waits in its own row (`cash_rake_pending`) and is banked by the hand's own continuation, NOWAIT on the union wallet | 12:04 UTC |
| #11273 | The incident roll-up runs once per statement; job 354 commits in pages, and the resolver runs first | 13:26 UTC |
| #11266 + #11288 | BBJ drop and insurance legs wait in `hand_bank_obligation_pending`, banked to the hand-time union. The insurance-bank try-lock stops payout overcommit. Stuck rows page critical within 10 minutes. The insurance upsert is fixed | 14:16 / 14:21 UTC |
| #11269 | Unlocked predecessor answer before any lock; 250 ms table try-lock; 1 s bounded row waits; one helper per table walks the predecessor chain; one alert per table stall episode, not per hand. New answers are opt-in per request, so old engines and rollbacks only see `predecessor_pending` | 15:05 UTC (database part; the engine part ships with the next daily cutover) |

## What stops each one coming back

- **Shared-row writes on a hand's money path** (#11281, G1). Any blocking write,
  `FOR UPDATE` or exclusive advisory lock on a union-, club- or pool-keyed row,
  reachable from the hand commit, the submission or the follow-up, is refused.
  - It runs as a live-catalog check in CI and as a refusal inside the applier,
    with a reasoned allowlist for existing violations.
  - Against today's production it flagged exactly the 14 writes this incident
    removed.
- **Slow follow-ups before they cascade** (#11281, G2). A per-table lag watch
  warns at a 2 s p95 (the owner's hand-gap limit) and goes critical at 15 s.
  Replayed against the 17th, it would have warned at 15:00 UTC, four hours
  before the cascade.
- **Production-only DDL guards before merge** (#11289). Production's own event
  triggers (13 of 21) and the applier's stale-pin guard run against a
  restored copy of the production schema for every changed migration.
  - Both originals refused tonight fail it.
  - Both fixed versions pass it.
- **Quadratic incident roll-up** (#11273). A native test resolves 5,000 alerts
  against an 8,000-member incident in under 1 s, where the old trigger timed
  out at 120 s.
- **The convoy** (#11269). A native proof puts one slow hand ahead of 24 later
  hands. Before: 25 statement timeouts. After: 0, with every hand applied once
  and in order.

## Still open (named, not hidden)

- The between-hands gap (the owner's 2 s limit) is measured by the hand-delay
  lane, not here. Follow-up lag is now p99 0.92 s (14:22-14:45 UTC, 851 hands);
  it was 4.3 s at 05:00 UTC. G2 watches it per table from now on.
- Tournament tables still wait up to 4 s on the global tournament settlement
  lane (`f06_wait_table_lane`, about 8 PostgREST 55P03 an hour, as before the
  incident). One tournament's settlement pauses every tournament table, which
  breaks tournament isolation. Not caused by this incident, but named here.
- The Free Buy hold stays on. Lifting it is tied to the hand-delay lane's
  between-hands measurement. Evidence from this lane: a Midway satellite MTT
  settled at 13:18 UTC with cash follow-up lag flat at a 0.76 s maximum.
- `fn_project_hand_side_effects` still waits on the table lock without a bound.
  It is the projection worker's own path; documented in #11269.
- Allowlisted G1 violations that are real follow-up work:
  - seat-leave spin booking locks `spin_bonus_pools`;
  - a tournament status change takes club/union wallet locks inside a hand commit.
- `smarter_private.original_erased_cash_base_discharge` refuses on 12 stale pins
  and is inert. Its owner needs to requalify it.
- The window-rehearsal check has failed on every PR since #11276 (supabase_admin
  password); reported on #11276.
