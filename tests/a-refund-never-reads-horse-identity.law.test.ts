/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A REFUND NEVER READS HORSE IDENTITY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner HARD RULE, Dan, 2026-11-08: "HORSES GET REFUNDED 100% OF THE TIME ...
 * I DON'T KNOW WHO STARTED THIS, BUT HORSES GET REFUNDED EXACTLY THE SAME AS A
 * HUMAN 100% OF THE TIME!" It supersedes the 2026-11-05 note "no refunds to
 * horse entries or horse-only events", which Dan never ordered. Every other
 * refund rule applies to a horse identically (the actual eligible entry, less
 * what was already refunded, promo-funded entries back to the union promo fund,
 * auditable, never paid twice). CLAUDE.md 10.5.
 *
 * WHY. smarter_private.owner_retirement_transfer_pools (20261102180105, the money
 * step of the Nov 2 owner retirement) refunded only registrations where
 * `NOT coalesce(p.is_horse,false)` and moved the horses' identical paid entries
 * to the house: 114 events, 2,220 charges, 17,931.00 chips. The older law
 * (a-horse-is-never-the-reason-a-player-is-not-paid) looks for a take-back or a
 * closure beside is_horse; a refund that is simply skipped for one group, with
 * custody then transferred, matched neither shape and passed it.
 *
 * WHAT THIS REFUSES. In every migration from 2026-11-02 on, the LATEST
 * definition of any routine whose name is a money return (refund, cancel,
 * abort, void, retire, closure, unregister, withdraw, unwind, compensate,
 * make_good, transfer_pools, back_refund) may not read horse identity in code:
 * is_horse, is_bot, horse_status, the fleet register or assignments, or a
 * horse email domain. Comments and string literals do not count. A recorded
 * history routine that only IDENTIFIES (a scope guard or restoration that
 * still refunds every entrant) is listed below by name with its reason, and
 * the list cannot grow silently.
 *
 * It also pins the fix and the back-refund: the replacement refuses custody
 * while any paid charge is unrefunded, whoever paid it, and the back-refund
 * pays every pinned charge through one idempotent receipt per entitlement.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripSqlComments } from './a-horse-is-never-the-reason-a-player-is-not-paid.law.test';

const ROOT = join(__dirname, '..');
const MIG_DIR = join(ROOT, 'supabase/migrations');
const FIX = '20261108215333_horses_are_refunded_exactly_as_humans.sql';
export const BINDS_FROM = '20261102000000';

/** A money return, by the routine's own name. */
export const RETURN_NAME =
  /(refund|cancel|abort|void|retire|retirement|closure|unregister|withdraw|unwind|compensat|make_good|transfer_pools|back_refund)/i;
/** Horse identity, in any spelling the platform uses. */
export const HORSE_IDENTITY =
  /\bis_horse\b|\bis_bot\b|\bhorse_status\b|ca_horse_fleet_register|ca_horse_club_assignments|fn_ca_horse_assigned_club/i;
/** The fleet's email domains and prefix: these only ever appear as a pattern literal. */
export const HORSE_EMAIL_PATTERN =
  /'[^']*(?:horses\.smarter\.poker|hydra\.smarter\.poker|horse\.ai|bot\.smarter\.poker|hydra\.bot)[^']*'|'hors%'/i;

/** Identification only: each still refunds every entrant it touches. */
const IDENTIFICATION_ONLY: Record<string, string> = {};

const blankStrings = (code: string) => code.replace(/'(?:[^']|'')*'/g, "''");

export type Routine = { name: string; file: string; body: string };

/** Every CREATE [OR REPLACE] FUNCTION in a migration, with its dollar-quoted body. */
export function routinesIn(sql: string, file: string): Routine[] {
  const out: Routine[] = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:"?\w+"?\.)?"?\w+"?)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const rest = sql.slice(m.index);
    const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
    if (!tag) continue;
    const begin = tag.index + tag[0].length;
    const end = rest.indexOf(tag[1], begin);
    if (end < 0) continue;
    const raw = m[1].replace(/"/g, '').toLowerCase();
    out.push({
      name: raw.includes('.') ? raw : `public.${raw}`,
      file,
      body: rest.slice(begin, end),
    });
  }
  return out;
}

export function readsHorseIdentity(body: string): boolean {
  const code = stripSqlComments(body);
  if (HORSE_IDENTITY.test(blankStrings(code))) return true;
  // A pattern literal is a predicate only where the code compares against it.
  return [...code.matchAll(new RegExp(HORSE_EMAIL_PATTERN.source, 'gi'))].some((m) =>
    /(?:\bi?like|similar\s+to|~\*?|=|<>|!=)\s*$/i.test(
      code.slice(Math.max(0, m.index! - 24), m.index)
    )
  );
}

const migrations = () =>
  readdirSync(MIG_DIR)
    .filter((f) => /^\d{14}_.*\.sql$/.test(f))
    .sort();

function latestRoutines(): Map<string, Routine> {
  const latest = new Map<string, Routine>();
  for (const f of migrations()) {
    for (const r of routinesIn(readFileSync(join(MIG_DIR, f), 'utf8'), f)) latest.set(r.name, r);
  }
  return latest;
}

describe('a refund never reads horse identity', () => {
  it('no money-return routine defined since 2026-11-02 filters on horse identity', () => {
    const offenders: string[] = [];
    for (const [name, r] of latestRoutines()) {
      if (r.file.slice(0, 14) < BINDS_FROM) continue;
      if (!RETURN_NAME.test(name.split('.').pop()!)) continue;
      if (IDENTIFICATION_ONLY[name]) continue;
      if (readsHorseIdentity(r.body)) offenders.push(`${name} (${r.file})`);
    }
    expect(
      offenders,
      'A refund path reads horse identity. Dan 2026-11-08: horses are refunded exactly as humans:\n' +
        offenders.join('\n')
    ).toEqual([]);
  });

  it('the owner retirement money step is the replacement: no horse read, every unrefunded charge refuses', () => {
    const r = latestRoutines().get('smarter_private.owner_retirement_transfer_pools')!;
    expect(r.file).toBe(FIX);
    expect(readsHorseIdentity(r.body)).toBe(false);
    expect(r.body).toContain("RAISE EXCEPTION 'owner_retirement_unrefunded_entry'");
    expect(r.body).not.toContain('owner_retirement_unreviewed_human_registration');
    for (const proof of [
      'tournament_refund_tranches',
      'owner_retirement_manual_refunds',
      'owner_retirement_bank_refunds',
      'source_refund_entitlement_id',
      'horse_refund_parity_receipts',
    ])
      expect(r.body).toContain(proof);
  });

  it('the back-refund pays every pinned charge once, through the audited door, citing the ruling', () => {
    const sql = readFileSync(join(MIG_DIR, FIX), 'utf8');
    const r = routinesIn(sql, FIX).find(
      (x) => x.name === 'smarter_private.horse_refund_parity_back_refund'
    )!;
    expect(r).toBeTruthy();
    expect(readsHorseIdentity(r.body)).toBe(false);
    expect(r.body).toContain('c_owed_n constant integer := 2220');
    expect(r.body).toContain('c_owed_total constant numeric := 17931.00');
    expect(r.body).toContain("'horse-refund-parity-20261108:' || r.id::text");
    expect(r.body).toContain('public.fn_ca_adjustment_under_10_9(');
    expect(r.body).toMatch(
      /Owner hard rule, Dan, 2026-11-08: horses are refunded exactly as humans/
    );
    expect(r.body).toMatch(/INSERT INTO public\.wallet_credit_idempotency/);
    expect(r.body).toMatch(/horse_refund_parity_partial_prior_refund/);
    expect(r.body).toMatch(/horse_refund_parity_source_not_a_player_wallet_charge/);
    expect(sql).toMatch(
      /CREATE TABLE smarter_private\.horse_refund_parity_receipts\(\s*entitlement_id uuid PRIMARY KEY/
    );
    expect(sql).toMatch(
      /horse_refund_parity_receipt_immutable BEFORE UPDATE OR DELETE OR TRUNCATE/
    );
    // Installed, never run, by the migration: the coordinator runs it.
    const executable = stripSqlComments(sql).replace(/\$fn\$[\s\S]*?\$fn\$/g, '');
    expect(executable).not.toMatch(/horse_refund_parity_back_refund\s*\(\s*\d/);
  });

  it('the identification register is empty and cannot grow silently', () => {
    expect(Object.keys(IDENTIFICATION_ONLY)).toEqual([]);
    expect(BINDS_FROM).toBe('20261102000000');
  });
});

describe('the scanner itself', () => {
  it('flags the 2026-11-02 human-only refund gate re-planted', () => {
    const planted = `CREATE OR REPLACE FUNCTION smarter_private.x_transfer_pools(p uuid) RETURNS void LANGUAGE plpgsql AS $f$
      BEGIN IF EXISTS(SELECT 1 FROM public.tournament_players tp JOIN public.profiles p ON p.id=tp.user_id
        WHERE NOT coalesce(p.is_horse,false)) THEN RAISE EXCEPTION 'x'; END IF; END $f$;`;
    const [r] = routinesIn(planted, 'x.sql');
    expect(RETURN_NAME.test(r.name)).toBe(true);
    expect(readsHorseIdentity(r.body)).toBe(true);
  });

  it('flags a refund loop that skips horses by any spelling', () => {
    for (const pred of [
      'p.is_horse',
      'cm.is_bot',
      "p.horse_status <> 'x'",
      "u.email LIKE '%@horses.smarter.poker'",
      "u.email ilike 'hors%'",
      'public.fn_ca_horse_assigned_club(u)',
    ]) {
      const planted = `CREATE FUNCTION public.fn_cancel_refund_all(t uuid) RETURNS void LANGUAGE plpgsql AS $f$
        BEGIN FOR r IN SELECT * FROM x WHERE NOT (${pred}) LOOP NULL; END LOOP; END $f$;`;
      expect(readsHorseIdentity(routinesIn(planted, 'x.sql')[0].body), pred).toBe(true);
    }
  });

  it('does not flag a comment or a message that names horses', () => {
    const ok = `CREATE FUNCTION public.fn_refund_x() RETURNS void LANGUAGE plpgsql AS $f$
      -- horses are refunded exactly as humans (is_horse is never read here)
      BEGIN RAISE NOTICE 'every entrant, horse or human, is refunded; is_horse unread'; END $f$;`;
    expect(readsHorseIdentity(routinesIn(ok, 'x.sql')[0].body)).toBe(false);
  });
});
