import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Owner rule 2026-11-05: "A built event must match its schedule", and an
// unstarted, horse-only, wrongly-shaped Midway Free Buy is rebuilt to it.
// The database refuses a wrong build (an AFTER ROW trigger reading the same
// two format functions as the digest watch), and the scheduler's own sync pass
// rebuilds a wrongly-shaped occurrence through the platform's one cancellation
// authority. No event id is ever an exception.
const DIR = 'supabase/migrations';
const REBUILD = `${DIR}/20261106004622_a_built_midway_free_buy_matches_its_schedule.sql`;
const GUARD = `${DIR}/20261106004812_a_built_midway_free_buy_refuses_a_shape_its_schedule_does_no.sql`;
const SCHEDULER = 'server/src/services/ScheduledTournamentService.ts';
const POLICY = 'server/src/tournament/midwayFreeBuyPolicy.ts';

const code = (path: string) => readFileSync(path, 'utf8').replace(/--[^\n]*/g, ' ');
const uuids = (s: string) =>
  (s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []).filter(
    (u) => u !== 'fade0000-0000-0000-0000-000000000001' // the Midway Union itself
  );

describe('a built Midway Free Buy matches its schedule', () => {
  it('the database refuses a build whose format is not the one its schedule slot names', () => {
    const raw = readFileSync(GUARD, 'utf8');
    const sql = code(GUARD);
    // CREATE TRIGGER on tournaments takes SHARE ROW EXCLUSIVE: daily window only.
    expect(raw.split('\n').slice(0, 3)).toContain('-- @install-window: daily-maintenance');
    expect(sql).toMatch(
      /CREATE TRIGGER zzzzzzzzzzz_a_built_midway_free_buy_matches_its_schedule\s+AFTER INSERT OR UPDATE OF[\s\S]*ON public\.tournaments\s+FOR EACH ROW/
    );
    // The two shared definitions, never a second copy of the schedule read.
    expect(sql).toContain('fn_ca_midway_free_buy_slot_format(NEW.id)');
    expect(sql).toContain('fn_ca_midway_free_buy_format(NEW.id)');
    expect(sql).not.toMatch(/tournament_schedules/);
    expect(sql).toMatch(/RAISE EXCEPTION 'MIDWAY_FREE_BUY_SHAPE_DIFFERS_FROM_ITS_SCHEDULE/);
    // A started event keeps its players' terms.
    expect(sql).toMatch(/NEW\.started_at IS NOT NULL/);
    // Declared on the money table it sits on.
    expect(sql).toMatch(
      /INSERT INTO public\.ca_declared_money_triggers[\s\S]*'zzzzzzzzzzz_a_built_midway_free_buy_matches_its_schedule'/
    );
    expect(uuids(sql)).toEqual([]);
  });

  it('a wrongly-shaped unstarted horse-only occurrence is rebuilt through the cancellation authority', () => {
    const sql = code(REBUILD);
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.fn_ca_rebuild_midway_free_buy_to_its_schedule(p_tournament_id uuid)'
    );
    expect(sql).toContain('fn_ca_midway_free_buy_slot_format(p_tournament_id)');
    expect(sql).toContain('fn_ca_midway_free_buy_format(p_tournament_id)');
    // Every entry, horse or human, is refunded by the one cancellation path.
    expect(sql).toContain('public.atomic_cancel_tournament(p_tournament_id, NULL)');
    // A human who registered keeps the terms he registered under.
    expect(sql).toMatch(/'a_human_is_registered'/);
    // The date goes back to its schedule in the same transaction.
    expect(sql).toMatch(/DELETE FROM public\.tournament_schedule_spawns/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_rebuild_midway_free_buy_to_its_schedule\(uuid\) FROM PUBLIC, anon, authenticated/
    );
    expect(sql).not.toMatch(/cron\.schedule/);
    expect(uuids(sql)).toEqual([]);
    // Horses are players: never filtered out of a refund.
    expect(sql).not.toMatch(/is_horse[^\n]*THEN\s+CONTINUE/i);
  });

  it('the scheduler asks for the rebuild inside its own sync pass, before it spawns', () => {
    const src = readFileSync(SCHEDULER, 'utf8');
    const conform = src.indexOf(
      'await this.conformClaimedOccurrences(schedule, plans, claimedSet);'
    );
    const rebuild = src.indexOf('await this.rebuildWrongShapedMidwayOccurrences(');
    const spawn = src.indexOf(
      'await this.spawnInstance(schedule, cfg, spawn.spawnKey, spawn.startTime);'
    );
    expect(conform).toBeGreaterThan(0);
    expect(rebuild).toBeGreaterThan(conform);
    expect(spawn).toBeGreaterThan(rebuild);
    expect(src).toContain("'fn_ca_rebuild_midway_free_buy_to_its_schedule'");
    expect(src).toMatch(/if \(key\) claimedSet\.delete\(key\);/);
    expect(uuids(readFileSync(POLICY, 'utf8'))).toEqual([]);
  });
});
