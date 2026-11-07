import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Owner, 2026-11-06: guarantee and Free Buy funding accuracy is a line in the
// daily digest, and a prize promo posted while registration is open is
// watched. Executed on native PostgreSQL in
// scripts/ci/test-guarantee-funding-watch.py; this pins the shape.
const MIG =
  'supabase/migrations/20261107041909_free_buy_and_guarantee_funding_is_in_the_daily_digest_and_ea.sql';
const code = readFileSync(MIG, 'utf8').replace(/--[^\n]*/g, ' ');
const proof = readFileSync('scripts/ci/test-guarantee-funding-watch.py', 'utf8');

describe('Free Buy and guarantee funding is a digest line', () => {
  it('compares required with posted per event, by the owner rules, and only reads', () => {
    expect(code).toContain('CREATE FUNCTION public.fn_sp_digest_free_buy_funding(p_day date)');
    expect(code).toMatch(/STABLE\s+SECURITY DEFINER/);
    // Guaranteed: H = max(0, G - C) from the shared calculator; Free Buy without G: H = V.
    expect(code).toContain(
      "CASE WHEN m.g > 0 THEN (m.gf->>'house_required')::numeric ELSE m.entries::numeric END AS required"
    );
    expect(code).toContain("WHEN NOT r.fin THEN 'pending'");
    expect(code).not.toMatch(
      /INSERT INTO public\.chip_ledger|UPDATE public\.(union_wallets|club_members|tournaments)/
    );
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_sp_digest_free_buy_funding\(date\) FROM PUBLIC, anon, authenticated;/
    );
  });

  it('watches a prize promo posted while registration is open, as money', () => {
    expect(code).toContain("c_cutoff_live constant timestamptz := ''2026-11-06 21:06:19+00''");
    expect(code).toContain("SELECT ''early_prize_promo'', l.id::text, fb.id");
    expect(code).toContain("OR f.kind = ''early_prize_promo''");
    expect(code).toContain("'free_buy_without_format', 'early_prize_promo']");
    expect(code).toMatch(/IF v_n <> 0 THEN RAISE EXCEPTION '% sign-up heads posted a prize part/);
  });

  it('is proven on native PostgreSQL against production byte-identical definitions', () => {
    expect(proof).toContain("PROD_WATCH_MD5 = '44fc0264d2fc445ab2a9b696468d7add'");
    expect(proof).toContain('a prize promo posted while registration is open is found');
    expect(proof).toContain('the digest line reads exact, over, under and pending per event');
  });
});
