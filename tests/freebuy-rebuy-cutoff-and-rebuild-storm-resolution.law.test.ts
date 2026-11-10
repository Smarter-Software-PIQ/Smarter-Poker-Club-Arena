import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = resolve(
  __dirname,
  '../supabase/migrations/20261109212210_freebuy_rebuy_cutoff_and_rebuild_storm_resolution.sql'
);
const WATCH_MIGRATION_PATH = resolve(
  __dirname,
  '../supabase/migrations/20261110000927_freebuy_watch_jsonb_array_length_and_audit_resolution.sql'
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');
const watchSql = readFileSync(WATCH_MIGRATION_PATH, 'utf8');

describe('freebuy rebuy cutoff parity and rebuild storm resolution law (20261109212210)', () => {
  it('declares a live-proof header and runs inside a single bounded transaction', () => {
    expect(sql).toMatch(/^-- @live-proof:\s+position\('rebuyLevels'/m);
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '2s';");
    expect(sql).toContain("SET LOCAL statement_timeout = '8s';");
  });

  it('steps down rebuyLevels and NEW.rebuy_levels with late_reg_levels when stripping repeated opening levels', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_ca_schedule_level_clock_floor()');
    expect(sql).toContain(
      "IF coalesce(NEW.config->>'rebuyLevels','')=coalesce(NEW.config->>'lateRegistrationLevels','') THEN"
    );
    expect(sql).toContain("NEW.config:=jsonb_set(NEW.config,'{rebuyLevels}',to_jsonb(v_late));");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_ca_tournament_level_clock_floor()');
    expect(sql).toContain(
      'IF coalesce(NEW.rebuy_levels,0)=NEW.late_reg_levels THEN\n         NEW.rebuy_levels:=public.fn_ca_repeated_levels_late_reg(NEW.blind_structure,NEW.rebuy_levels);'
    );
  });

  it('backfills only active schedules and unstarted tournaments where late_reg_levels=11 and rebuy_levels=12', () => {
    const backfill = sql
      .split('DO $backfill_rebuy_cutoff$')[1]
      .split('$backfill_rebuy_cutoff$;')[0];
    expect(backfill).toContain("coalesce(config->>'lateRegistrationLevels', '') = '11'");
    expect(backfill).toContain("coalesce(config->>'rebuyLevels', '') = '12'");
    expect(backfill).toContain("PERFORM set_config('app.lock_level_clock', 'on', true);");
    expect(backfill).toContain('started_at IS NULL');
    expect(backfill).toContain('late_reg_levels = 11');
    expect(backfill).toContain('rebuy_levels = 12');
    expect(backfill).toContain("PERFORM set_config('app.lock_level_clock', '', true);");
  });

  it('includes GameServer.tournament_dark_after_rebuild in fn_ca_alert_resolution_reaches_the_incident and proves all 5 members before closing b4175ad4', () => {
    const patch = sql.split('DO $patch$')[1].split('$patch$;')[0];
    expect(patch).toContain(
      "NEW.source IN ('Tournament.atomic_finish_refused','fn_ca_bust_backlog_page','GameServer.tournament_dark_after_rebuild')"
    );
    expect(patch).toContain(
      "HAVING NEW.source NOT IN ('fn_ca_bust_backlog_page','GameServer.tournament_dark_after_rebuild')"
    );

    const original = sql.split('DO $original$')[1].split('$original$;')[0];
    expect(original).toContain("id='b4175ad4-a1bd-42bd-b5e1-3a060809ce60'");
    expect(original).toContain(
      "a.resolved AND a.source='GameServer.tournament_dark_after_rebuild'"
    );
    expect(original).toContain(
      'original.occurrences=5 AND member_count=5 AND distinct_alerts=5 AND all_resolved'
    );
    expect(original).toContain("closure_basis='verified_remeasured'");
  });

  it('revokes public/browser execute on fn_ca_free_buy_transition_audit_guard and moves no chips', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_free_buy_transition_audit_guard() FROM PUBLIC, anon, authenticated;'
    );
    expect(watchSql).toContain(
      'coalesce(jsonb_array_length(public.fn_sp_midway_free_buy_watch()), 0) > 0'
    );
    expect(watchSql).toContain(
      'coalesce(jsonb_array_length(public.fn_sp_midway_free_buy_watch()), 0) = 0'
    );
    expect(sql).not.toMatch(/INSERT INTO public\.chip_ledger/i);
    expect(sql).not.toMatch(
      /UPDATE public\.(club_members|union_wallets|wallets|tournament_escrow)\b/i
    );
  });
});
