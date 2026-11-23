/**
 * LAW: A SIT AND GO WHOSE LAUNCH HAS BEGUN CANNOT BE UNREGISTERED (Dan's rule of
 * 2026-11-22, "PLAYERS NEED TO BE ABLE TO 'UNREGISTER' FROM A SIT N GO, HEADS UP
 * OR SPIN IF IT HASN'T STARTED YET", read to its end: once the launch begins, it
 * has started).
 *
 * 20261122185915 installed the rule as 'sng_actual_start' and closes a Sit and
 * Go only once its launch receipt is COMPLETED. The launch's first step
 * (fn_begin_tournament_launch_before_lease_generation) writes the receipt and
 * the cohort it will seat and leaves the event REGISTERING, so between that
 * step and completion a player in the cohort could be unregistered and
 * refunded. Migration 20261122222254 closes it.
 *
 * No database is available to this suite, so the SQL is pinned at source: the
 * anchored edits of 20261122222254 are applied here to the newest recorded body
 * of each function they rewrite (20261122185915), exactly as the migration
 * applies them to the live one, and the rule is asserted on the result. The
 * behaviour is proved natively by
 * scripts/dev/prove-a-begun-sit-and-go-launch-closes-unregistration.sh.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sliceBetween } from './helpers/sourceWindow';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const read = (name: string) => readFileSync(resolve(DIR, name), 'utf8');

const MIGRATION = '20261122222254_a_sit_and_go_whose_launch_has_begun_cannot_be_unregistered.sql';
const INSTALLED_FIRST = '20261122185915_sng_actual_start_unregister_and_promo_union_wallet_id.sql';
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

/* The body that shipped the defect, before either fix of 2026-11-22. */
const coreOriginal = recordedBody(
  '20261102154336_midway_promo_funded_bounty_only_free_buys.sql',
  'fn_ca_unregister_tournament_player_exact'
);

/* 20261122185915 installed first; this migration edits its bodies. */
const coreBefore = recordedBody(INSTALLED_FIRST, 'fn_ca_unregister_tournament_player_exact');
const core = applyOnce(coreBefore, edits('sit_and_go_core'), 'core');

const diamondBefore = recordedBody(INSTALLED_FIRST, 'fn_poker_diamond_tournament_unregister');
const diamond = applyOnce(diamondBefore, edits('sit_and_go_diamond'), 'diamond');
const receipt = recordedBody(INSTALLED_FIRST, 'fn_ca_tournament_unregistration_receipt');

describe('the cause: a fill window was read as a start', () => {
  it('the fixed Sit and Go satellite is created with a start_time two minutes ahead', () => {
    const creator = read('20261028163610_two_seat_fixed_field_sng_satellites.sql');
    expect(creator).toContain("clock_timestamp()+interval '2 minutes'");
    expect(creator).toContain("format_contract='sng-v1'");
    expect(creator).toContain('p_seats NOT IN (6,9)');
  });

  it('before the fixes of 2026-11-22 only a two seat Sit and Go escaped the clock', () => {
    expect(coreOriginal).toMatch(
      /ELSIF v_t\.format_contract='sng-v1'\s+AND COALESCE\(v_t\.max_players,0\)=2 THEN\s+v_start_authority:='heads_up_sng_actual_start';\s+END IF;/
    );
    expect(coreOriginal).not.toContain("v_start_authority:='sng_actual_start'");
    expect(coreOriginal).toMatch(
      /IF v_start_authority='scheduled_clock' THEN[\s\S]{0,260}?IF clock_timestamp\(\)>=v_t\.start_time THEN\s+RETURN jsonb_build_object\('ok',false,'reason','tournament_started'\);/
    );
  });
});

describe('a Sit and Go of any size is judged by what actually happened', () => {
  it('every sng-v1 event leaves the scheduled clock', () => {
    expect(core).toMatch(
      /v_start_authority:='heads_up_sng_actual_start';\s+ELSIF v_t\.format_contract='sng-v1'[\s\S]{0,240}?THEN\s+v_start_authority:='sng_actual_start';\s+END IF;/
    );
    expect(diamond).toMatch(
      /v_authority := 'heads_up_sng_actual_start';\s+ELSIF v_t\.format_contract='sng-v1'[\s\S]{0,240}?THEN\s+v_authority := 'sng_actual_start';\s+END IF;/
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
      /IF v_start_authority='sng_actual_start' AND EXISTS \(\s+SELECT 1 FROM public\.tournament_launch_receipts r\s+WHERE r\.tournament_id=p_tournament_id\) THEN\s+RETURN jsonb_build_object\('ok',false,'reason','tournament_started'\);/;
    expect(core).toMatch(anyReceipt);
    expect(diamond).toMatch(
      /IF v_authority='sng_actual_start' AND EXISTS \(\s+SELECT 1 FROM public\.tournament_launch_receipts r\s+WHERE r\.tournament_id=p_tournament_id\) THEN\s+RETURN jsonb_build_object\('ok',false,'reason','tournament_started'\);/
    );
    // Refused before any money or roster work is attempted.
    expect(core.search(anyReceipt)).toBeLessThan(
      core.indexOf('FROM public.tournament_refund_entitlements e')
    );
    expect(diamond.indexOf("v_authority='sng_actual_start' AND EXISTS")).toBeGreaterThan(-1);
    expect(diamond.indexOf("v_authority='sng_actual_start' AND EXISTS")).toBeLessThan(
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
      /IF v_start_authority IN \('scheduled_clock','sng_actual_start'\) AND EXISTS \([\s\S]{0,360}?app\.ca_launch_release_launch_id[\s\S]{0,60}?v_start_authority:='launch_release';/
    );
    expect(diamond).toMatch(
      /IF v_authority IN \('scheduled_clock','sng_actual_start'\) AND EXISTS \(/
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
    for (const e of [...edits('sit_and_go_core'), ...edits('sit_and_go_diamond')]) {
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

describe('the immutable receipt can name and prove the authority', () => {
  it('20261122185915 widened the check and taught the reader sng_actual_start, so this file leaves both alone', () => {
    const installed = read(INSTALLED_FIRST);
    expect(installed).toContain('tournament_unregistration_actual_start_check');
    expect(installed).toMatch(/'sng_actual_start'/);
    expect(core).toMatch(
      /v_seat_number,v_seats_taken,v_t\.start_time,v_start_authority,v_unregistered_at\);/
    );
    expect(receipt).toMatch(
      /'spin_actual_start','heads_up_sng_actual_start','sng_actual_start','launch_release'\)[\s\S]{0,260}?launch\.completed_at<=v_r\.settled_at/
    );
    expect(receipt).toMatch(
      /OR \(v_r\.start_authority='sng_actual_start'\s+AND NOT EXISTS \(\s+SELECT 1 FROM public\.tournaments t\s+WHERE t\.id=v_r\.tournament_id\s+AND t\.format_contract='sng-v1'/
    );
    expect(sql).not.toMatch(/fn_ca_tournament_unregistration_receipt\(uuid/);
    expect(sql).not.toMatch(/ALTER TABLE/);
  });

  it('builds on the installed bodies and refuses to run without them', () => {
    expect(sql).toContain('20261122185915 must be installed first');
    expect(sql).toContain('already refuses a begun Sit and Go launch: re-read before editing');
    expect(sql).not.toContain('sit_and_go_actual_start');
  });

  it('the launch writes its receipt first and leaves the event REGISTERING: the gap this closes', () => {
    const launch = recordedBody(
      '20261118163436_owner_pauses_free_buy_starts_until_the_hand_delay_is_fixed.sql',
      'fn_begin_tournament_launch_before_lease_generation'
    );
    expect(launch).toContain('INSERT INTO public.tournament_launch_receipts');
    expect(launch).toContain('launch_player_ids');
    expect(launch).not.toMatch(/UPDATE public\.tournaments\b/);
    // Before this file the installed core closed only on a completed receipt.
    expect(coreBefore).toContain('v_t.started_at IS NOT NULL OR v_launch_completed_at IS NOT NULL');
    expect(coreBefore).not.toMatch(/IF v_start_authority='sng_actual_start' AND EXISTS \(/);
    expect(diamondBefore).not.toMatch(/IF v_authority='sng_actual_start' AND EXISTS \(/);
  });
});

describe('the migration is safe to install and cannot be silently undone', () => {
  it('is one transaction with bounded locks and aborts on any anchor it cannot find', () => {
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
    expect(sql.match(/was expected exactly once/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain('sit and go launch-begun unregistration refusal did not install exactly');
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
      'public.fn_ca_unregister_tournament_player_exact',
      'public.fn_poker_diamond_tournament_unregister',
    ]);
    expect(mod.missingProbes(sql)).toEqual([]);
  });

  it('no later migration replaces these functions without the rule', () => {
    const later = readdirSync(DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > MIGRATION);
    for (const file of later) {
      const source = read(file);
      for (const [fn, rule] of [
        [
          'fn_ca_unregister_tournament_player_exact',
          'sit and go launch began before unregistration could commit',
        ],
        ['fn_poker_diamond_tournament_unregister', "v_authority='sng_actual_start' AND EXISTS ("],
      ]) {
        if (
          new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`, 'i').test(
            source
          )
        ) {
          expect(source, `${file} replaces ${fn}`).toContain(rule);
        }
      }
    }
  });
});
