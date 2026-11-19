/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LAW - A TOURNAMENT FINISH RETIRES ITS PROMO INTEGRITY LOTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 20261116161707 injected the promo integrity retirement into the tournament
 * terminal trigger fn_ca_promo_finish_event_principal(). 20261116190221 then
 * rewrote that function by cutting its body at an anchor that stood BEFORE the
 * injected call and appending its own tail, and the call was silently lost.
 * A finished tournament stopped retiring the promo integrity lots held against
 * it. The orphaned-check watch found it on 2026-11-18, and it could never close
 * its own incident.
 *
 * Migration 20261118155109 restores the call, isolated so a refusal never stops
 * a finish (Dan 2026-11-17: promo chips never cause a payout issue), exempts
 * the two client doors with their reason, and lets the watch close what it
 * opened.
 *
 * This law also binds the FUTURE: no later migration may define or rewrite
 * fn_ca_promo_finish_event_principal without the integrity call, the isolated
 * subtransaction and the alert; and no migration may rebuild a function by
 * truncating its body at an anchor (left(def, position(...)) || tail), which is
 * the cut that lost it.
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus, migrationNames, migrationText } from './helpers/migrationCorpus';

const NAME = migrationNames()
  .filter((n) => n.endsWith('_a_tournament_finish_retires_its_promo_integrity_lots_again.sql'))
  .at(-1);
if (!NAME) throw new Error('the promo integrity finish migration is missing');
const MIG = migrationText(NAME);
const VERSION = NAME.slice(0, 14);

const between = (s: string, a: string, b: string): string => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`window ${a} .. ${b} not found`);
  return s.slice(i, j);
};

describe('a tournament finish retires its promo integrity lots', () => {
  it('pins the trigger function and restores the call after the profit cleanup', () => {
    expect(MIG).toContain(
      "'public.fn_ca_promo_finish_event_principal()',\n  '8eddb8e4843357573d11e7729079e8f7', '18beb5801e0b941b73f61985fabfe607'"
    );
    const n1 = between(MIG, '$n1$', '$n1$]');
    const cleanup = n1.indexOf('PERFORM public.fn_ca_promo_profit_cleanup_settled_event(NEW.id);');
    const call = n1.indexOf('PERFORM public.fn_ca_promo_integrity_finish_event(NEW.id);');
    const ret = n1.lastIndexOf('RETURN NULL;');
    expect(cleanup).toBeGreaterThanOrEqual(0);
    expect(call).toBeGreaterThan(cleanup);
    expect(ret).toBeGreaterThan(call);
  });

  it('never lets a promo integrity refusal stop a tournament finish', () => {
    const n1 = between(MIG, '$n1$', '$n1$]');
    expect(n1).toMatch(
      /BEGIN\s+PERFORM public\.fn_ca_promo_integrity_finish_event\(NEW\.id\);\s+EXCEPTION WHEN OTHERS THEN/
    );
    expect(n1).toContain("'PromoIntegrity.finish_event_refused'");
    expect(n1).toContain("'critical'");
    expect(n1).not.toMatch(/\bRAISE\b/);
  });

  it('exempts the two client doors with their reason, and only those', () => {
    const ex = between(MIG, 'INSERT INTO public.ca_check_sweep_exemptions', 'COMMIT;');
    expect(ex).toContain("'fn_ca_promo_integrity_read'");
    expect(ex).toContain("'fn_ca_promo_integrity_release'");
    expect(ex).not.toContain("'fn_ca_promo_integrity_finish_event'");
    expect(ex).toContain('src/services/PromoIntegrityService.ts');
  });

  it('lets the orphaned-check watch close what it opened, by re-measuring', () => {
    const n2 = between(MIG, '$n2$', '$n2$]');
    expect(n2).toContain('A WATCH CLOSES WHAT IT OPENED');
    expect(n2).toContain("closure_basis = 'verified_remeasured'");
    expect(n2).toContain("WHERE source = 'fn_ca_orphaned_checks_watch' AND resolved_at IS NULL");
    expect(n2).toMatch(/IF COALESCE\(v_n,0\) = 0 THEN/);
  });

  it('closes a trial balance drift only when it reversed, by re-measuring', () => {
    const n4 = between(MIG, '$n4$', '$n4$]');
    expect(n4).toContain('A DRIFT THAT REVERSED IS CLOSED BY RE-MEASURING');
    // the cumulative sum over the episode must be within the threshold: a leak's sum keeps growing
    expect(n4).toMatch(/sum\(\(d\.detail->'differences'->>c\.account\)::numeric\)/);
    expect(n4).toContain("d.ran_at >= c.detected_at - interval '24 hours'");
    expect(n4).toContain('abs(v_net) <= v_thr AND v_recent_ok');
    // AND the last three readings must each be within it
    expect(n4).toContain('ORDER BY ran_at DESC LIMIT 3');
    expect(n4).toContain('count(*) = 3');
    expect(n4).toContain("closure_basis = 'verified_remeasured'");
    // isolated: a close failure never costs the watch its reading
    expect(n4).toMatch(/BEGIN\s+FOR c IN[\s\S]*EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/);
  });

  it('no later migration rewrites the terminal trigger without the isolated integrity call', () => {
    for (const m of migrationCorpus()) {
      if (m.name.slice(0, 14) <= VERSION) continue;
      const touches =
        /FUNCTION\s+public\.fn_ca_promo_finish_event_principal\s*\(/i.test(m.sql) ||
        /pg_get_functiondef\('public\.fn_ca_promo_finish_event_principal\(\)'/.test(m.sql);
      if (!touches) continue;
      expect(m.sql, m.name).toContain('fn_ca_promo_integrity_finish_event(NEW.id)');
      expect(m.sql, m.name).toContain('PromoIntegrity.finish_event_refused');
    }
  });

  it('no later migration rewrites the trial balance watch without its re-measured close', () => {
    for (const m of migrationCorpus()) {
      if (m.name.slice(0, 14) <= VERSION) continue;
      if (!/FUNCTION\s+public\.fn_ca_trial_balance_watch\s*\(/i.test(m.sql)) continue;
      expect(m.sql, m.name).toContain('A DRIFT THAT REVERSED IS CLOSED BY RE-MEASURING');
    }
  });

  it('no later migration rebuilds a function by cutting its body at an anchor', () => {
    const cut = /left\(\s*def\s*,\s*position\([^)]*\bin\s+def\)\s*-\s*1\s*\)\s*\|\|/i;
    for (const m of migrationCorpus()) {
      if (m.name.slice(0, 14) <= VERSION) continue;
      expect(
        m.sql,
        `${m.name} truncates a function body at an anchor; substitute pinned anchors instead`
      ).not.toMatch(cut);
    }
  });
});
