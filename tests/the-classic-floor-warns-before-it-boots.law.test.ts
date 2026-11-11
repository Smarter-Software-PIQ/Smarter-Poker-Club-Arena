/**
 * THE CLASSIC FLOOR JUDGES THIRTY DEALT HANDS, AND WARNS BEFORE IT BOOTS
 * (Dan, owner ruling 2026-11-10)
 *
 * Dan: "FOR ALL CLASSIC GAMES THAT ARE .50/1.00 OR HIGHER, YOU MUST ADD A NEW
 * 20% VPIP ON THOSE GAMES, OR THE PLAYER GETS BOOTED", then: humans and
 * horses, a rolling thirty dealt hands with a thirty-hand minimum, per-variant
 * floors, and warn-then-boot with a safe stack cashout. Action and Madness
 * unchanged.
 *
 * Every pin below is a way this could regress into something Dan did not ask
 * for. The behavioural proof - exactly 30, the threshold boundary, warning
 * recovery, grace expiry, reconnects, concurrent eviction, forced blinds, and
 * Action/Madness isolation - runs against a real Postgres in
 * `scripts/ci/test-classic-vpip-floor.sh`, because these are SQL rules and a
 * string match cannot execute one.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sliceDollarQuoted, sliceSqlStatement } from './helpers/sourceWindow';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const MIG = read(
  'supabase/migrations/20261111003710_the_classic_floor_judges_thirty_dealt_hands_and_warns_before.sql'
);
const ACT = read(
  'supabase/migrations/20261111022301_a_classic_rejoin_continues_the_vpip_sitting_and_the_approved.sql'
);
const TRACKER = read('src/components/table/HeroVpipTracker.tsx');
const NIT = read('server/src/services/supabase/nitGame.ts');
const BASE = read('server/src/engine/ServerTableEngineBase.ts');

describe('the Classic VPIP floor', () => {
  it('is one transaction, as the production DDL policy requires', () => {
    expect(MIG).toMatch(/^BEGIN;$/m);
    expect(MIG).toMatch(/^COMMIT;$/m);
    expect(MIG.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(MIG.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('keeps the floors in a config table so a value needs no deploy', () => {
    expect(MIG).toMatch(/CREATE TABLE IF NOT EXISTS public\.ca_classic_vpip_floors/);
    // Dan's NLH value, never lowered to accommodate the current horse fleet.
    expect(MIG).toMatch(/\('nlh',\s*1,\s*20,\s*30,\s*10,/);
    // Every supported Classic variant carries a row; none is left exempt.
    for (const v of [
      'nlh',
      'plo4',
      'plo5',
      'plo6',
      'plo8',
      'flo8',
      'flh',
      'short_deck',
      'pineapple',
    ]) {
      expect(MIG, `${v} has no floor row`).toContain(`('${v}',`);
    }
  });

  it('judges a rolling thirty with a thirty-hand minimum', () => {
    // The sample minimum and the window are the same number, so a seat with
    // fewer than thirty dealt hands cannot be judged at all.
    expect(MIG).toMatch(/\('nlh',\s*1,\s*20,\s*30,/);
    expect(MIG).toMatch(
      /LIMIT CASE WHEN COALESCE\(p_rolling, false\) THEN GREATEST\(p_window, 1\) ELSE NULL END/
    );
    expect(MIG).toMatch(/v_table_hands >= v_pol\.window_hands AND v_table_vpip < v_pol\.floor_pct/);
  });

  it('gives every reader and the enforcement the one same sample', () => {
    // fn_nit_sample is the single definition. If a reader grew its own copy of
    // the window, a player could be shown one number and judged on another.
    const callers = MIG.match(/public\.fn_nit_sample\(/g) ?? [];
    expect(callers.length).toBeGreaterThanOrEqual(4);
    for (const fn of ['fn_nit_check', 'fn_nit_status', 'fn_cash_vpip_status']) {
      // Bound the window by the statement it is about, never by a byte count:
      // a comment added inside one of these bodies must not push the thing
      // being asserted out the far end of the window.
      const body = sliceSqlStatement(MIG, `FUNCTION public.${fn}(`);
      expect(body, `${fn} does not use the shared sample`).toMatch(/public\.fn_nit_sample\(/);
    }
  });

  it('warns before it boots, and counts grace in dealt hands', () => {
    expect(MIG).toMatch(/CREATE TABLE IF NOT EXISTS public\.ca_nit_warnings/);
    // Grace is hands, never wall clock: the hand boundary is the only clock
    // this path has.
    expect(MIG).toMatch(/fn_nit_hands_since\(/);
    expect(MIG).toMatch(/IF v_done < v_warn_gr THEN/);
    // A first lapse returns nothing: a warning costs no seat.
    expect(MIG).toMatch(/-- A warning costs no seat, so nothing is returned for it\./);
    // Recovery clears, and the next lapse takes a fresh full grace.
    expect(MIG).toMatch(/cleared_reason = 'recovered'/);
  });

  it('cannot double-warn or double-boot one lapse', () => {
    expect(MIG).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS ca_nit_warnings_one_open_per_sitting/);
    expect(MIG).toMatch(/WHERE cleared_at IS NULL;/);
    // The closing UPDATE's own row count is the race guard.
    expect(MIG).toMatch(
      /SET cleared_at = now\(\), cleared_reason = 'evicted'\s*\n\s*WHERE id = v_warn_id AND cleared_at IS NULL;/
    );
    expect(MIG).toMatch(/IF NOT FOUND THEN\s*\n\s*CONTINUE;\s*--\s*another boundary took it first/);
  });

  it('leaves Action and Madness exactly as they are', () => {
    // vpip_rolling and vpip_grace_hands are written ONLY inside the Classic
    // branch, so a Madness snapshot has neither and reads false / zero.
    const classicBranch = sliceSqlStatement(
      MIG,
      'FUNCTION public.fn_cash_game_floor_from_template()'
    );
    expect(classicBranch).toMatch(/'vpip_rolling',\s*true/);
    expect(classicBranch).toMatch(/'vpip_grace_hands',\s*v_grace/);
    expect(MIG).toMatch(/COALESCE\(\(g\.ruleset_snapshot->>'vpip_rolling'\)::boolean, false\)/);
    // Grace zero means boot on the spot, which is today's behaviour.
    expect(MIG).toMatch(/IF v_pol\.grace_hands <= 0 THEN/);
  });

  it('never lowers a stronger floor that is already in force', () => {
    expect(MIG).toMatch(/'vpip_floor', GREATEST\(/);
  });

  it('never reaches back over hands played before the floor existed', () => {
    expect(MIG).toMatch(/'vpip_floor_since'/);
  });

  it('restores the grants a required DROP takes with it', () => {
    // fn_nit_status gains columns, so CREATE OR REPLACE is refused and the
    // function must be dropped. A DROP takes the ACL, so it is put back.
    expect(MIG).toMatch(/DROP FUNCTION IF EXISTS public\.fn_nit_status\(uuid\);/);
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION public\.fn_nit_status\(uuid\) FROM PUBLIC;/);
    expect(MIG).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_nit_status\(uuid\) TO service_role;/);
  });

  it('reads no horse identity anywhere in the rule (CLAUDE.md 10.5)', () => {
    expect(MIG).not.toMatch(/is_horse/);
    expect(MIG).toMatch(/HORSES ARE PLAYERS \(Dan 2026-08-27\)\. Humans and horses, one rule\./);
  });

  it('builds no cron, watcher, sweep or repair path (CLAUDE.md 10.12)', () => {
    expect(MIG).not.toMatch(/cron\.(schedule|job)/);
    expect(MIG).not.toMatch(/fn_\w*(repair|backpay|redrive|sweep|catchup|heal)\w*/);
  });

  it('is enforced from the dealing loop, and fails open', () => {
    expect(NIT).toMatch(/export async function collectNitEnforce/);
    expect(NIT).toMatch(/supabase\.rpc\('fn_nit_enforce', \{ p_table_id: tableId \}\)/);
    // A stats call that cannot answer must never remove a player.
    const enforce = NIT.slice(NIT.indexOf('export async function collectNitEnforce'));
    expect(enforce.match(/return \[\];/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(BASE).toMatch(/const nits = await collectNitEnforce\(this\.tableId\);/);
    // Still gated on the column, so no round trip on a table without the rule.
    expect(BASE).toMatch(/this\.tableInfo\?\.nit_game === true/);
  });

  it('still stands a seat up only at a hand boundary, through one cashout', () => {
    expect(BASE).toMatch(/leaveMode: 'vpip_evicted' as const/);
    expect(BASE).toMatch(/mid_hand: false/);
    expect(BASE).toMatch(/reason: awayBlindEvict/);
  });

  it('hands the brain the floor and its own judged figure', () => {
    // The brain reads the SAME function the eviction reads, so a Classic
    // table's rolling thirty reaches the horse automatically.
    expect(NIT).toMatch(/rolling: row\.rolling === true/);
    expect(NIT).toMatch(/warned: row\.warned === true/);
    expect(MIG).toMatch(/FUNCTION public\.fn_nit_status\(p_table_id uuid\)/);
  });
});

describe('the approved floors, activated', () => {
  it('carries the nine values the owner approved, and no others', () => {
    for (const [variant, floor] of [
      ['nlh', 20],
      ['plo4', 30],
      ['plo5', 50],
      ['plo6', 50],
      ['plo8', 30],
      ['flo8', 25],
      ['flh', 15],
      ['short_deck', 20],
      ['pineapple', 25],
    ] as const) {
      expect(MIG, `${variant} is not at its approved floor`).toMatch(
        new RegExp(`\\('${variant}',\\s*1,\\s*${floor},\\s*30,\\s*10,`)
      );
    }
  });

  it('records the three variants with no sample as judgment, not evidence', () => {
    // One floor per line, so the line IS the structure here. (A SQL statement
    // window is wrong for this one: two of the notes contain a semicolon, and
    // sliceSqlStatement ends a statement at the first one outside a
    // dollar-quote.)
    const lines = MIG.split('\n');
    const rowFor = (v: string) => lines.find((l) => l.includes(`('${v}',`));
    for (const v of ['plo8', 'short_deck', 'pineapple']) {
      const line = rowFor(v);
      expect(line, `${v} has no floor row`).toBeTruthy();
      expect(line!, `${v} does not record that its floor is judgment`).toMatch(
        /no player reached 30 hands|no 30-hand sample|judgment, not evidence|Same PLO family/
      );
    }
    // The two with genuinely no sample at all say so in those words.
    for (const v of ['short_deck', 'pineapple']) {
      expect(rowFor(v)!).toMatch(/judgment, not evidence/);
    }
  });

  it('activates through the maintained ruleset path, never by hand', () => {
    // The two steps any other ruleset change takes. If this ever writes
    // nit_game or maintain_* directly, a fresh table and a reconciled one can
    // disagree - which is the exact trap fn_cash_apply_ruleset exists to close.
    expect(ACT).toMatch(
      /UPDATE public\.cash_games SET ruleset_snapshot = ruleset_snapshot WHERE id = r\.id;/
    );
    expect(ACT).toMatch(/public\.fn_cash_apply_ruleset\(r\.id\)/);
    const activate = sliceDollarQuoted(ACT, '$activate$');
    expect(activate).not.toMatch(/UPDATE public\.tables/);
    expect(activate).not.toMatch(/maintain_percent_min\s*=/);
    expect(activate).not.toMatch(/nit_game\s*=/);
  });

  it('aborts rather than half-activating, and refuses to overreach', () => {
    expect(ACT).toMatch(/ACTIVATION_INCOMPLETE/);
    expect(ACT).toMatch(/ACTIVATION_TABLES_INCOMPLETE/);
    expect(ACT).toMatch(/ACTIVATION_OVERREACH/);
    expect(ACT).toMatch(/ACTIVATION_TOUCHED_OTHER_TEMPLATES/);
  });

  it('leaves a retired club alone', () => {
    expect(ACT).toMatch(/COALESCE\(c\.lifecycle_status, ''\) <> 'retired'/);
  });

  it('does not wait on an unrelated future write to each game', () => {
    // The whole point of this migration: activation happens here, in a
    // committed transaction, not whenever something else next touches a row.
    expect(ACT).toMatch(/\$activate\$/);
    expect(ACT).toMatch(/CREATE TABLE IF NOT EXISTS public\.ca_classic_vpip_activations/);
  });
});

describe('a rejoin is not an escape hatch', () => {
  it("reuses the platform's own re-entry window rather than inventing a penalty", () => {
    const w = sliceSqlStatement(ACT, 'FUNCTION public.fn_nit_sitting_since(');
    // cash_player_session.rejoin_window_ms, floored at the two hours its own
    // CHECK enforces - the same window that stops a stack-basis reset.
    expect(w).toMatch(/GREATEST\(7200000,/);
    expect(w).toMatch(/rejoin_window_min/);
    // A return inside it continues the sitting: the sample reaches back to the
    // earliest join of the current chain, not the newest roster row.
    expect(w).toMatch(/min\(a\.joined_at\)/);
    expect(w).toMatch(/max\(b\.sitting\)/);
    // And never earlier than the instant the floor came on.
    expect(w).toMatch(/vpip_floor_since/);
    expect(w).not.toMatch(/is_horse/);
  });

  it('still counts grace in dealt hands, so sitting out spends none', () => {
    expect(MIG).toMatch(/FUNCTION public\.fn_nit_hands_since\(/);
    expect(MIG).toMatch(/f\.played_at > p_since/);
  });
});

describe('the player can see the warning', () => {
  it('reads the warning and the remaining grace from the judged figure', () => {
    expect(TRACKER).toMatch(/warned\?: boolean/);
    expect(TRACKER).toMatch(/grace_remaining\?: number \| null/);
    expect(TRACKER).toMatch(/VPIP_GRACE_COUNT_LABEL/);
  });

  it('shows it on the felt without recolouring the approved badge', () => {
    expect(TRACKER).toMatch(/data-testid="hero-vpip-grace"/);
    // The badge is forbidden from colouring itself by whether the player is
    // passing (badge spec section 25); this is the separate indicator that
    // section calls for, in the column the tracker already owns.
    expect(TRACKER).toMatch(/hero-vpip__clock/);
    expect(TRACKER).not.toMatch(/hero-vpip--(safe|edge|under)/);
  });
});
