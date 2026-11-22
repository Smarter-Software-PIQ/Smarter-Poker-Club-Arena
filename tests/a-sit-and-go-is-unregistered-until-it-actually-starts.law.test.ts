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
 * No database is available to this suite, so the SQL is pinned at source: the
 * anchored edits of migration 20261122192807 are applied here to the newest
 * recorded body of each function they rewrite, exactly as the migration
 * applies them to the live one, and the rule is asserted on the result.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sliceBetween } from './helpers/sourceWindow';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const read = (name: string) => readFileSync(resolve(DIR, name), 'utf8');

const MIGRATION = '20261122192807_a_sit_and_go_is_unregistered_until_it_actually_starts.sql';
const sql = read(MIGRATION);

function between(source: string, open: string, close = open, from = 0): string {
  const start = source.indexOf(open, from);
  expect(start, `opening ${open}`).toBeGreaterThan(-1);
  const end = source.indexOf(close, start + open.length);
  expect(end, `closing ${close}`).toBeGreaterThan(start);
  return source.slice(start + open.length, end);
}

/** The body of the newest recorded CREATE of `fn` in `file`. */
function recordedBody(file: string, fn: string, tag = '$function$'): string {
  const source = read(file);
  const at = source.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  expect(at, `${fn} in ${file}`).toBeGreaterThan(-1);
  return between(source, tag, tag, at);
}

/** Every (old, new) pair a DO block of the migration carries, in order. */
function edits(tag: string): Array<{ label: string; oldText: string; newText: string }> {
  const block = between(sql, `$${tag}$`);
  const out: Array<{ label: string; oldText: string; newText: string }> = [];
  const re = /\('([a-z_]+)',\n\$o\$([\s\S]*?)\$o\$,\n\$r\$([\s\S]*?)\$r\$\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out.push({ label: m[1], oldText: m[2], newText: m[3] });
  return out;
}

function applyOnce(body: string, list: ReturnType<typeof edits>, name: string): string {
  let out = body;
  for (const e of list) {
    expect(out.split(e.oldText).length - 1, `${name} anchor ${e.label}`).toBe(1);
    out = out.replace(e.oldText, () => e.newText);
  }
  return out;
}

const coreBefore = recordedBody(
  '20261122185915_sng_actual_start_unregister_and_promo_union_wallet_id.sql',
  'fn_ca_unregister_tournament_player_exact'
);
const core = applyOnce(coreBefore, edits('sit_and_go_core'), 'core');

const diamondBefore = recordedBody(
  '20261122185915_sng_actual_start_unregister_and_promo_union_wallet_id.sql',
  'fn_poker_diamond_tournament_unregister'
);
const diamond = applyOnce(diamondBefore, edits('sit_and_go_diamond'), 'diamond');

/* The receipt reader is its installed 20261122185915 body (which added
   sng_actual_start on top of 20260909235709 launch_release). */
function receiptBeforeThisMigration(): string {
  return recordedBody(
    '20261122185915_sng_actual_start_unregister_and_promo_union_wallet_id.sql',
    'fn_ca_tournament_unregistration_receipt'
  );
}
const receipt = applyOnce(receiptBeforeThisMigration(), edits('sit_and_go_receipt'), 'receipt');

describe('the cause: a fill window was read as a start', () => {
  it('the fixed Sit and Go satellite is created with a start_time two minutes ahead', () => {
    const creator = read('20261028163610_two_seat_fixed_field_sng_satellites.sql');
    expect(creator).toContain("clock_timestamp()+interval '2 minutes'");
    expect(creator).toContain("format_contract='sng-v1'");
    expect(creator).toContain('p_seats NOT IN (6,9)');
  });

  it('before this migration non-SNG-typed sng-v1 events still fell back to the clock and any-launch-receipt guard was absent', () => {
    expect(coreBefore).toMatch(
      /ELSIF v_t\.format_contract='sng-v1'\s+AND COALESCE\(v_t\.max_players,0\)=2 THEN\s+v_start_authority:='heads_up_sng_actual_start';\s+ELSIF v_t\.format_contract='sng-v1'\s+AND upper\(COALESCE\(v_t\.tournament_type::text,''\)\)='SNG'\s+AND lower\(COALESCE\(v_t\.variant::text,''\)\)<>'spin' THEN\s+v_start_authority:='sng_actual_start';\s+END IF;/
    );
    expect(coreBefore).not.toContain('sit_and_go_actual_start');
    expect(coreBefore).toMatch(
      /IF v_start_authority='scheduled_clock' THEN[\s\S]{0,260}?IF clock_timestamp\(\)>=v_t\.start_time THEN\s+RETURN jsonb_build_object\('ok',false,'reason','tournament_started'\);/
    );
  });
});

describe('a Sit and Go of any size is judged by what actually happened', () => {
  it('every sng-v1 event leaves the scheduled clock', () => {
    expect(core).toMatch(
      /v_start_authority:='heads_up_sng_actual_start';\s+ELSIF v_t\.format_contract='sng-v1' THEN[\s\S]{0,520}?v_start_authority:='sit_and_go_actual_start';\s+END IF;/
    );
    expect(diamond).toMatch(
      /v_authority := 'heads_up_sng_actual_start';\s+ELSIF v_t\.format_contract='sng-v1' THEN[\s\S]{0,200}?v_authority := 'sit_and_go_actual_start';\s+END IF;/
    );
  });

  it('the clock refusal is reachable only for the scheduled clock', () => {
    for (const body of [core, diamond]) {
      const clocks = body.match(/clock_timestamp\(\)>=v_t\.start_time/g) ?? [];
      expect(clocks).toHaveLength(1);
      expect(body).toMatch(
        /IF v_(?:start_)?authority='scheduled_clock' THEN\s+IF v_t\.start_time IS NULL THEN[\s\S]{0,160}?IF clock_timestamp\(\)>=v_t\.start_time THEN/
      );
    }
  });

  it('refuses once the event has started: status, started_at, a hand, or any launch receipt', () => {
    expect(core).toContain("NOT IN ('ANNOUNCED','REGISTERING')");
    expect(core).toContain('v_t.started_at IS NOT NULL OR v_launch_completed_at IS NOT NULL');
    expect(core).toContain('v_persisted_hand_exists');
    const anyReceipt =
      /IF v_start_authority='sit_and_go_actual_start' AND EXISTS \(\s+SELECT 1 FROM public\.tournament_launch_receipts r\s+WHERE r\.tournament_id=p_tournament_id\) THEN\s+RETURN jsonb_build_object\('ok',false,'reason','tournament_started'\);/;
    expect(core).toMatch(anyReceipt);
    expect(diamond).toMatch(
      /IF v_authority='sit_and_go_actual_start' AND EXISTS \(\s+SELECT 1 FROM public\.tournament_launch_receipts r\s+WHERE r\.tournament_id=p_tournament_id\) THEN\s+RETURN jsonb_build_object\('ok',false,'reason','tournament_started'\);/
    );
    // Refused before any money or roster work is attempted.
    expect(core.search(anyReceipt)).toBeLessThan(
      core.indexOf('FROM public.tournament_refund_entitlements e')
    );
    expect(diamond.indexOf("v_authority='sit_and_go_actual_start' AND EXISTS")).toBeLessThan(
      diamond.indexOf('fn_poker_diamond_tournament_refund(')
    );
  });

  it('a launch and an unregistration cannot both win: one row lock, and a second proof before the receipt', () => {
    // The unregistration holds the tournament row for its whole transaction...
    expect(core).toMatch(
      /SELECT \* INTO v_t FROM public\.tournaments t\s+WHERE t\.id=p_tournament_id FOR UPDATE;/
    );
    expect(diamond).toContain('FROM public.tournaments t WHERE t.id=p_tournament_id FOR UPDATE;');
    // ...and the launch takes the same row before its first write, the receipt.
    const launch = recordedBody(
      '20261118163436_owner_pauses_free_buy_starts_until_the_hand_delay_is_fixed.sql',
      'fn_begin_tournament_launch_before_lease_generation'
    );
    const lock = launch.lastIndexOf('FOR UPDATE;');
    const insert = launch.indexOf('INSERT INTO public.tournament_launch_receipts');
    expect(lock).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(lock);
    expect(launch.slice(launch.lastIndexOf('SELECT', lock), lock)).toContain(
      'FROM public.tournaments t'
    );
    // After the refund and roster work, the rule is proved again or everything rolls back.
    const reproof = core.indexOf("'sit and go launch began before unregistration could commit'");
    expect(reproof).toBeGreaterThan(core.indexOf('fn_settle_tournament_refund_exact('));
    expect(reproof).toBeLessThan(
      core.indexOf('INSERT INTO public.tournament_unregistration_receipts(')
    );
    expect(sliceBetween(core.slice(reproof), 'sit and go launch began', 'END IF;')).toContain(
      "ERRCODE='55000'"
    );
  });

  it("the launch's own release of a registrant it cannot seat keeps its authority", () => {
    expect(core).toMatch(
      /IF v_start_authority IN \('scheduled_clock','sit_and_go_actual_start'\) AND EXISTS \([\s\S]{0,360}?app\.ca_launch_release_launch_id[\s\S]{0,60}?v_start_authority:='launch_release';/
    );
    expect(diamond).toMatch(
      /IF v_authority IN \('scheduled_clock','sit_and_go_actual_start'\) AND EXISTS \(/
    );
  });

  it('scheduled events, Spins and Heads-Up keep the rule they had', () => {
    expect(core).toContain("v_start_authority text:='scheduled_clock';");
    expect(core).toMatch(
      /IF v_t\.format_contract='spin-v1' THEN\s+v_start_authority:='spin_actual_start';/
    );
    expect(core).toMatch(
      /ELSIF v_t\.format_contract='sng-v1'\s+AND COALESCE\(v_t\.max_players,0\)=2 THEN\s+v_start_authority:='heads_up_sng_actual_start';/
    );
    expect(core).toContain("'tournament started before unregistration could commit'");
    // The seat-first satellite's start is advertised; it is not moved here.
    expect(core).not.toContain('seat-first-satellite-v1');
  });

  it('the refund is the one the function already owned, once, and never asks who is a horse', () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
    for (const e of [
      ...edits('sit_and_go_core'),
      ...edits('sit_and_go_diamond'),
      ...edits('sit_and_go_receipt'),
    ]) {
      const added = strip(e.newText);
      expect(added).not.toMatch(
        /is_horse|wallet_transactions|chip_ledger|chip_balance|fn_add_chips|INSERT|UPDATE|DELETE/
      );
    }
    expect(core.match(/fn_settle_tournament_refund_exact\(/g)).toEqual(
      coreBefore.match(/fn_settle_tournament_refund_exact\(/g)
    );
    expect(core).not.toMatch(/is_horse/);
    expect(diamond).not.toMatch(/is_horse/);
  });
});

describe('the immutable receipt can name and prove the new authority', () => {
  it('the check constraint is widened by exactly one value, from its live definition', () => {
    const block = between(sql, '$widen_receipt_authority$');
    expect(block).toContain('pg_get_constraintdef(c.oid)');
    expect(block).toContain('tournament_unregistration_actual_start_check');
    expect(block).toContain("$n$, 'sit_and_go_actual_start'::text$n$");
    expect(core).toMatch(
      /v_seat_number,v_seats_taken,v_t\.start_time,v_start_authority,v_unregistered_at\);/
    );
  });

  it('the reader accepts it only for a Sit and Go that is not Heads-Up and had no completed launch', () => {
    expect(receipt).toMatch(
      /'spin_actual_start','heads_up_sng_actual_start','sng_actual_start','launch_release',\s+'sit_and_go_actual_start'\)\s+AND EXISTS \([\s\S]{0,260}?launch\.completed_at<=v_r\.settled_at/
    );
    expect(receipt).toMatch(
      /OR \(v_r\.start_authority='sit_and_go_actual_start'\s+AND NOT EXISTS \(\s+SELECT 1 FROM public\.tournaments t\s+WHERE t\.id=v_r\.tournament_id\s+AND t\.format_contract='sng-v1'\s+AND COALESCE\(t\.max_players,0\)<>2\)\)/
    );
    expect(receipt).toMatch(
      /v_r\.start_authority NOT IN \(\s+'scheduled_clock','spin_actual_start','heads_up_sng_actual_start',\s+'sng_actual_start','launch_release','sit_and_go_actual_start'\)/
    );
  });
});

describe('the migration is safe to install and cannot be silently undone', () => {
  it('is one transaction with bounded locks and aborts on any anchor it cannot find', () => {
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
    expect(sql.match(/was expected exactly once/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain('sit and go actual-start unregistration did not install exactly');
    expect(sql).not.toMatch(/@install-window/);
    expect(sql).not.toMatch(/\bcron\.schedule\b/);
  });

  it('executes each rewritten function before COMMIT', async () => {
    const mod = await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs'))
        .href
    );
    expect(
      mod
        .functionsNeedingProbe(sql)
        .map((f: { qualified: string }) => f.qualified)
        .sort()
    ).toEqual([
      'public.fn_ca_tournament_unregistration_receipt',
      'public.fn_ca_unregister_tournament_player_exact',
      'public.fn_poker_diamond_tournament_unregister',
    ]);
    expect(mod.missingProbes(sql)).toEqual([]);
  });

  it('no later migration replaces these functions without the rule', () => {
    const later = readdirSync(DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > MIGRATION);
    for (const file of later) {
      const source = read(file);
      for (const fn of [
        'fn_ca_unregister_tournament_player_exact',
        'fn_ca_tournament_unregistration_receipt',
        'fn_poker_diamond_tournament_unregister',
      ]) {
        if (
          new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`, 'i').test(
            source
          )
        ) {
          expect(source, `${file} replaces ${fn}`).toContain('sit_and_go_actual_start');
        }
      }
    }
  });
});

describe('the client says the same thing the database does', () => {
  const service = readFileSync(resolve(ROOT, 'src/services/TournamentService.ts'), 'utf8');
  const dialog = readFileSync(resolve(ROOT, 'src/components/tournament/signUpDialog.tsx'), 'utf8');

  it('the page unregisters through the one RPC and never decides "started" from a clock', () => {
    expect(service).toContain(".rpc('fn_unregister_from_tournament', {");
    const unregister = between(
      service,
      'async unregisterPlayer(',
      'async leaveTournamentSeatAndRefund('
    );
    expect(unregister).not.toMatch(/start_time|Date\.now\(\)|new Date\(/);
    expect(service).toContain(
      "tournament_started: 'This tournament has started. You can only unregister before it starts.'"
    );
  });

  it('a starts-when-full entry is told it can unregister before the start', () => {
    expect(dialog).toMatch(/!o\.isLateRegistration && !!startLabel && \(/);
    expect(dialog).toContain('You Can Unregister Any Time Before The Tournament Starts');
  });
});
