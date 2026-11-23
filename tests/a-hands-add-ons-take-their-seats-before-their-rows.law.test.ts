/**
 * LAW: A HAND'S ADD-ONS TAKE THEIR SEATS BEFORE THEIR ROWS (2026-11-22).
 *
 * The end-of-hand bookkeeping RPC fn_project_hand_side_effects deadlocked six
 * times between 20:16 and 20:23 UTC on 2026-11-22 with the next Lightning
 * hand's settlement (and on 2026-11-18 06:27 UTC; on 2026-11-17 23:09 UTC the
 * same line deadlocked with a cash-out, whose seat exit resolves the add-ons
 * under the seat row). The
 * post-commit envelope it calls (fn_ca_process_hand_post_commit_obligations)
 * locked a pending add-on row (line 459) and then, inside
 * resolve_pending_addon (line 29), the player's seat; the next hand's commit
 * held that seat (fn_lightning_settle_hand line 242, every anchor seat) and
 * then froze the table's add-ons (fn_ca_commit_hand_settlement line 649,
 * ORDER BY created_at, id). Every other door takes the seat first, and the
 * add-ons by created_at, id. Migration 20261123023325 makes the envelope do
 * the same before its loop: the seats, by seat id, then the add-on rows, by
 * created_at, id, each bounded at 1 s; the loop's own resolution order (and so
 * every amount it applies or refunds) is unchanged. Proved natively, before
 * and after, by
 * scripts/dev/prove-a-hands-add-ons-take-their-seats-before-their-rows.py.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const MIGRATION = '20261123023325_a_hands_add_ons_take_their_seats_before_their_rows.sql';
const ENVELOPE = 'fn_ca_process_hand_post_commit_obligations';
/** Production's envelope on 2026-11-23 (read with pg_get_functiondef). */
const LIVE = '39d75365156c46476bfe01854d3c86b9';
/** The same text after this migration's one edit. */
const POST = '16332f6377e82b717505f846e046af32';

const read = (...p: string[]) => readFileSync(resolve(ROOT, ...p), 'utf8');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const between = (s: string, tag: string) => {
  const parts = s.split(`$${tag}$`);
  expect(parts.length, `exactly one $${tag}$ block`).toBe(3);
  return parts[1];
};
const count = (s: string, needle: string) => s.split(needle).length - 1;

const sql = read('supabase', 'migrations', MIGRATION);

/** The production envelope, rebuilt as the post-commit convoy proof rebuilds it. */
function liveEnvelope(): string {
  const fixture = JSON.parse(
    read('scripts', 'ci', 'fixtures', 'cash-rake-pending', 'live-definitions.json')
  );
  let text: string = fixture.functions[ENVELOPE].definition;
  for (const [file, tags] of [
    ['20261118035606_a_cash_hand_never_waits_on_a_tournament_wallet_lock.sql', ['env0']],
    [
      '20261118071736_a_cash_hand_never_waits_on_the_union_bbj_pool_or_insurance_b.sql',
      ['env0', 'env1', 'env2'],
    ],
  ] as const) {
    const m = read('supabase', 'migrations', file);
    for (const tag of tags) {
      const old = between(m, `o${tag}`);
      expect(count(text, old)).toBe(1);
      text = text.replace(old, () => between(m, `n${tag}`));
    }
  }
  const convoy = read(
    'supabase',
    'migrations',
    '20261118073646_a_post_commit_envelope_never_queues_behind_a_slow_predecesso.sql'
  );
  for (let i = 1; i <= 7; i++) {
    const old = between(convoy, `o${i}`);
    expect(count(text, old)).toBe(1);
    text = text.replace(old, () => between(convoy, `n${i}`));
  }
  return text;
}

const live = liveEnvelope();
const oldText = between(sql, 'o');
const newText = between(sql, 'r');
const post = live.replace(oldText, () => newText);
const body = code(post);
const at = (needle: string) => {
  const i = body.indexOf(needle);
  expect(i, needle).toBeGreaterThan(-1);
  return i;
};

const SEATS =
  /PERFORM 1\s+FROM public\.table_pending_addons a\s+JOIN public\.table_seats s\s+ON s\.table_id = a\.table_id\s+AND s\.user_id = a\.user_id\s+AND s\.left_at IS NULL\s+WHERE a\.table_id = v_commit\.table_id\s+AND a\.resolved_at IS NULL\s+AND a\.id = ANY \(ARRAY\([\s\S]*?\)\)\s+ORDER BY s\.id\s+FOR UPDATE OF s;/;
const ADDONS =
  /PERFORM 1\s+FROM public\.table_pending_addons a\s+WHERE a\.table_id = v_commit\.table_id\s+AND a\.id = ANY \(ARRAY\([\s\S]*?\)\)\s+ORDER BY a\.created_at, a\.id\s+FOR UPDATE;/;
const SEAT_LOCK = 'ORDER BY s.id\n       FOR UPDATE OF s;';
const LOOP =
  "FOR v_item IN\n      SELECT value\n        FROM jsonb_array_elements(v_pending->'ids')\n       ORDER BY value #>> '{}'\n    LOOP";

describe("a hand's add-ons take their seats before their rows", () => {
  it("edits production's envelope, once, into the pinned postimage", () => {
    expect(md5(live)).toBe(LIVE);
    expect(count(live, oldText)).toBe(1);
    expect(md5(post)).toBe(POST);
    expect(oldText.endsWith(`${LOOP}\n`)).toBe(true);
    expect(newText.startsWith(oldText.slice(0, oldText.indexOf('FOR v_item IN')))).toBe(true);
    expect(newText.endsWith(`${LOOP}\n`)).toBe(true);
    expect(sql).toContain('was expected exactly once');
    expect(sql).toContain('already takes its seats first: re-read before editing');
    expect(sql).toContain(
      `v_def text := pg_get_functiondef('public.${ENVELOPE}(uuid)'::regprocedure);`
    );
    expect(sql.match(/EXECUTE v_def;/g)).toHaveLength(1);
  });

  it('takes every seat resolve_pending_addon will lock, then every add-on row, before the loop', () => {
    const seats = body.search(SEATS);
    const addons = body.search(ADDONS);
    expect(seats, 'the seat lock').toBeGreaterThan(-1);
    expect(addons, 'the add-on lock').toBeGreaterThan(-1);
    const loop = at(LOOP);
    const row = at('SELECT a.* INTO v_addon');
    const resolver = at('FROM public.resolve_pending_addon(');
    expect(seats).toBeLessThan(addons);
    expect(addons).toBeLessThan(loop);
    expect(loop).toBeLessThan(row);
    expect(row).toBeLessThan(resolver);
    // Exactly one of each: nothing else in the envelope takes a seat.
    expect(count(body, 'FOR UPDATE OF s')).toBe(1);
    expect(count(body, 'public.table_seats')).toBe(1);
    expect(count(body, 'ORDER BY a.created_at, a.id')).toBe(1);
  });

  it("covers exactly the seat resolve_pending_addon locks, and an add-on only of the hand's table", () => {
    const owners = JSON.parse(
      read('tests', 'fixtures', 'promo-profit-movements', 'money-owners.json')
    ) as {
      signature: string;
      definition: string;
    }[];
    const resolver = owners.find(
      (o) => o.signature === 'resolve_pending_addon(uuid,numeric)'
    )!.definition;
    expect(md5(resolver)).toBe('0abfcda28173f8251b4b3cff0ad52be6');
    const r = code(resolver);
    // The resolver: the add-on row, then (unresolved only) the live seat of its player at its table.
    const rowLock = r.search(/FROM table_pending_addons\s+WHERE id = p_pending_id\s+FOR UPDATE;/);
    const resolved = r.indexOf('IF v_row.resolved_at IS NOT NULL THEN');
    const seatLock = r.search(
      /SELECT stack INTO v_stack\s+FROM table_seats\s+WHERE table_id = v_row\.table_id\s+AND user_id\s+= v_row\.user_id\s+AND left_at IS NULL\s+FOR UPDATE;/
    );
    expect(rowLock).toBeGreaterThan(-1);
    expect(resolved).toBeGreaterThan(rowLock);
    expect(seatLock).toBeGreaterThan(resolved);
    // The envelope's seat set is that predicate, for its unresolved add-ons at its table.
    expect(body).toMatch(SEATS);
    // And the loop still refuses a foreign add-on at line 459, under its own lock.
    expect(body).toMatch(
      /SELECT a\.\* INTO v_addon\s+FROM public\.table_pending_addons a\s+WHERE a\.id = \(v_item #>> '\{\}'\)::uuid\s+AND a\.table_id = v_commit\.table_id\s+FOR UPDATE;/
    );
  });

  it("bounds both locks at 1 s like every lock the envelope names; the resolver keeps the caller's wait", () => {
    const BOUND = "PERFORM set_config('lock_timeout', '1s', true);";
    const BACK = "PERFORM set_config('lock_timeout', v_caller_lock_timeout, true);";
    const block = newText.slice(newText.indexOf(BOUND));
    expect(code(block)).toMatch(
      /^PERFORM set_config\('lock_timeout', '1s', true\);\s+PERFORM 1\s+FROM public\.table_pending_addons a\s+JOIN public\.table_seats s[\s\S]*?FOR UPDATE OF s;\s+PERFORM 1\s+FROM public\.table_pending_addons a[\s\S]*?FOR UPDATE;\s+PERFORM set_config\('lock_timeout', v_caller_lock_timeout, true\);\s+FOR v_item IN/
    );
    expect(body.match(/set_config\('lock_timeout'/g)).toHaveLength(8);
    const before = body.slice(0, body.indexOf('public.resolve_pending_addon('));
    expect(before.lastIndexOf(BACK)).toBeGreaterThan(before.lastIndexOf(BOUND));
    // A refusal is still the block's lock_not_available: obligation_lock_busy, retried.
    expect(body.indexOf('EXCEPTION WHEN lock_not_available THEN')).toBeGreaterThan(
      body.search(ADDONS)
    );
  });

  it('leaves the order the loop resolves in, and so every amount, as it was', () => {
    expect(count(live, LOOP)).toBe(1);
    expect(count(post, LOOP)).toBe(1);
    // Outside the inserted block the envelope is byte for byte the production text.
    expect(post.replace(newText, () => oldText)).toBe(live);
    expect(code(newText)).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b\s+(INTO\s+|FROM\s+)?public\./);
  });

  it('takes the locks in the order the other doors already take them', () => {
    // The commit door freezes the table's add-ons by created_at, id after its stack core.
    const ev = JSON.parse(
      read('tests', 'fixtures', 'ev-cashout-lifecycle', 'captured-authorities.json')
    ) as {
      functions: { signature: string; definition: string }[];
    };
    const door = ev.functions.find((f) =>
      f.signature.startsWith('fn_ca_commit_hand_settlement(uuid,bigint,')
    )!.definition;
    const core = door.indexOf('public.fn_ca_commit_hand_settlement_exact_before_obligations(');
    const freeze = door.search(
      /FROM public\.table_pending_addons a\s+WHERE a\.table_id = p_table_id\s+AND a\.resolved_at IS NULL\s+AND a\.created_at <= transaction_timestamp\(\)\s+ORDER BY a\.created_at, a\.id\s+FOR UPDATE;/
    );
    expect(core).toBeGreaterThan(-1);
    expect(freeze).toBeGreaterThan(core);
    // A Lightning settlement locks every anchor seat before it calls that door.
    const settle = read(
      'supabase',
      'migrations',
      '20261001154813_lightning_phase_6_settlement_the_hand_settles_onto_its_ancho.sql'
    );
    const anchor = settle.indexOf('FROM public.table_seats ts WHERE ts.id = a.seat_id FOR UPDATE;');
    expect(anchor).toBeGreaterThan(-1);
    expect(settle.indexOf('v_res := public.fn_ca_commit_hand_settlement(', anchor)).toBeGreaterThan(
      anchor
    );
    // An ended seat (its row held by the UPDATE that fired the trigger) resolves its add-ons by created_at, id.
    const ended = read(
      'supabase',
      'migrations',
      '20261119013426_an_ended_seat_settles_its_pending_addons.sql'
    );
    expect(ended).toMatch(
      /FROM public\.table_pending_addons a\s+WHERE a\.table_id = OLD\.table_id\s+AND a\.user_id = OLD\.user_id\s+AND a\.resolved_at IS NULL\s+ORDER BY a\.created_at, a\.id\s+FOR UPDATE/
    );
  });

  it('is one bounded transaction that probes and verifies the envelope before COMMIT', async () => {
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
    expect(sql).not.toMatch(/@install-window/);
    expect(sql).toContain(`-- @probe-for: public.${ENVELOPE}\n`);
    expect(sql).toMatch(
      /^-- @live-proof: \(SELECT .*FOR UPDATE OF s.*ORDER BY a\.created_at, a\.id.*\)$/m
    );
    expect(sql).toContain('the seat-first add-on locks did not install exactly');
    const probes = await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs'))
        .href
    );
    expect(probes.missingProbes(sql)).toEqual([]);
    // The projection worker never queues on a lock: this file names only the envelope.
    expect(code(sql)).not.toMatch(/fn_project_hand_side_effects(?![a-z0-9_])/);
  });

  it('no later migration takes an add-on before its seat again', () => {
    const later = readdirSync(DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > MIGRATION);
    for (const file of later) {
      const source = readFileSync(resolve(DIR, file), 'utf8');
      if (!source.includes(ENVELOPE)) continue;
      // A full redefinition keeps the seat lock ahead of the add-on lock and the loop.
      let rest = source;
      for (const m of source.matchAll(
        new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.${ENVELOPE}\\(([\\s\\S]*?)\\$function\\$([\\s\\S]*?)\\$function\\$`,
          'g'
        )
      )) {
        rest = rest.replace(m[0], ' ');
        const b = code(m[2]);
        if (!b.includes('jsonb_array_elements(v_pending')) continue;
        expect(
          b.search(SEATS),
          `${file} redefines the envelope without the seat lock`
        ).toBeGreaterThan(-1);
        expect(b.search(SEATS), `${file}: seats before add-ons`).toBeLessThan(b.search(ADDONS));
        expect(b.search(ADDONS), `${file}: add-ons before the loop`).toBeLessThan(
          b.indexOf('SELECT a.* INTO v_addon')
        );
      }
      // An anchored edit quotes the seat lock in its old text and, to keep it, in its
      // new text too: outside full redefinitions it must appear an even number of times.
      expect(
        count(rest, SEAT_LOCK) % 2,
        `${file} removes the envelope's seat lock in an anchored edit`
      ).toBe(0);
    }
  });

  it('the native proof reproduces both deadlocks before and none after, with identical outcomes', () => {
    const proof = read(
      'scripts',
      'dev',
      'prove-a-hands-add-ons-take-their-seats-before-their-rows.py'
    );
    expect(proof).toContain(MIGRATION);
    expect(proof).toContain(`LIVE_MD5 = '${LIVE}'`);
    for (const c of [
      "check('BEFORE case 1: the envelope and the next commit deadlock (40P01)'",
      "check('BEFORE case 2: two add-ons taken in reverse order deadlock (40P01)'",
      "check('AFTER case 1: no deadlock; the commit commits'",
      "check('AFTER case 2: no deadlock; the commit commits'",
      "check(f'CASE 3 ({name}): identical answer, add-on rows, stacks and callee calls'",
    ])
      expect(proof).toContain(c);
    expect(proof).toContain(`POST_MD5 = '${POST}'`);
  });
});
