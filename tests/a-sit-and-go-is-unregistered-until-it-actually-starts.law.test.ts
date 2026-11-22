/**
 * LAW: A SIT AND GO IS UNREGISTERED UNTIL IT ACTUALLY STARTS (Dan, 2026-11-22).
 *
 * Dan, verbatim: "PLAYERS NEED TO BE ABLE TO 'UNREGISTER' FROM A SIT N GO,
 * HEADS UP OR SPIN IF IT HASN'T STARTED YET."
 *
 * What shipped: a nine seat Sit and Go satellite, REGISTERING, Starts When
 * Full, 1 of 9, answered "This Tournament Has Started" to its one registered
 * player. fn_ca_unregister_tournament_player_exact gave the actual-start rule
 * only to Spins and to a two seat Sit and Go; every other event was judged by
 * `clock_timestamp()>=v_t.start_time`, and fn_ensure_fixed_sng_satellite
 * creates its six and nine seat boards with start_time two minutes ahead as a
 * fill window, not a start.
 *
 * Why it broke: 20260909183657 keyed the Sit and Go exception on two seats,
 * because every live Sit and Go was heads-up then. The six and nine seat
 * satellites arrived on 2026-10-28 (20261028163610) in the same format, and
 * nothing tied the unregister rule to the set of formats that start when full.
 *
 * The installed fix is 20261122185915 ('sng_actual_start'). Two lanes fixed
 * this in parallel; 20261122192807 carried the same rule under another name,
 * was refused on install because its anchors were already gone, and is now
 * verify-only. This law pins the installed rule at source: the newest
 * recorded body of each function, the receipt constraint, the client, and
 * that no later migration can replace these functions without the rule.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { sliceBetween } from './helpers/sourceWindow';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const read = (name: string) => readFileSync(resolve(DIR, name), 'utf8');
const MIGRATIONS = readdirSync(DIR)
  .filter((f) => /^\d{14}_.*\.sql$/.test(f))
  .sort();

const INSTALLED = '20261122185915_sng_actual_start_unregister_and_promo_union_wallet_id.sql';
const VERIFY_ONLY = '20261122192807_a_sit_and_go_is_unregistered_until_it_actually_starts.sql';

const createOf = (fn: string) =>
  new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`, 'i');

/** The file holding the newest recorded CREATE of `fn`, and that body. */
function newest(fn: string): { file: string; body: string } {
  const files = MIGRATIONS.filter((f) => createOf(fn).test(read(f)));
  expect(files.length, `${fn} is defined somewhere`).toBeGreaterThan(0);
  const file = files[files.length - 1];
  const source = read(file);
  const at = source.search(createOf(fn));
  const fromCreate = source.slice(at);
  const body = sliceBetween(
    fromCreate.slice(fromCreate.indexOf('$function$')),
    '$function$',
    '\n$function$'
  );
  return { file, body };
}

const CORE = 'fn_ca_unregister_tournament_player_exact';
const DIAMOND = 'fn_poker_diamond_tournament_unregister';
const RECEIPT = 'fn_ca_tournament_unregistration_receipt';
const core = newest(CORE);
const diamond = newest(DIAMOND);
const receipt = newest(RECEIPT);

describe('the cause: a fill window was read as a start', () => {
  it('the fixed Sit and Go satellite is an SNG board with a start_time two minutes ahead', () => {
    const creator = read('20261028163610_two_seat_fixed_field_sng_satellites.sql');
    expect(creator).toContain("clock_timestamp()+interval '2 minutes'");
    expect(creator).toContain("format_contract='sng-v1'");
    expect(creator).toContain("tournament_type='SNG' AND variant='sng'");
  });
});

describe('a Sit and Go of any size is judged by what actually happened', () => {
  it('the newest definition of all three functions is the installed fix or a later one that keeps it', () => {
    // A later migration may tighten the rule (for example, close the event once
    // any launch receipt exists); it may not drop the authority.
    for (const { file, body } of [core, diamond, receipt]) {
      expect(file >= INSTALLED, `${file} is not older than the installed fix`).toBe(true);
      expect(body).toContain('sng_actual_start');
    }
  });

  it('every non-heads-up SNG Sit and Go leaves the scheduled clock', () => {
    const choice = sliceBetween(core.body, "IF v_t.format_contract='spin-v1' THEN", 'END IF;');
    expect(choice).toContain("v_start_authority:='heads_up_sng_actual_start';");
    expect(choice).toContain("upper(COALESCE(v_t.tournament_type::text,''))='SNG'");
    expect(choice).toContain("v_start_authority:='sng_actual_start';");

    const diamondChoice = sliceBetween(
      diamond.body,
      "IF v_t.format_contract='spin-v1' THEN",
      'END IF;'
    );
    expect(diamondChoice).toContain("v_authority := 'sng_actual_start';");
  });

  it('the clock refusal is reachable only for the scheduled clock', () => {
    const gate = sliceBetween(core.body, "IF v_start_authority='scheduled_clock' THEN", 'ELSE');
    expect(gate).toContain('IF clock_timestamp()>=v_t.start_time THEN');
    const occurrences = core.body.split('clock_timestamp()>=v_t.start_time').length - 1;
    expect(occurrences, 'one clock refusal, inside the scheduled-clock branch').toBe(1);
  });

  it('a seat-first event refuses on a persisted hand, started_at or its launch', () => {
    const seatFirst = sliceBetween(
      core.body,
      "IF v_start_authority='scheduled_clock' THEN",
      'IF v_reg.id IS NULL THEN'
    );
    expect(seatFirst).toContain('v_t.started_at IS NOT NULL');
    expect(seatFirst).toContain('public.tournament_launch_receipts');
    expect(core.body).toContain('INTO v_persisted_hand_exists;');
  });

  it('a launch and an unregistration cannot both win: the row lock, then a second proof', () => {
    expect(core.body).toMatch(/WHERE t\.id=p_tournament_id FOR UPDATE;/);
    const reproof = sliceBetween(
      core.body,
      'Re-prove the chosen start authority',
      'INSERT INTO public.tournament_unregistration_receipts('
    );
    expect(reproof).toContain("NOT IN ('ANNOUNCED','REGISTERING')");
    expect(reproof).toContain('v_actual_started_at IS NOT NULL');
    expect(reproof).toContain('public.tournament_launch_receipts');
    expect(reproof).toContain("ERRCODE='55000'");
  });

  it('never asks who is a horse', () => {
    expect(core.body).not.toMatch(/is_horse/i);
    expect(diamond.body).not.toMatch(/is_horse/i);
  });
});

describe('the immutable receipt can name and prove the authority', () => {
  it('the check constraint admits sng_actual_start', () => {
    const constraint = sliceBetween(
      read(INSTALLED),
      'ADD CONSTRAINT tournament_unregistration_actual_start_check',
      ');'
    );
    expect(constraint).toContain("'sng_actual_start'::text");
  });

  it('the reader accepts it only for a non-heads-up SNG Sit and Go', () => {
    const rule = sliceBetween(
      receipt.body,
      "OR (v_r.start_authority='sng_actual_start'",
      'OR v_r.start_authority NOT IN'
    );
    expect(rule).toContain("t.format_contract='sng-v1'");
    expect(rule).toContain("upper(COALESCE(t.tournament_type::text,''))='SNG'");
    expect(rule).toContain('COALESCE(t.max_players,0)<>2');
  });
});

describe('the rule cannot be silently undone', () => {
  it('no later migration replaces these functions without the rule', () => {
    for (const file of MIGRATIONS.filter((f) => f > INSTALLED)) {
      const source = read(file);
      for (const fn of [CORE, RECEIPT, DIAMOND]) {
        if (createOf(fn).test(source)) {
          expect(source, `${file} replaces ${fn}`).toContain('sng_actual_start');
        }
      }
    }
  });

  it('the parallel migration is verify-only: it proves the rule and changes nothing', () => {
    const sql = read(VERIFY_ONLY);
    for (const fn of [CORE, RECEIPT, DIAMOND]) expect(sql).not.toMatch(createOf(fn));
    expect(sql).not.toMatch(/ALTER\s+TABLE/i);
    expect(sql).toContain('-- @live-proof:');
    expect(sql.match(/^BEGIN;$/gm)?.length).toBe(1);
    expect(sql.match(/^COMMIT;$/gm)?.length).toBe(1);
    expect(sql).not.toContain('sit_and_go_actual_start');
  });
});

describe('the client says the same thing the database does', () => {
  const service = readFileSync(resolve(ROOT, 'src/services/TournamentService.ts'), 'utf8');
  const dialog = readFileSync(resolve(ROOT, 'src/components/tournament/signUpDialog.tsx'), 'utf8');

  it('the page unregisters through the one RPC and never decides "started" from a clock', () => {
    expect(service).toContain(".rpc('fn_unregister_from_tournament', {");
    const unregister = sliceBetween(
      service,
      'async unregisterPlayer(',
      'async leaveTournamentSeatAndRefund('
    );
    expect(unregister).not.toMatch(/start_time|Date\.now\(\)|new Date\(/);
  });

  it('a starts-when-full entry is told it can unregister before the start', () => {
    expect(dialog).toContain('You Can Unregister Any Time Before The Tournament Starts');
  });
});
