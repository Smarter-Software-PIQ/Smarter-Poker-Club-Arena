/**
 * LAW: A MISSED CUTOVER CYCLE IS RECORDED IN THE ALERT STORE BEFORE THE OWNER
 * IS TOLD (Production Alerts incident cycle-not-sealed-owner-note-unrouted,
 * 2026-11-27; landed 2026-11-28).
 *
 * 20261126031810 sent the owner a Messenger note for every cycle that did not
 * seal and wrote nothing to public.operational_alert_events, so seven missed
 * cycles (2026-11-26T10/T13/T19/T22, 2026-11-27T07/T13, 2026-11-28T07) reached
 * no lane. This law reads the LATEST migration that defines
 * public.fn_ca_note_cycle_did_not_seal and requires that its body records the
 * cycle through the store's recorder, addressed to the fleet, refuses to send
 * without a store id, and does so before the Messenger insert. It fails on the
 * pre-fix corpus, where the only definition is 20261126031810.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const PRE_FIX = '20261126031810_an_owner_note_when_a_cutover_cycle_does_not_seal.sql';
const DEFINES = /CREATE (OR REPLACE )?FUNCTION public\.fn_ca_note_cycle_did_not_seal\s*\(/;

const defining = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => DEFINES.test(readFileSync(join(DIR, f), 'utf8')));
const latest = defining[defining.length - 1];
const sql = readFileSync(join(DIR, latest), 'utf8');
const body = (() => {
  const start = sql.search(DEFINES);
  const open = sql.indexOf('$fn$', start);
  const close = sql.indexOf('$fn$', open + 4);
  return sql.slice(open, close);
})();

describe('a cutover cycle that did not seal is recorded in the alert store', () => {
  it('the live definition is not the pre-fix one', () => {
    expect(defining.length).toBeGreaterThan(1);
    expect(latest).not.toBe(PRE_FIX);
  });

  it('records the cycle through the store recorder, addressed to the fleet', () => {
    expect(body).toContain('public.fn_record_operational_alert(');
    expect(body).toContain("'engine-cutover-watch', 'cycle-not-sealed:' || p_cycle");
    expect(body).toContain("'target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca'");
    expect(body).not.toMatch(/'critical'/);
  });

  it('refuses to send the note without a store id, and records before it sends', () => {
    expect(body).toMatch(/IF v_alert IS NULL THEN\s+RAISE EXCEPTION/);
    const record = body.indexOf('public.fn_record_operational_alert(');
    const send = body.indexOf('INSERT INTO public.social_messages');
    expect(record).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(record);
    expect(body).toContain('SET message_id = v_msg, alert_id = v_alert');
  });

  it('keeps one note per cycle and the service-role-only grant', () => {
    expect(body).toContain('ON CONFLICT (cycle) DO NOTHING;');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_note_cycle_did_not_seal(text, text) FROM PUBLIC, anon, authenticated;'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_ca_note_cycle_did_not_seal(text, text) TO service_role;'
    );
  });

  it('records the cycles noted before the fix once, and probes the store row before commit', () => {
    expect(sql).toContain("RAISE EXCEPTION 'a noted cutover cycle is still missing its store row';");
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain('-- @probe-for: public.fn_ca_note_cycle_did_not_seal');
    expect(sql).toContain(
      "RAISE EXCEPTION 'cutover note probe: no addressed store row for the cycle (%)', v_first;"
    );
    expect(sql.indexOf('$record$')).toBeLessThan(sql.indexOf('@probe-for'));
    expect(sql.indexOf('@probe-for')).toBeLessThan(sql.indexOf('COMMIT;'));
  });
});
