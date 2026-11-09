# BBJ Allocation Anomaly — August–October 2026 (Investigation Record)

**Status:** Measurement and suspicion recorded for separate review. No historical amounts, balances, timestamps, or transaction identities have been altered.

---

## 1. How this surfaced

While preparing migration `20261109010948_the_bbj_promo_sweep_label_states_the_allocation_actually_use.sql` to replace the hardcoded `'BBJ promo slice (25% of contribution) swept from pool'` note on `public.union_wallet_transactions` (`tx_type = 'bbj_promo_sweep'`), every historical 5-minute sweep window on the Midway Union pool (`pool_id = f9806a7f-e7a2-47d2-a676-36336e3a5337`, `union_id = fade0000-0000-0000-0000-000000000001`) was classified against the platform's configured BBJ splits (`50 / 25 / 25` standard, `25 / 25 / 50` pivot, `10 / 30 / 60` from `2026-10-23 02:42:45+00`, and `5 / 20 / 75` from `2026-11-08 21:43:21.501583+00`).

Across `20,376` union sweep windows (`2026-08-15` through `2026-11-08`), `2,333` windows did not match any configured split within `±0.05` percentage points on both `main_portion` and `backup_portion` (`1,813` windows with total drop `>= 5.00` chips where both temporal halves agreed within `0.5` percentage points, plus `520` windows with total drop `< 5.00` or half-window rate changes).

Under the tightened `ca_bbj_rate_periods` proof rule in `20261109010948`, all pre-October windows and all anomalous or low-drop windows receive neutral wording (`'BBJ promo slice swept from pool'`) rather than a rounded empirical percentage.

---

## 2. Measured bands in `bbj_contributions`

Querying `public.bbj_contributions` on the Midway Union pool (`f9806a7f-e7a2-47d2-a676-36336e3a5337`) across the anomalous sweep windows shows two primary clusters:

### Band A — `2026-08-17 05:20Z` to `2026-08-30 15:25Z` (`~24%` promo)

- **Sweep windows:** `1,414` windows (of `1,813` non-matching stable windows with drop `>= 5.00`)
- **Hands (`bbj_contributions` rows):** `81,968`
- **Total drop (`sum(amount)`):** `28,399.51` chips
- **Main (`sum(main_portion)`):** `14,239.04` chips (`50.1383%`)
- **Backup (`sum(backup_portion)`):** `7,300.68` chips (`25.7071%`)
- **Promo (`sum(promo_portion)`):** `6,815.63` chips (`23.9991%`)
- **Unallocated (`sum(amount - main_portion - backup_portion - promo_portion)`):** `44.16` chips (`0.1555%`)

### Band B — `2026-09-01 05:50Z` to `2026-09-02 22:00Z` (`~48%` promo)

- **Sweep windows:** `224` windows
- **Hands (`bbj_contributions` rows):** `18,619`
- **Total drop (`sum(amount)`):** `6,412.88` chips
- **Main (`sum(main_portion)`):** `1,695.01` chips (`26.4313%`)
- **Backup (`sum(backup_portion)`):** `1,636.99` chips (`25.5266%`)
- **Promo (`sum(promo_portion)`):** `3,080.88` chips (`48.0421%`)
- **Unallocated (`sum(amount - main_portion - backup_portion - promo_portion)`):** `0.00` chips

### Band C — Smaller transitional / mixed windows (`2026-08-17` to `2026-11-08`)

- **Remaining `175` windows** with drop `>= 5.00` and stable halves (including `37` windows inside the `2026-10-23` `10/30/60` period where small-drop cent-rounding shifted `main` or `backup` by `0.06–0.25` percentage points, plus `17` windows where first/second halves differed by `> 0.5` percentage points).
- **`520` windows** where total drop `< 5.00` chips (`63` of which occurred after `2026-10-23 02:42:45+00`).

---

## 3. Per-hand mechanics observed in Band A (`2026-08-17` to `2026-08-30`)

Inspecting individual `bbj_contributions` rows during `2026-08-17` to `2026-08-30` by `amount` (`drop`) shows deterministic per-hand truncation/rounding before the stateful cent-residue carry (`fn_bbj_allocate`, `2026-09-02` Chip Accounting Standard) was introduced:

| Drop (`amount`) |    Hands | `main_portion` | `backup_portion` | `promo_portion` | Sum of portions | Unallocated per hand | Realized `%` (`main / backup / promo`)            |
| --------------: | -------: | -------------: | ---------------: | --------------: | --------------: | -------------------: | ------------------------------------------------- |
|          `0.12` | `12,188` |         `0.06` |           `0.03` |          `0.03` |          `0.12` |               `0.00` | `50.00% / 25.00% / 25.00%`                        |
|          `0.15` | `14,721` |         `0.08` |           `0.04` |          `0.03` |          `0.15` |               `0.00` | `53.33% / 26.67% / 20.00%`                        |
|          `0.25` |  `4,416` |         `0.12` |           `0.06` |          `0.06` |          `0.24` |               `0.01` | `48.00% / 24.00% / 24.00%` (`+4.00%` unallocated) |
|          `0.30` | `25,319` |         `0.15` |           `0.08` |          `0.07` |          `0.30` |               `0.00` | `50.00% / 26.67% / 23.33%`                        |
|          `0.60` | `18,904` |         `0.30` |           `0.15` |          `0.15` |          `0.60` |               `0.00` | `50.00% / 25.00% / 25.00%`                        |

### Why this matters

1. **Not a configured `24%` or `48%` policy:** No migration or policy row ever configured `24%` or `48%` promo. On `0.30` drops (the single largest stake bucket, `25,319` hands), `0.30 * 0.25 = 0.075` rounded `backup_portion` up to `0.08` (`26.67%`) and left `promo_portion` at `0.07` (`23.33%`). On `0.15` drops (`14,721` hands), `0.15 * 0.50 = 0.075` rounded `main_portion` to `0.08` (`53.33%`), `0.15 * 0.25 = 0.0375` rounded `backup_portion` to `0.04` (`26.67%`), and left `promo_portion` at `0.03` (`20.00%`).
2. **Unallocated cent on `0.25` drops (`44.16` chips across `4,416` hands):** On `0.25` drops in August 2026, `floor`-style rounding produced `0.12 + 0.06 + 0.06 = 0.24`, leaving `0.01` per hand (`44.16` chips total) in `amount - (main_portion + backup_portion + promo_portion)`.
3. **Resolved in current allocator (`fn_bbj_allocate`):** Since the Chip Accounting Standard allocator (`fn_bbj_allocate`) with stateful residue carry (`main_residue`, `backup_residue`, `promo_residue` on `bbj_pools`) took effect, `main_portion + backup_portion + promo_portion = amount` holds on 100% of hands (`0.0000` unallocated), and window ratios converge within `0.01%` of the policy split once total drop reaches `5.00` chips.

---

## 4. Disposition

- **No historical balances or amounts touched:** All `bbj_contributions`, `bbj_pools`, `union_wallets`, `chip_ledger`, and `union_wallet_transactions.amount` / `balance_after` rows remain untouched.
- **Sweep note wording:** All `2,333` windows (along with all pre-`2026-10-23` windows where the two-regime `100k` pivot cannot be disambiguated from authoritative period records) receive the neutral description `'BBJ promo slice swept from pool'` via `fn_bbj_promo_window_share` returning `NULL`.
- **Open question for owner / accounting phase:** Whether the `44.16` chips of August 2026 `0.25`-drop rounding difference is already absorbed in the Phase 3 epoch/opening baseline (see `docs/HANDOFF-CHIP-ACCOUNTING-CURRENT-STATE.md` §16 / §23) or warrants a dedicated historical note.
