/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LAW - A SHARED MYSTERY CHEST SETTLES IN THE WHOLE CHIPS IT WAS SPLIT IN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two functions must agree on how a mystery chest is divided between the
 * players who shared the knockout pot:
 *
 *   - fn_mystery_bounty_reserve WRITES the split (the recipient rows);
 *   - fn_bounty_obligation_has_complete_marker PROVES it was paid exactly,
 *     and fn_mystery_bounty_pay raises - rolling the whole payment back - when
 *     the proof is false after paying.
 *
 * 20261022170421 moved the writer to whole chips (GREATEST(100, unit)) and
 * left the proof at the money unit. On 2026-11-16 an 11-chip chest shared by
 * two players was written 6 + 5; the proof demanded 5.50 + 5.50, so every
 * retry paid, failed the proof and rolled back. One obligation stuck the
 * bounty outbox, failed the recovery lane, and held every later bust in the
 * event (27 unrecorded, no table could break).
 *
 * This law ties the two together: the newest proof must accept the cut the
 * newest writer makes, and must keep accepting the money-unit cut every chest
 * reserved before 2026-10-22 was paid at. Change one side without the other
 * and this goes red.
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus, migrationNames, migrationText } from './helpers/migrationCorpus';

const SLUG = '_a_shared_mystery_chest_settles_in_its_whole_chip_split.sql';
const hits = migrationNames().filter((n) => n.endsWith(SLUG));
const NAME = hits.at(-1);
if (!NAME) throw new Error('the shared-chest marker migration is missing');
const SQL = migrationText(NAME);

/** Block and line comments cannot satisfy a pin. */
const code = (sql: string): string => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
const squash = (s: string): string => s.replace(/\s+/g, ' ');

const MARKER_DEF = 'CREATE OR REPLACE FUNCTION public.fn_bounty_obligation_has_complete_marker(';
const RESERVE_DEF = 'CREATE OR REPLACE FUNCTION public.fn_mystery_bounty_reserve(';

/** The body of the newest definition of the proof, in version order. */
const latestMarkerBody = (): { name: string; body: string } => {
  const defs = migrationCorpus().filter((m) => m.sql.includes(MARKER_DEF));
  const last = defs.at(-1);
  if (!last) throw new Error('no migration defines the complete marker');
  const from = last.sql.lastIndexOf(MARKER_DEF);
  const open = last.sql.indexOf('$function$', from);
  const close = last.sql.indexOf('$function$', open + 1);
  return { name: last.name, body: last.sql.slice(open, close) };
};

/**
 * The unit expression the newest reserve writer splits a chest at, in version
 * order: a full redefinition sets it from its own `v_unit` line, and an
 * in-place edit (`EXECUTE replace(d, a, 'v_unit integer := ...;')`) from the
 * replacement it installs.
 */
const latestWriterUnit = (): string | null => {
  let unit: string | null = null;
  for (const m of migrationCorpus()) {
    if (!m.sql.includes('fn_mystery_bounty_reserve')) continue;
    const text = code(m.sql);
    const create = text.lastIndexOf(RESERVE_DEF);
    if (create >= 0) {
      const line = text.slice(create).match(/v_unit integer := ([^;]+);/);
      if (line) unit = line[1].trim();
    }
    const edit = text.match(/EXECUTE replace\(d, a,\s*'v_unit integer := ([^;']+);'\)/);
    if (edit) unit = edit[1].trim();
  }
  return unit;
};

describe('LAW: a shared mystery chest settles in the whole chips it was split in', () => {
  it('ships as exactly one single-transaction migration with a lock budget', () => {
    expect(hits).toHaveLength(1);
    expect(SQL.match(/^BEGIN;$/gm) ?? []).toHaveLength(1);
    expect(SQL.match(/^COMMIT;$/gm) ?? []).toHaveLength(1);
    expect(SQL).toMatch(/^SET LOCAL lock_timeout='\d+s';$/m);
    expect(SQL).toMatch(/^SET LOCAL statement_timeout='\d+s';$/m);
    expect(SQL.split('CREATE OR REPLACE FUNCTION').length - 1).toBe(1);
  });

  it('replaces only the live body it was qualified against', () => {
    expect(SQL).toContain("IS DISTINCT FROM '663946f381864909b4bef1b7755e37b6' THEN");
    expect(SQL).toContain("'public.fn_bounty_obligation_has_complete_marker(uuid)'::regprocedure");
  });

  it('the reserve writer splits a shared chest in whole chips', () => {
    expect(latestWriterUnit()).toBe(
      'GREATEST(100, public.fn_ca_tournament_unit_cents(p_tournament_id))'
    );
  });

  it('the newest proof accepts the whole-chip cut the writer makes and the money-unit cut older chests were paid at', () => {
    const { name, body } = latestMarkerBody();
    expect(name >= NAME, `${name} is the newest proof; it must not predate ${NAME}`).toBe(true);
    const proof = squash(code(body));
    expect(proof).toContain(
      squash(`FROM (SELECT DISTINCT v.unit FROM (VALUES
               (public.fn_ca_tournament_unit_cents(o.tournament_id)),
               (GREATEST(100, public.fn_ca_tournament_unit_cents(o.tournament_id)))
             ) v(unit)) u`)
    );
    // Either cut is exact claimant by claimant: one unit for which no claimant is missing.
    expect(proof).toMatch(/AND EXISTS \( SELECT 1 FROM \(SELECT DISTINCT v\.unit/);
    expect(proof).toContain(
      '+ CASE WHEN ordinal <= mod(a.amount_cents,claimant_count) THEN 1 ELSE 0 END'
    );
    expect(proof).toContain('+ CASE WHEN ordinal = 1 THEN a.amount_cents');
    expect(proof).toContain("row_number() OVER (ORDER BY c->>'user_id') AS ordinal");
    expect(proof).toContain('AND r.amount_cents=expected.expected_cents AND r.paid_at IS NOT NULL');
  });

  it('leaves the regular and PKO proof at the money unit, where fn_collect_bounty pays it', () => {
    const proof = squash(code(latestMarkerBody().body));
    const regular = proof.slice(proof.indexOf(' ELSE NOT EXISTS ('));
    expect(regular.length).toBeGreaterThan(500);
    expect(regular).toContain(
      'CROSS JOIN (SELECT public.fn_ca_tournament_unit_cents(o.tournament_id) AS unit) u'
    );
    expect(regular).not.toContain('GREATEST(100');
  });

  it('refuses to install if any already-settled mystery chest would stop proving', () => {
    const tail = code(SQL.slice(SQL.indexOf('$postcheck$')));
    expect(squash(tail)).toContain(
      "WHERE o.mode='mystery_chest' AND o.state='settled' AND NOT public.fn_bounty_obligation_has_complete_marker(o.id)) THEN RAISE EXCEPTION"
    );
  });

  it('keeps the proof callable only by the service role', () => {
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.fn_bounty_obligation_has_complete_marker(uuid) FROM PUBLIC, anon, authenticated;'
    );
    expect(SQL).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_bounty_obligation_has_complete_marker(uuid) TO service_role;'
    );
  });
});
