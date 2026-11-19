/**
 * THE DEALT-CHAIR CAPTURE NAMES ITS OWN ROW SOURCE (2026-11-18).
 *
 * 20261118164000 aliased the chair insert's row source as x, the function's own
 * loop variable; PL/pgSQL refused every manifest capture as ambiguous. A row
 * source alias in this function must never share a declared variable's name.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const sql = readFileSync(join(resolve(__dirname, '../..'),
  'supabase/migrations/20261118202500_the_dealt_chair_capture_names_its_own_row_source.sql'), 'utf8');

describe('the dealt-chair capture names its own row source', () => {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_cash_capture_hand_manifest(');
  const fn = sql.slice(start, sql.indexOf('$function$;', start));
  const declared = new Set(
    [...fn.slice(fn.indexOf('DECLARE'), fn.indexOf('\nBEGIN')).matchAll(/([a-z_][a-z0-9_]*)\s+[a-z_.%]+[^;,]*[;,]?/gi)]
      .map((m) => m[1].toLowerCase()),
  );

  it('reads the frozen chairs through a column alias no variable shares', () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(fn).toContain('FROM jsonb_array_elements(v_chairs) AS chairs(chair)');
    expect(declared.has('x')).toBe(true);
    expect(declared.has('chair')).toBe(false);
    expect(declared.has('chairs')).toBe(false);
  });

  it('no row source in the capture insert is aliased as a declared variable', () => {
    const insert = fn.slice(fn.indexOf('INSERT INTO smarter_private.cash_hand_chair_clubs'));
    const aliases = [...insert.matchAll(/jsonb_array_elements\([^)]*\)\s+(?:AS\s+)?([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase());
    expect(aliases.length).toBeGreaterThan(0);
    for (const a of aliases) expect(declared.has(a)).toBe(false);
  });
});
