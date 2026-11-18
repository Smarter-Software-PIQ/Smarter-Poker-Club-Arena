/**
 * THE OWNER'S FREE BUY PAUSE HOLDS EVERY START (Dan, 2026-11-17 21:30 CT).
 *
 * Owner hold, verbatim intent: shut down ALL Free Buy tournaments 100% until
 * the hand-delay problem is fixed. It was enforced by hand and nothing durable
 * carried it, so the 14:30 UTC Morning Free Buy started on 2026-11-18 with 544
 * entrants. 20261118163436 made it a durable owner switch
 * (public.ca_free_buy_start_pause) checked at the database's one launch door.
 *
 * What this pins, so a later CREATE OR REPLACE cannot silently drop it:
 *   - the LATEST definition of fn_begin_tournament_launch_before_lease_generation
 *     asks fn_ca_free_buy_start_pause_defers FIRST, before any other refusal;
 *   - the LATEST fn_ca_launch_tournament_start_refused asks
 *     fn_ca_free_buy_start_paused for an unstarted event, so the admission
 *     trigger refuses any other RUNNING flip;
 *   - the gate answers 'platform_frozen', and the engine still treats that
 *     answer as a quiet stand-down (no reportError, no retry), so a paused
 *     Free Buy never spams or loops hot;
 *   - Free Buys are identified by tournaments.free_buy, never by name, and the
 *     gate never reads is_horse (CLAUDE.md 10.5) or touches money;
 *   - only the owner can flip it: no API role may execute the setter;
 *   - no cron or repair job drives it (CLAUDE.md 10.12).
 * Native proof: scripts/ci/test-free-buy-start-pause-postgres.sh.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const migrations = join(root, 'supabase/migrations');
const MIGRATION = '20261118163436_owner_pauses_free_buy_starts_until_the_hand_delay_is_fixed.sql';
const files = readdirSync(migrations)
  .filter((f) => f.endsWith('.sql'))
  .sort();

function latestBody(signature: RegExp): { file: string; body: string } {
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const sql = readFileSync(join(migrations, files[i]), 'utf8');
    const at = sql.search(signature);
    if (at < 0) continue;
    const open = sql.indexOf('$function$', at);
    const close = sql.indexOf('$function$', open + 10);
    return { file: files[i], body: sql.slice(open + 10, close) };
  }
  throw new Error(`no definition for ${signature}`);
}

const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
const mig = readFileSync(join(migrations, MIGRATION), 'utf8');

describe("the owner's Free Buy pause holds every start", () => {
  it('the launch door asks the pause first', () => {
    const { body } = latestBody(
      /CREATE OR REPLACE FUNCTION public\.fn_begin_tournament_launch_before_lease_generation\(/
    );
    const c = code(body);
    const gate = c.indexOf('fn_ca_free_buy_start_pause_defers(p_tournament_id)');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(c.indexOf('fn_ca_launch_tournament_start_refused'));
    expect(gate).toBeLessThan(c.indexOf('INSERT INTO public.tournament_launch_receipts'));
  });

  it('the start-refusal used by the admission trigger holds an unstarted Free Buy', () => {
    const { body } = latestBody(
      /CREATE OR REPLACE FUNCTION public\.fn_ca_launch_tournament_start_refused\(/
    );
    expect(code(body)).toMatch(
      /fn_ca_launch_tournament_has_started\(p_tournament\) IS NOT TRUE THEN[\s\S]*?fn_ca_free_buy_start_paused\(p_tournament\)[\s\S]*?END IF;/
    );
  });

  it('the gate defers with the refusal the serving engine handles quietly', () => {
    const defers = code(mig.slice(mig.indexOf('CREATE FUNCTION public.fn_ca_free_buy_start_pause_defers')));
    expect(defers).toMatch(/'reason', 'platform_frozen'/);
    expect(defers).toMatch(/start_time = v_until/);
    expect(defers).toMatch(/interval '30 minutes'/);
    const engine = readFileSync(join(root, 'server/src/tournament/TournamentManagerBase.ts'), 'utf8');
    const begin = engine.slice(engine.indexOf('private async beginTournamentLaunch('));
    const frozen = begin.slice(begin.indexOf("result.reason === 'platform_frozen'"));
    expect(frozen.slice(0, 300)).toMatch(/console\.log\([\s\S]*?return null;/);
    expect(frozen.slice(0, 300)).not.toMatch(/reportError/);
  });

  it('identifies Free Buys by kind, treats horses as players and moves no money', () => {
    const paused = code(mig.slice(mig.indexOf('CREATE FUNCTION public.fn_ca_free_buy_start_paused')));
    expect(paused.slice(0, 600)).toMatch(/t\.free_buy IS TRUE/);
    const gate = code(
      mig.slice(
        mig.indexOf('CREATE FUNCTION public.fn_ca_free_buy_start_paused'),
        mig.indexOf('-- 4. The launch door')
      )
    );
    expect(gate).not.toMatch(/is_horse|name\s+(I?LIKE|=)/i);
    expect(gate).not.toMatch(
      /chip_ledger|wallet_transactions|club_members|chip_balance|tournament_players\s+SET|DELETE FROM public\.tournament_players/i
    );
  });

  it('is owner-controlled, audited and installed ON with the owner reason', () => {
    expect(mig).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_owner_set_free_buy_start_pause\(boolean, text, text\)\s+FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(mig).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_ca_owner_set_free_buy_start_pause/);
    expect(mig).toMatch(/INSERT INTO public\.ca_free_buy_start_pause_audit/);
    expect(mig).toMatch(/SELECT public\.fn_ca_owner_set_free_buy_start_pause\(\s*true,\s*'Owner hold \(Dan, 2026-11-17 21:30/);
  });

  it('has no cron and no repair job behind it', () => {
    for (const f of files.filter((x) => x >= MIGRATION)) {
      const sql = readFileSync(join(migrations, f), 'utf8');
      expect(sql).not.toMatch(/cron\.schedule[\s\S]{0,400}free_buy_start_pause/);
    }
    expect(mig).not.toMatch(/cron\.schedule/);
    expect(existsSync(join(root, 'scripts/ci/test-free-buy-start-pause-postgres.sh'))).toBe(true);
  });
});
