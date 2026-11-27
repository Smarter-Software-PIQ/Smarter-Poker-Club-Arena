/**
 * A DEFINER FUNCTION PINS ITS SEARCH PATH (2026-11-27).
 *
 * A SECURITY DEFINER function runs with its owner's rights (postgres, here)
 * and resolves every unqualified name through the search_path it runs under.
 * Without a SET search_path clause that is the CALLER's path, so a caller who
 * can put an object of their own ahead of public can hand an owner-rights
 * function a table, operator or function it never meant to touch. That is
 * the one combination the Supabase advisor's function_search_path_mutable
 * finding is really about. Production held none on 2026-11-27, and no
 * migration since 2026-09-01 has created one; this keeps it that way.
 *
 * What it checks, in every migration from BINDS_FROM on:
 *   1. every CREATE FUNCTION / CREATE PROCEDURE marked SECURITY DEFINER carries
 *      a SET search_path clause, before or after its body;
 *   2. every ALTER ... SECURITY DEFINER names a routine whose newest definition
 *      (or an ALTER since) pins its path;
 *   3. no procedure that COMMITs or ROLLBACKs inside its body carries a SET
 *      clause, because PostgreSQL then refuses its first COMMIT ("invalid
 *      transaction termination"). That is the trap a well-meant advisor fix
 *      falls into, and why five procedures stay unpinned (migration
 *      20261127005018, which also pins 23 invoker functions).
 *
 * Plain (SECURITY INVOKER) functions are not held to (1). They run with the
 * caller's own rights, ~300 have been created without a SET clause since
 * 2026-09-01 (pg_temp helpers among them), and some must stay unpinned on
 * purpose: a SET clause stops the planner inlining a SQL function, measured
 * at 10x on per-row predicates. A law over them would need an exemption list
 * and would turn every open branch red; the pin migration's header records
 * which stay unpinned and why.
 *
 * docs/changelog/2026-11-27-invoker-functions-pin-their-search-path.md
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus } from './helpers/migrationCorpus';

/** Migrations before this are the pre-policy era (333 definers without a path). */
const BINDS_FROM = '20260901000000';
const PIN_MIGRATION = '20261127005018_invoker_functions_pin_their_search_path.sql';

interface Routine {
  /** Lower-cased, schema-qualified name (public. when unqualified). */
  name: string;
  kind: 'FUNCTION' | 'PROCEDURE';
  /** Everything outside the body: the header before it and the options after it. */
  options: string;
  body: string;
}

const NAME = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?`;
const CREATE_HEAD = new RegExp(
  String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\s+(${NAME})\s*\(`,
  'gi'
);
const ALTER_STATEMENT = new RegExp(
  String.raw`\bALTER\s+(?:FUNCTION|PROCEDURE|ROUTINE)\s+(${NAME})\s*(?:\([^;]*?\))?([^;]*);`,
  'gi'
);
const DEFINER = /\bSECURITY\s+DEFINER\b/i;
const PINS_PATH = /\bSET\s+search_path\b/i;
const ANY_SET = /\bSET\s+[A-Za-z_][\w.]*\s*(?:=|TO\b|FROM\s+CURRENT\b)/i;
const TRANSACTION_CONTROL = /(?:^|;|\bTHEN|\bLOOP|\bELSE|\bBEGIN)\s*(?:COMMIT|ROLLBACK)\b/i;

/** Whole-line comments are prose, not DDL: a header may quote a definition. */
const withoutCommentLines = (sql: string): string => sql.replace(/^[ \t]*--[^\n]*$/gm, '');

const normalise = (name: string): string => {
  const n = name.replace(/\s+/g, '').replace(/"/g, '').toLowerCase();
  return n.includes('.') ? n : `public.${n}`;
};

function routineDefinitions(sql: string): Routine[] {
  const text = withoutCommentLines(sql);
  const out: Routine[] = [];
  for (const head of text.matchAll(CREATE_HEAD)) {
    const rest = text.slice(head.index);
    const tag = /\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(rest);
    if (!tag) continue;
    const bodyStart = tag.index + tag[0].length;
    const close = rest.indexOf(tag[0], bodyStart);
    if (close < 0) continue;
    const after = rest.slice(close + tag[0].length);
    const semi = after.indexOf(';');
    out.push({
      name: normalise(head[2]),
      kind: head[1].toUpperCase() as Routine['kind'],
      options: `${rest.slice(0, tag.index)} ${semi < 0 ? after : after.slice(0, semi)}`,
      body: rest.slice(bodyStart, close),
    });
  }
  return out;
}

interface Alteration {
  name: string;
  clause: string;
}
function routineAlterations(sql: string): Alteration[] {
  return [...withoutCommentLines(sql).matchAll(ALTER_STATEMENT)].map((m) => ({
    name: normalise(m[1]),
    clause: m[2],
  }));
}

/** Offences in one migration, given what earlier migrations left each routine with. */
function offences(
  file: string,
  sql: string,
  pinnedBefore: ReadonlyMap<string, boolean>
): { offences: string[]; pinnedAfter: Map<string, boolean> } {
  const found: string[] = [];
  const pinned = new Map(pinnedBefore);
  for (const r of routineDefinitions(sql)) {
    const pins = PINS_PATH.test(r.options);
    if (DEFINER.test(r.options) && !pins) {
      found.push(`${file}: ${r.name} is SECURITY DEFINER with no SET search_path`);
    }
    if (r.kind === 'PROCEDURE' && ANY_SET.test(r.options) && TRANSACTION_CONTROL.test(r.body)) {
      found.push(`${file}: procedure ${r.name} COMMITs but carries a SET clause`);
    }
    pinned.set(r.name, pins);
  }
  for (const a of routineAlterations(sql)) {
    if (PINS_PATH.test(a.clause) && !/\bRESET\b/i.test(a.clause)) pinned.set(a.name, true);
    if (/\bRESET\s+(?:search_path|ALL)\b/i.test(a.clause)) pinned.set(a.name, false);
  }
  for (const a of routineAlterations(sql)) {
    if (DEFINER.test(a.clause) && pinned.get(a.name) !== true) {
      found.push(`${file}: ALTER makes ${a.name} SECURITY DEFINER but its path is not pinned`);
    }
  }
  return { offences: found, pinnedAfter: pinned };
}

describe('a definer function pins its search path', () => {
  it('reads definitions the way they are written in this repository', () => {
    const none = new Map<string, boolean>();
    const check = (sql: string) => offences('x.sql', sql, none).offences;

    // the offence, with the body before the options
    expect(
      check(`CREATE OR REPLACE FUNCTION public.fn_a(p uuid) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER AS $fn$ BEGIN NULL; END $fn$;`)
    ).toHaveLength(1);
    // and with the options after the body, unqualified
    expect(
      check(`CREATE FUNCTION fn_a() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql SECURITY DEFINER;`)
    ).toEqual(['x.sql: public.fn_a is SECURITY DEFINER with no SET search_path']);
    // pinned before the body, pinned after it, pinned to the empty path
    expect(
      check(`CREATE FUNCTION public.fn_a() RETURNS int LANGUAGE sql SECURITY DEFINER
        SET search_path TO 'public', 'pg_temp' AS $$ SELECT 1 $$;`)
    ).toEqual([]);
    expect(
      check(`CREATE FUNCTION public.fn_a() RETURNS int AS $$ SELECT 1 $$
        LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;`)
    ).toEqual([]);
    expect(
      check(`CREATE FUNCTION public.fn_a() RETURNS int LANGUAGE sql SECURITY DEFINER
        SET search_path = '' AS $$ SELECT 1 $$;`)
    ).toEqual([]);
    // an invoker function is not this law's business
    expect(
      check(`CREATE FUNCTION public.fn_a() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;`)
    ).toEqual([]);
    // a body that merely SAYS security definer does not make its function one
    expect(
      check(`CREATE FUNCTION public.fn_a() RETURNS text LANGUAGE sql
        AS $$ SELECT 'SECURITY DEFINER' $$;`)
    ).toEqual([]);
    // a header comment that quotes a definition is prose
    expect(
      check(`-- CREATE OR REPLACE FUNCTION public.fn_a() ... SECURITY DEFINER $$ x $$;
        SELECT 1;`)
    ).toEqual([]);
  });

  it('follows a routine from its definition to an ALTER that makes it a definer', () => {
    const unpinned = offences(
      'a.sql',
      `CREATE FUNCTION public.fn_t() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;`,
      new Map()
    ).pinnedAfter;
    expect(
      offences('b.sql', `ALTER FUNCTION public.fn_t() SECURITY DEFINER;`, unpinned).offences
    ).toEqual(['b.sql: ALTER makes public.fn_t SECURITY DEFINER but its path is not pinned']);
    // pinned in the same file, in the same statement, or by its own definition
    expect(
      offences(
        'b.sql',
        `ALTER FUNCTION public.fn_t() SET search_path = public, pg_temp;
         ALTER FUNCTION public.fn_t() SECURITY DEFINER;`,
        unpinned
      ).offences
    ).toEqual([]);
    expect(
      offences(
        'b.sql',
        `ALTER FUNCTION public.fn_t() SECURITY DEFINER SET search_path = public;`,
        unpinned
      ).offences
    ).toEqual([]);
    const pinned = offences(
      'a.sql',
      `CREATE FUNCTION public.fn_t() RETURNS trigger LANGUAGE plpgsql
         SET search_path = public AS $$ BEGIN RETURN NEW; END $$;`,
      new Map()
    ).pinnedAfter;
    expect(
      offences('b.sql', `ALTER FUNCTION public.fn_t() SECURITY DEFINER;`, pinned).offences
    ).toEqual([]);
  });

  it('refuses a SET clause on a procedure that commits', () => {
    const none = new Map<string, boolean>();
    expect(
      offences(
        'p.sql',
        `CREATE PROCEDURE public.sp_x() LANGUAGE plpgsql SET search_path = public AS $$
         BEGIN FOR i IN 1..3 LOOP PERFORM 1; COMMIT; END LOOP; END $$;`,
        none
      ).offences
    ).toEqual(['p.sql: procedure public.sp_x COMMITs but carries a SET clause']);
    // pinning from inside is the way a committing procedure can do it
    expect(
      offences(
        'p.sql',
        `CREATE PROCEDURE public.sp_x() LANGUAGE plpgsql AS $$
         BEGIN COMMIT; PERFORM set_config('search_path', 'pg_catalog, public', true); END $$;`,
        none
      ).offences
    ).toEqual([]);
    // a procedure that does not commit may pin its path
    expect(
      offences(
        'p.sql',
        `CREATE PROCEDURE public.sp_x() LANGUAGE plpgsql SET search_path = public AS $$
         BEGIN PERFORM 1; END $$;`,
        none
      ).offences
    ).toEqual([]);
  });

  it('no migration since the policy creates a definer without a pinned path', () => {
    let pinned = new Map<string, boolean>();
    const found: string[] = [];
    let judged = 0;
    for (const m of migrationCorpus()) {
      const result = offences(m.name, m.sql, pinned);
      pinned = result.pinnedAfter;
      if (m.name < BINDS_FROM) continue;
      judged++;
      found.push(...result.offences);
    }
    expect(judged, 'the corpus since the policy should not be empty').toBeGreaterThan(1000);
    expect(
      found,
      [
        "A SECURITY DEFINER routine runs with its owner's rights and must not resolve",
        "names through its caller's search_path. Add SET search_path = public, pg_temp",
        '(or the narrowest path its body needs). A procedure that COMMITs cannot carry',
        "a SET clause: pin it from inside with set_config('search_path', ..., true).",
      ].join('\n')
    ).toEqual([]);
  });

  it('the pin migration pins exactly what it proves live, and touches no grant', () => {
    const pin = migrationCorpus().find((m) => m.name === PIN_MIGRATION);
    expect(pin, `${PIN_MIGRATION} must exist`).toBeDefined();
    const sql = pin!.sql;
    const listed = (text: string) =>
      [...text.matchAll(/'((?:public|smarter_private)\.[a-z_0-9]+\([^']*\))'/g)].map((m) => m[1]);
    const proofLine = sql.split('\n').find((l) => l.startsWith('-- @live-proof:'));
    expect(proofLine, 'the pin migration must declare a live proof').toBeDefined();
    const body = sql.slice(sql.indexOf('c_pinned CONSTANT text[]'));
    const pinned = listed(body.slice(0, body.indexOf('];')));
    expect(pinned).toHaveLength(23);
    expect(new Set(pinned).size).toBe(23);
    expect(listed(proofLine!).sort()).toEqual([...pinned].sort());
    expect(sql).toContain(
      "EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', v_fn)"
    );
    expect(proofLine).toContain("c = 'search_path=public, pg_temp'");
    // the watched guard it alters is declared in the same transaction
    expect(pinned).toContain('public.fn_ca_guard_watchlist()');
    expect(sql).toContain("public.fn_ca_declare_guard_redefinition('fn_ca_guard_watchlist',");
    // and it changes no grant: it asserts none moved instead
    expect(withoutCommentLines(sql)).not.toMatch(/\b(?:GRANT|REVOKE)\b/i);
    expect(sql).toContain('EXECUTE grants changed on');

    // The ones it leaves unpinned are named in its header, so nobody "fixes" them.
    const kept = [
      'sp_ca_promo_profit_hourly_sweep',
      'sp_ca_resolve_settled_financial_alerts_in_pages',
      'sp_drain_daily_challenge_event_outbox',
      'sp_union_pnl_projection_build',
      'weekly_prep_shard',
      'fn_gto_v31_public215_cards',
      'fn_gto_v31_public215_keys',
      'fn_gto_v31_public215_runtime_protocol_valid',
      'fn_ca_club_acct_in_snapshot',
      'fn_ca_club_acct_before_snapshot',
      'fn_union_pnl_tournament_entry_club_of',
      'fn_union_pnl_touched_registrations',
      'fn_messenger_continuity_visible',
      'fn_diamond_kind_bucket',
    ];
    for (const name of kept) {
      expect(sql, `${name} is left unpinned and must say why`).toContain(`.${name}(`);
      expect(
        pinned.some((sig) => sig.includes(`.${name}(`)),
        `${name} must not be pinned`
      ).toBe(false);
    }
  });
});
