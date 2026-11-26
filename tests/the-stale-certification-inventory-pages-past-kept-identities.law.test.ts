/**
 * THE STALE CERTIFICATION INVENTORY PAGES PAST KEPT IDENTITIES (2026-11-25)
 *
 * The stale sweep keeps some reserved identities for good: the owner of record
 * of a retired fixture club and a player of record of its finished game. A
 * kept identity is never deleted, so it never leaves
 * fn_ca_stale_certification_accounts, which returns only the 21 oldest. On
 * 2026-11-25 the listing held 21 and every stale one was kept; Rabbit Hunt
 * Certification adds one a day. A full page of identities no door removes
 * hides every newer stale identity: the failure of 2026-11-14 (39 filled the
 * LIMIT 21) and of 2026-10-31 (429 unreached). The inventory is now walked
 * page by page, bounded by the sweep's time budget and never by a count.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'supabase/migrations';
const name = readdirSync(dir).filter((file) =>
  file.endsWith('_the_stale_certification_inventory_pages_past_kept_identities.sql')
);
if (name.length !== 1) throw new Error('Expected One Stale Inventory Paging Migration');
const sql = readFileSync(`${dir}/${name[0]}`, 'utf8');
const code = sql.replace(/^\s*--[^\n]*$/gm, '');
const SIGNATURE = 'public.fn_ca_stale_certification_accounts_after(timestamptz, timestamptz, uuid)';

describe('the stale certification inventory pages past kept identities', () => {
  it('is one transaction that adds a reader and replaces nothing', () => {
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(code.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
    expect(code).toContain(
      'CREATE OR REPLACE FUNCTION public.fn_ca_stale_certification_accounts_after('
    );
    expect(code).not.toMatch(/\b(DROP|DELETE|UPDATE|INSERT|ALTER TABLE|TRUNCATE)\b/);
  });

  it('lists exactly what the first reader lists, strictly after a position', () => {
    expect(code).toContain(
      "WHERE p.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid'"
    );
    expect(code).toContain("AND p.created_at <= LEAST(p_before, now() - interval '40 minutes')");
    expect(code).toContain("AND p.status IS DISTINCT FROM 'deleted'");
    expect(code).toContain('(p.created_at, p.id) > (p_after_created_at, p_after_id)');
    expect(code).toContain('ORDER BY p.created_at, p.id LIMIT 21');
    expect(code).toContain('STABLE SECURITY DEFINER');
    expect(code).toContain("SET search_path TO ''");
    expect(code).toContain("SET statement_timeout TO '8s'");
  });

  it('is callable by the service role only, and proves it at install', () => {
    expect(code).toContain(`REVOKE ALL ON FUNCTION ${SIGNATURE} FROM PUBLIC, anon, authenticated;`);
    expect(code).toContain(`GRANT EXECUTE ON FUNCTION ${SIGNATURE} TO service_role;`);
    expect(code).toContain("ARRAY['postgres','service_role']::text[]");
    expect(code).toContain('STALE_INVENTORY_PAGING_GRANTS_CHANGED');
  });

  it('proves at install that walking every page visits the whole listing once', () => {
    expect(code).toContain('STALE_INVENTORY_PAGING_FIRST_PAGE_MISMATCH');
    expect(code).toContain('STALE_INVENTORY_PAGING_WALK_MISMATCH');
  });

  it('is declared to the schema gates', () => {
    const fragment = JSON.parse(
      readFileSync(
        'scripts/ci/schema-manifest.d/the-stale-certification-inventory-pages-past-kept-identities.json',
        'utf8'
      )
    );
    expect(fragment.functions).toEqual(['fn_ca_stale_certification_accounts_after']);
  });
});
