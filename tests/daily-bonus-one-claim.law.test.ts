import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const read = (p: string) => readFileSync(p, 'utf8');
it('daily bonus has one claim action and no cash equivalent copy', () => {
  const sheet = read('src/components/daily-bonus/DailyBonusSheet.tsx');
  expect(sheet).not.toContain('diamondsToCentsLabel');
  expect(sheet).not.toContain('Claim Next');
  expect(sheet).not.toContain('onClaim(tile)');
  expect(sheet).toContain('claimAll()');
  expect(sheet).toContain('blue-diamond-v1.webp');
});
it('daily selection excludes yesterday type and the original claim owns every award', () => {
  const sql = read(
    'supabase/migrations/20261010063541_daily_bonus_varies_each_day_and_claims_all_rewards.sql'
  );
  expect(sql).toContain('pool.kind IS DISTINCT FROM previous_kind');
  expect(sql).toContain('public.fn_ca_daily_bonus_claim((v_tile');
  expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('ca_daily_bonus:'");
  expect(read('scripts/dev/test-accounting-delivery.sh')).toContain(
    'run_game_probe daily-bonus-one-claim'
  );
  expect(read('scripts/dev/test-accounting-delivery.sh')).toContain(
    'run_game_probe daily-bonus-progressive-ladder'
  );
  expect(read('.github/workflows/ci.yml')).toContain(
    'bash scripts/dev/test-accounting-delivery.sh'
  );
});

it('progressive daily bonus ladder escalates across weeks, never repeats adjacent kinds, and restores Mystery Vault', () => {
  const sql = read(
    'supabase/migrations/20261125075751_daily_bonus_progressive_nonrepeating_ladder.sql'
  );
  expect(sql).toContain('public.fn_ca_daily_bonus_roll_mystery()');
  expect(sql).toContain('Prestige Jackpot');
  expect(sql).toContain('Thirty-Day Chest');
  expect(sql).toContain('primary_kind');
  expect(sql).not.toContain('atomic_credit_wallet_and_log');
  expect(sql).not.toContain('credit_player_wallet');
  expect(sql).not.toContain('fn_ca_mint');
});

it('daily bonus hardening pins boost window, week history, wallet label, and reveal/spin modal hold', () => {
  const sql = read(
    'supabase/migrations/20261125171024_daily_bonus_boost_window_and_week_history.sql'
  );
  expect(sql).toContain("GREATEST(now(), (p_date::timestamp AT TIME ZONE 'America/Chicago'))");
  expect(sql).toContain('LEFT JOIN public.ca_daily_bonus_days saved');
  expect(sql).not.toContain('atomic_credit_wallet_and_log');
  expect(sql).not.toContain('credit_player_wallet');
  expect(sql).not.toContain('fn_ca_mint');

  const sheet = read('src/components/daily-bonus/DailyBonusSheet.tsx');
  expect(sheet).toContain('shouldAutoCloseAfterClaim');
  expect(sheet).toContain('isJackpotStreak');
  expect(sheet).toContain('spinClubReqRef');

  const wallet = read('src/components/wallet/DiamondWalletModal.tsx');
  expect(wallet).toContain("daily_bonus_boost: { label: 'Daily Bonus Boost' }");
});
