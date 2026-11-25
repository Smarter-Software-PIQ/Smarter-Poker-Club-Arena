/**
 * LAW: EVERY CASH SEAT WRITER TAKES ITS TABLE FIRST (2026-11-23).
 *
 * A table's row is the parent of every chair at it. The cash-out
 * (20261123024433), the sit-out and the departure request (20261123024034)
 * and the dealt manifest lock the tables row and then the seat, so a writer
 * that locks a seat and only then its table waits for a table one of them
 * holds while that one waits for its seat: a deadlock. The table lock can be
 * hidden: zz_note_human_seat_seen updates tables when a human chair's
 * leave_pending or is_sitting_out changes, and atomic_seat_cashout_locked
 * takes the table itself.
 *
 * 20261123072823 moved the four writers still taking a seat first
 * (fn_lightning_owed_leave_returns_to_pool, fn_lightning_rejoin_seated,
 * player_leave_table, fn_cash_cluster_commit_must_move). This law:
 *
 *  1. reads each of the four live bodies (production's text, md5-pinned in
 *     scripts/dev/fixtures/one-lock-order-live-2026-11-23.json or the
 *     migration that last wrote it), finds the seat-before-table order in it,
 *     applies the migration's own replacement, and finds it gone;
 *  2. reads every LATER migration and refuses any function it defines whose
 *     body locks a seat before its first table lock and then takes the table
 *     (explicitly, through UPDATE tables, through a leave_pending or
 *     is_sitting_out update, or through atomic_seat_cashout_locked), unless
 *     the file names it on a line "-- @seat-before-table: schema.fn <reason>";
 *  3. refuses a later anchored edit that takes one of these table locks out.
 *
 * A NEW chair (INSERT INTO table_seats) is not a seat lock: it is invisible to
 * every reader that locks chairs until it commits, so nobody holding the table
 * can be waiting for it (the buy-in's order since 20261123024433). The native
 * proof scripts/dev/prove-reporting-and-seat-writers-take-one-order.sh shows
 * each of the four deadlocking on its live body and committing after.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const MIGRATION = '20261123072823_every_cash_seat_writer_takes_its_table_first.sql';
const sql = readFileSync(resolve(DIR, MIGRATION), 'utf8');
const fixture = JSON.parse(
  readFileSync(resolve(ROOT, 'scripts/dev/fixtures/one-lock-order-live-2026-11-23.json'), 'utf8')
) as { functions: Array<{ signature: string; production_md5: string; definition: string }> };

/** The $o$ needle and $r$ replacement of the edit block a DO tag names. */
function edit(tag: string): { old: string; next: string } {
  const start = sql.indexOf(`DO $${tag}$`);
  expect(start, `the ${tag} edit block exists`).toBeGreaterThan(-1);
  const block = sql.slice(start, sql.indexOf(`$${tag}$;`, start + tag.length + 4));
  const o = block.indexOf('$o$');
  const r = block.indexOf('$r$');
  return {
    old: block.slice(o + 3, block.indexOf('$o$', o + 3)),
    next: block.slice(r + 3, block.indexOf('$r$', r + 3)),
  };
}

/** One function definition literal from a migration file. */
function fromMigration(file: string, fn: string): string {
  const s = readFileSync(resolve(DIR, file), 'utf8');
  const i = s.indexOf(`CREATE OR REPLACE FUNCTION ${fn}(`);
  expect(i, `${fn} is defined in ${file}`).toBeGreaterThan(-1);
  const tag = /AS (\$[A-Za-z_]*\$)/.exec(s.slice(i))!;
  const bodyStart = i + tag.index + tag[0].length;
  return s.slice(i, s.indexOf(tag[1], bodyStart) + tag[1].length);
}

function fromFixture(signature: string): string {
  const f = fixture.functions.find((x) => x.signature === signature);
  expect(f, `${signature} is in the live-body fixture`).toBeTruthy();
  return f!.definition;
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

const LOCK =
  /\bFOR\s+(?:NO\s+KEY\s+UPDATE|UPDATE|KEY\s+SHARE|SHARE)\b(?:\s+OF\s+([a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*))?/i;
const TABLES = /(?<![\w.])(?:public\.)?tables\b/i;
const SEATS = /(?<![\w.])(?:public\.)?table_seats\b/i;

function aliasOf(stmt: string, alias: string): 'tables' | 'seats' | null {
  const a = alias.toLowerCase();
  if (a === 'tables') return 'tables';
  if (a === 'table_seats') return 'seats';
  if (new RegExp(`(?:public\\.)?tables\\s+(?:AS\\s+)?${a}\\b`, 'i').test(stmt)) return 'tables';
  if (new RegExp(`(?:public\\.)?table_seats\\s+(?:AS\\s+)?${a}\\b`, 'i').test(stmt)) return 'seats';
  return null;
}

/**
 * True when a body locks a seat and later takes its table (explicitly, by
 * UPDATE tables, through a leave_pending / is_sitting_out update or a live
 * chair's DELETE, or through atomic_seat_cashout_locked) with no table lock
 * before that first seat lock. Statements are read one at a time, comments
 * stripped, split at ; and at LOOP / THEN / ELSE; a statement naming
 * table_seats locks the table only through an OF alias bound to tables.
 */
function takesSeatFirst(definition: string): boolean {
  let firstSeat: number | null = null;
  let firstTable: number | null = null;
  // A loop or branch header is its own statement: FOR r IN SELECT ... LOOP.
  const statements = stripComments(definition).split(/;|\bLOOP\b|\bTHEN\b|\bELSE\b/i);
  for (let i = 0; i < statements.length; i += 1) {
    const stmt = statements[i];
    let seat = false;
    let table = false;
    let hiddenTable = false;
    const lock = LOCK.exec(stmt);
    if (SEATS.test(stmt)) {
      if (lock && lock[1]) {
        for (const a of lock[1].split(',')) {
          const kind = aliasOf(stmt, a.trim());
          if (kind === 'seats') seat = true;
          if (kind === 'tables') table = true;
        }
      } else if (lock) {
        seat = true;
      }
      if (/\bUPDATE\s+(?:public\.)?table_seats\b/i.test(stmt)) {
        seat = true;
        if (/\b(?:leave_pending|is_sitting_out)\s*=/i.test(stmt)) hiddenTable = true;
      }
      if (
        /\bDELETE\s+FROM\s+(?:public\.)?table_seats\b/i.test(stmt) &&
        !/left_at\s+IS\s+NOT\s+NULL/i.test(stmt)
      ) {
        seat = true;
        hiddenTable = true;
      }
    } else if (TABLES.test(stmt) && (lock || /\bUPDATE\s+(?:public\.)?tables\b/i.test(stmt))) {
      table = true;
    }
    if (/\b(?:atomic_seat_cashout_locked|fn_cashout_seat_occupancy)\s*\(/i.test(stmt))
      hiddenTable = true;
    if (table && firstTable === null) firstTable = i;
    if (seat && firstSeat === null) firstSeat = i;
    const tableHere = table || hiddenTable;
    const tableBeforeSeat = firstTable !== null && firstSeat !== null && firstTable <= firstSeat;
    if (tableHere && firstSeat !== null && !tableBeforeSeat) return true;
  }
  return false;
}

const LIVE: Array<{ tag: string; fn: string; body: () => string }> = [
  {
    tag: 'owed_leave',
    fn: 'public.fn_lightning_owed_leave_returns_to_pool',
    body: () =>
      fromFixture('public.fn_lightning_owed_leave_returns_to_pool(uuid,uuid,integer,uuid)'),
  },
  {
    tag: 'rejoin',
    fn: 'public.fn_lightning_rejoin_seated',
    body: () =>
      fromMigration(
        '20261026212123_lucky_owner_requested_account_balance.sql',
        'public.fn_lightning_rejoin_seated'
      ),
  },
  {
    tag: 'leave',
    fn: 'public.player_leave_table',
    body: () =>
      fromMigration(
        '20260908214235_seat_expiry_follows_cashout_lock_order.sql',
        'public.player_leave_table'
      ),
  },
  {
    tag: 'must_move',
    fn: 'public.fn_cash_cluster_commit_must_move',
    body: () => fromFixture('public.fn_cash_cluster_commit_must_move(uuid,uuid)'),
  },
];

describe('1. the four live bodies took a seat before their table, and the edits fix each', () => {
  for (const { tag, fn, body } of LIVE) {
    it(`${fn}: seat first on the live body, table first after the edit`, () => {
      const live = body();
      const { old, next } = edit(tag);
      expect(
        live.split(old).length - 1,
        `the ${tag} needle occurs exactly once in the live body`
      ).toBe(1);
      expect(takesSeatFirst(live)).toBe(true);
      const after = live.replace(old, next);
      expect(takesSeatFirst(after)).toBe(false);
      expect(after).toContain('(20261123072823)');
    });
  }

  it('locks in the mode the later table write takes, and the reversion in id order', () => {
    for (const { tag } of LIVE) expect(edit(tag).next).toMatch(/FOR NO KEY UPDATE/);
    expect(edit('must_move').next).toContain(
      'PERFORM 1 FROM public.tables tb WHERE tb.cluster_id = g.id ORDER BY tb.id FOR NO KEY UPDATE;'
    );
  });

  it('the rejoin picks its table with the same predicate and order as the chair it then locks', () => {
    const { next } = edit('rejoin');
    const pick = 'WHERE ts.user_id=u AND ts.left_at IS NULL AND t.cluster_id=p_cluster_id';
    expect(next.split(pick).length - 1).toBe(2);
    expect(next.split('ORDER BY ts.joined_at DESC LIMIT 1').length - 1).toBe(2);
  });

  it('refuses to install twice, verifies, and probes each of the four', () => {
    for (const { fn } of LIVE) {
      expect(sql).toContain(`-- @probe-for: ${fn}`);
    }
    expect(sql.match(/already locks its tables? first: re-read before editing/g)?.length).toBe(4);
    expect(sql).toContain('DO $verify_tables_first$');
    expect(sql.indexOf('DO $verify_tables_first$')).toBeLessThan(sql.indexOf('-- @probe-for:'));
    expect(stripComments(sql)).not.toMatch(/is_horse/);
  });

  it('the md5 in the fixture is the md5 production reported for each body', () => {
    const want: Record<string, string> = {
      'public.fn_lightning_owed_leave_returns_to_pool(uuid,uuid,integer,uuid)':
        '34046d1e6a7e2667458ff140a04e780c',
      'public.fn_cash_cluster_commit_must_move(uuid,uuid)': '5d4a517284692c18b3476651530df044',
    };
    for (const [sig, md5] of Object.entries(want)) {
      expect(fixture.functions.find((f) => f.signature === sig)?.production_md5).toBe(md5);
    }
  });
});

describe('2. the detector itself', () => {
  const fn = (body: string) =>
    `CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $f$\nBEGIN\n${body}\nEND $f$`;

  it('flags a seat locked before its table, however the table is taken', () => {
    expect(
      takesSeatFirst(
        fn(
          'SELECT 1 FROM table_seats WHERE id = x FOR UPDATE; UPDATE tables SET n = 1 WHERE id = t;'
        )
      )
    ).toBe(true);
    expect(
      takesSeatFirst(
        fn(
          'SELECT 1 FROM public.table_seats WHERE id = x FOR UPDATE; PERFORM 1 FROM public.tables WHERE id = t FOR NO KEY UPDATE;'
        )
      )
    ).toBe(true);
    expect(
      takesSeatFirst(
        fn(
          'SELECT 1 FROM table_seats WHERE id = x FOR UPDATE; UPDATE table_seats SET leave_pending = true WHERE id = x;'
        )
      )
    ).toBe(true);
    expect(
      takesSeatFirst(
        fn(
          "SELECT 1 FROM table_seats WHERE id = x FOR UPDATE; PERFORM atomic_seat_cashout_locked(u, t, 1, 'forced');"
        )
      )
    ).toBe(true);
    expect(
      takesSeatFirst(
        fn(
          'SELECT 1 FROM table_seats s JOIN tables t ON t.id = s.table_id FOR UPDATE OF s; UPDATE tables SET n = 1;'
        )
      )
    ).toBe(true);
  });

  it('passes a table locked first, a new chair, and a lock that never reaches the table', () => {
    expect(
      takesSeatFirst(
        fn(
          'PERFORM 1 FROM tables WHERE id = t FOR NO KEY UPDATE; SELECT 1 FROM table_seats WHERE id = x FOR UPDATE; UPDATE tables SET n = 1;'
        )
      )
    ).toBe(false);
    expect(
      takesSeatFirst(
        fn(
          'SELECT 1 FROM table_seats s JOIN tables t ON t.id = s.table_id FOR UPDATE OF t; UPDATE table_seats SET stack = 1;'
        )
      )
    ).toBe(false);
    expect(
      takesSeatFirst(
        fn(
          'INSERT INTO table_seats(table_id) VALUES (t); PERFORM 1 FROM tables WHERE id = t FOR NO KEY UPDATE;'
        )
      )
    ).toBe(false);
    expect(
      takesSeatFirst(
        fn(
          'SELECT 1 FROM table_seats WHERE id = x FOR UPDATE; UPDATE table_seats SET stack = 0 WHERE id = x;'
        )
      )
    ).toBe(false);
    expect(
      takesSeatFirst(
        fn('-- SELECT 1 FROM table_seats FOR UPDATE; UPDATE tables SET n = 1;\nSELECT 1;')
      )
    ).toBe(false);
    expect(
      takesSeatFirst(
        fn(
          'FOR r IN SELECT id FROM tables WHERE club_id = c FOR UPDATE LOOP FOR s IN SELECT id FROM table_seats WHERE table_id = r.id FOR UPDATE LOOP NULL; END LOOP; END LOOP; UPDATE tables SET status = 1;'
        )
      )
    ).toBe(false);
  });
});

/** Every literal function definition in a migration file. */
function definitions(source: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re =
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+((?:"?[a-z_][a-z0-9_]*"?\.)?"?[a-z_][a-z0-9_]*"?)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const tag = /\bAS\s+(\$[A-Za-z_]*\$)/i.exec(source.slice(m.index));
    if (!tag) continue;
    const bodyStart = m.index + tag.index + tag[0].length;
    const end = source.indexOf(tag[1], bodyStart);
    if (end < 0) continue;
    const name = m[1].replace(/"/g, '').toLowerCase();
    out.push({
      name: name.includes('.') ? name : `public.${name}`,
      body: source.slice(m.index, end + tag[1].length),
    });
  }
  return out;
}

const later = readdirSync(DIR)
  .filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > MIGRATION)
  .map((file) => ({ file, source: readFileSync(resolve(DIR, file), 'utf8') }));

describe('3. no later migration takes a seat before its table again', () => {
  it('every function a later migration defines locks its table before its first seat', () => {
    const offenders: string[] = [];
    for (const { file, source } of later) {
      const exempt = new Set(
        [
          ...source.matchAll(
            /^[ \t]*--[ \t]*@seat-before-table:[ \t]*([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)[ \t]+\S.{19,}$/gim
          ),
        ].map((x) => x[1].toLowerCase())
      );
      for (const d of definitions(source)) {
        if (!exempt.has(d.name) && takesSeatFirst(d.body)) offenders.push(`${file}: ${d.name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no later anchored edit takes one of these table locks out', () => {
    const locks = [...LIVE.map(({ tag }) => edit(tag).next)]
      .flatMap((r) => r.split('\n'))
      .map((l) => l.trim())
      .filter((l) => /^PERFORM 1 FROM (?:public\.)?tables\b.*FOR NO KEY UPDATE;$/.test(l));
    expect(locks.length).toBe(3);
    for (const { file, source } of later) {
      for (const block of source.matchAll(/\$o\$([\s\S]*?)\$o\$[\s\S]*?\$r\$([\s\S]*?)\$r\$/g)) {
        for (const lock of locks) {
          if (block[1].includes(lock)) {
            expect(block[2], `${file} keeps "${lock}"`).toContain(lock);
          }
        }
      }
    }
  });
});
