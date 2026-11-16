import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
describe('owner hourly cash capacity is permanent and cash only', () => {
  it('runs native admission, pacing, hand safety and replay proof in the required engine route', () => {
    expect(read('.github/workflows/ci.yml')).toContain(
      'python3 -B scripts/ci/test-hourly-cash-caps-postgres.py'
    );
    const sql = [
      'supabase/migrations/20261116153902_enforce_owner_hourly_cash_table_caps_with_human_expansion.sql',
      'supabase/migrations/20261116194028_human_started_cash_games_remain_additional_hourly_capacity.sql',
    ]
      .map(read)
      .join('\n');
    expect(sql).toContain("AT TIME ZONE 'America/Chicago'");
    expect(sql).toContain('t.tournament_id IS NOT NULL');
    expect(sql).toContain('fn_cashout_seat_occupancy');
    expect(sql).not.toMatch(
      /(?:UPDATE|DELETE FROM)\s+public\.(?:tournaments|tournament_players|club_members)\b/i
    );
    expect(sql).not.toContain('cron.schedule');
  });
  it('uses the existing cash boundary and does not change tournament Horse scheduling', () => {
    const dealer = read('server/src/engine/ServerTableEngineDealing.ts');
    const method = dealer.slice(
      dealer.indexOf('protected async passHourlyCashBoundary'),
      dealer.indexOf('protected async passHourlyCashBoundary') + 4200
    );
    expect(method).toContain('this.isTournamentTable()');
    expect(method).toContain('!this.isBetweenHands()');
    expect(method).toContain('this.postHandTasksPromise');
    expect(method).toContain('this.releaseDepartedSeats');
    expect(method).not.toMatch(/setInterval|setTimeout/);
    const fleet = read('server/src/services/HorseFleetManager.ts');
    expect(fleet).toContain('readHourlyCashAdmissions()');
    expect(fleet).toContain('hourlyAutonomousStarted');
    expect(fleet).toContain('cleared.splice(hourly.maxHorses)');
  });
});
