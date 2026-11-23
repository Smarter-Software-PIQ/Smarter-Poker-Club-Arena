# 331657-digest-fixture-diamond-moves

Production Alerts fleet, PRIMARY run 2026-11-23T04:45Z. Read-only evidence from production (kuklfnapbkmacvwxktbh). No rows were written except `operational_alert_events.investigation`.

## The alerts

All rows below are `sp-daily-digest` `DailyDigest.big_diamond_move`, which reports every Diamond movement over 10,000 in `sp_daily_metrics.metrics.diamonds.big_movements`.

| row | digest day | lines | verdict |
| --- | --- | --- | --- |
| 269331 | 2026-10-23 | kingfish `diamond_spins_daily_net` 30,688 | real movement |
| 281562 | 2026-10-26 | kingfish `diamond_spins_daily_net` 11,840 | real movement |
| 331657 | 2026-11-02 | `Certbuyea4be4f2` `adjustment` 18,975; kingfish 16,520 | fixture leak + real movement |
| 339500 | 2026-11-03 | kingfish 1,632,920; `Certbuyee244fdf` `adjustment` 18,975 | real movement + fixture leak |
| 348143 | 2026-11-04 | `Certbuye787dd99` `adjustment` 18,975 | fixture leak |
| 446613 | 2026-11-20 | BarryWhite 5 purchases (3 x 26,250, 2 x 10,500) | real movement |
| 447286 | 2026-11-21 | kingfish 82,499; BarryWhite purchase 10,500 | real movement |

## Real movements, each reconciled to one receipt

Each Diamond Spins line is `fn_diamond_spin_settle_day` for the previous Chicago day, read from `diamond_spin_days`. In every case `settled_net = entry + mint - prizes`, the burn is 20% of `settled_net`, and exactly one `diamond_transactions` transfer carries `credited_net` with reference `diamond-spin-day:<owner>:<day>`.

| spin day | entries | prizes | movements | settled_net | burn | credited | wallet tx |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-22 | 38,610 | 250 | 102 | 38,360 | 7,672 | 30,688 | 9f6d6d4a |
| 2026-10-25 | 14,850 | 50 | 48 | 14,800 | 2,960 | 11,840 | 8667dfdf |
| 2026-11-01 | 25,050 (+100 mint) | 4,500 | 81 | 20,650 | 4,130 | 16,520 | 0f365861 |
| 2026-11-02 | 2,096,400 | 55,250 | 2,029 | 2,041,150 | 408,230 | 1,632,920 | 128fcd7d |
| 2026-11-20 | 108,073 (+100 mint) | 5,050 | 135 | 103,123 | 20,624 | 82,499 | 68de88e8 |

The 2026-11-02 outlier is 1,941 `Diamond Wheel Intake` entries (25 to 2,500 Diamonds each) by 242 players between 20:09 and 22:20 UTC; 1,995 of the 1,997 entry rows were horses. This is the owner-ordered horse Diamond Spins path (`server/src/services/HorseDiamondSpins.ts`, Dan 2026-10-18: a horse with no chips spins its own Diamonds into chips through `fn_horse_diamond_spins`, the public wheel function). It ran on the day the Diamond Arena was closed and its horses' cash seats were cashed out (`docs/changelog/2026-11-02-the-diamond-arena-closes-all-the-way.md`). These are horse purchases at the wheel's price, the same as a person's (CLAUDE.md 10.5). Counts: 1,997 entries + 32 prizes = 2,029 = `movement_count`.

BarryWhite's six purchases are `diamond_purchases` rows with status `completed`, live Stripe checkout sessions (`cs_live_*`), no refunds: Value 10,000+500 at $100 (x3) and Premium 25,000+1,250 at $250 (x3).

## The defect: certification fixtures in the digest

`Certbuy*` accounts are the Table Studio commerce certification's buyers (`ca-customization-cert-buyer-*@example.invalid`). They are funded with 18,975 Diamonds, buy, and are deleted by `cleanup_reserved_certification_account`, which removes their `diamond_transactions`, so the rows no longer exist. `fn_sp_daily_metrics_compute` had no fixture filter on `big_movements`, so the owner's digest reported a test fixture as a big money movement.

Fix (already installed): `20261105174204_digest_big_diamond_moves_skip_certification_fixtures.sql` adds `AND NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = dt.user_id AND au.email ~* '\.invalid$')`. It is in `schema_migrations`. The live function (md5 `defe7f21cf46a34c59ff1d374b455e25`) contains the guard. All four later migrations that touch the function patch it in place through `pg_get_functiondef`, so the guard survives them. `big_movements` has carried no `Cert*` line from 2026-11-05 through 2026-11-21. 2026-11-05 still shows a 20,475 `adjustment` in `given_by_source`, but no big-movement line for it.

## Hardening

1. **Regression test:** `tests/the-digest-big-diamond-moves-skip-certification-fixtures.law.test.ts`. With the fixing migration removed it fails 3 of 5; with it present it passes 5 of 5.
2. **Invariant:** the guard is in the owning function. The law refuses any later full redefinition that drops it, and refuses a guard that filters horses or a named player.
3. **Detection:** the digest attention rule itself, `sp-daily-digest` -> `operational_alert_events` with `target_task_id`. A fixture line would recur there.
4. **CI gate:** Client Unit Tests runs `tests/**` on every PR.

No migration. No money moved.
