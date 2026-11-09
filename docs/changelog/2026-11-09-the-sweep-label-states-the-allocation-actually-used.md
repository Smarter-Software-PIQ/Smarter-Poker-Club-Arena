# 2026-11-09 - The BBJ promo sweep label states the allocation actually used

## Summary

1. **Midway Union `5 / 20 / 75` split (live since `2026-11-08 21:43:21.501583+00`):**
   - Set directly on `public.ca_bbj_pool_policy` for the Midway Union pool (`pool_id = f9806a7f-e7a2-47d2-a676-36336e3a5337`, `standard_main = 0.05`, `standard_backup = 0.20`, `pivot_main = 0.05`, `pivot_backup = 0.20`).
   - Because `fn_bbj_allocate` reads `ca_bbj_pool_policy` on every hand, contributions have split `5% main / 20% backup / 75% promo` continuously since `2026-11-08 21:43:21.501583+00` (`25,291` hands, `7,513.55` drop, `5.0000% / 20.0000% / 75.0000%`, `0.0000` unallocated at `2026-11-09 05:12:23Z`).
   - The comments in `server/src/config/RakeConfig.ts` and `src/config/RakeConfig.ts` are updated to record the `2026-11-08` `5/20/75` instruction alongside the `2026-10-22` `10/30/60` history.

2. **Sweep note wording fix (`supabase/migrations/20261109010948_the_bbj_promo_sweep_label_states_the_allocation_actually_use.sql`):**
   - Previously, `public.fn_sweep_bbj_promo_all()` wrote a hardcoded `'BBJ promo slice (25% of contribution) swept from pool'` note on every `union_wallet_transactions` row (`tx_type = 'bbj_promo_sweep'`).
   - Adds `public.ca_bbj_rate_periods` (with RLS enabled and explicit `REVOKE ALL` / `GRANT SELECT` to `service_role`), binding a pool's single-rate effective window (`[effective_from, effective_to)`) to its authoritative migration or policy evidence:
     - `2026-10-23 02:42:45+00` to `2026-11-08 21:43:21.501583+00`: `main_rate = 0.10`, `backup_rate = 0.30` (`60%` promo, evidence: migrations `20261023024134, 20261023030641`).
     - `2026-11-08 21:43:21.501583+00` to `NULL`: `main_rate = 0.05`, `backup_rate = 0.20` (`75%` promo, evidence: `ca_bbj_pool_policy @ 2026-11-08 21:43:21.501583+00`).
   - Adds `public.fn_bbj_promo_window_share(p_pool_id, p_since, p_until)`, `public.fn_bbj_last_promo_sweep_at(p_union_id, p_club_id)`, and `public.fn_bbj_sweep_note(p_pct, p_suffix)`.
   - A sweep receives a percentage label (`'BBJ promo slice (<pct>% of contribution) swept from pool'`) **only** when:
     1. `p_since` is not null,
     2. Exactly one evidenced single-rate period in `ca_bbj_rate_periods` (or a flat-rate `ca_bbj_pool_policy` row with `updated_at <= p_since`) covers the entire window `[p_since, p_until]`,
     3. Total drop in `bbj_contributions` across `(p_since, p_until]` is `>= 5.00` chips,
     4. Both temporal halves of the window agree within `0.5` percentage points when both carry contributions, and
     5. Realized main share (`(drop - backup - promo) / drop`, derived from `idx_bbj_contrib_pool_facts` without heap fetches) and realized backup share (`backup / drop`) each agree with the governing policy's `main_rate` and `backup_rate` within `0.05` percentage points.
   - The printed percentage is `(1 - main_rate - backup_rate) * 100` from the policy period, never a rounded empirical ratio.
   - Windows without a single evidenced governing rate (including the pre-`2026-10-23` era where the pool crossed the `100k` pivot and per-hand balance snapshots before `2026-09-04` do not exist), straddle windows, windows with drop `< 5.00`, and anomalous windows return `NULL` and receive neutral wording: `'BBJ promo slice swept from pool'`.
   - Updates `fn_sweep_bbj_promo(uuid)` and `fn_sweep_bbj_promo_all()` to label future sweeps dynamically (preserving the `20261015094402` `NOWAIT` lock order and `fn_ca_declare_ledger` declarations) and backfills `union_wallet_transactions.notes` for existing `bbj_promo_sweep` rows without touching any amount, balance, timestamp, or transaction identity.

3. **Separate anomaly record (`docs/BBJ-ALLOCATION-ANOMALY-2026-08.md`):**
   - Documents the August-September 2026 pre-residue-carry rounding bands (`~24%` promo across `1,414` sweeps from `2026-08-17` to `2026-08-30` and `~48%` promo across `224` sweeps from `2026-09-01` to `2026-09-02`) separately for review, with zero financial mutations.

## Verification Probe (Self-Aborting Transaction on Production)

Executed against `kuklfnapbkmacvwxktbh` (`2026-11-09 05:18Z`):

- `total`: `20,395` `bbj_promo_sweep` rows
- `labelled`: `3,837` (`3,763` at `60% of contribution`, `74` at `75% of contribution`)
- `neutral`: `16,558` (`'BBJ promo slice swept from pool'`)
- `stale_25`: `0`
- `sum(amount)` before and after: `623,447.3200` (unchanged)
