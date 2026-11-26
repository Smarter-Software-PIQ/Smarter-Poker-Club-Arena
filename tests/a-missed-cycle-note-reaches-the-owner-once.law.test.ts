/**
 * LAW: A MISSED CUTOVER CYCLE REACHES THE OWNER ONCE (2026-11-25, O27).
 *
 * public.fn_ca_note_cycle_did_not_seal sends one Messenger line per three-hourly
 * cycle that did not seal. Stage's next-candidate-after-cycle job calls it
 * (tests/a-cycle-that-did-not-seal-starts-the-next-one.law.test.ts). This law
 * pins what the database does with that call.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(
    __dirname,
    '..',
    'supabase/migrations/20261126031810_an_owner_note_when_a_cutover_cycle_does_not_seal.sql'
  ),
  'utf8'
);

describe('the owner note for a cycle that did not seal', () => {
  it('is sent once per cycle: the cycle is the key and a replay sends nothing', () => {
    expect(sql).toContain('cycle      text PRIMARY KEY');
    expect(sql).toContain('ON CONFLICT (cycle) DO NOTHING;');
    expect(sql).toMatch(
      /IF NOT FOUND THEN\s+RETURN jsonb_build_object\('sent', false, 'reason', 'already noted'/
    );
  });

  it('goes in the owner conversation from the platform sender, and nowhere else', () => {
    expect(sql).toContain(
      'SELECT * INTO STRICT s FROM smarter_private.reliability_settings WHERE id FOR UPDATE;'
    );
    expect(sql).toContain('v_conv := smarter_private.reliability_owner_conversation();');
    expect(sql).toContain('VALUES (v_conv, s.system_sender_id, v_note');
    expect(sql).not.toMatch(/push_outbox/);
  });

  it('only the service role may call it', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_note_cycle_did_not_seal(text, text) FROM PUBLIC, anon, authenticated;'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_ca_note_cycle_did_not_seal(text, text) TO service_role;'
    );
    expect(sql).toContain(
      'REVOKE ALL ON smarter_private.ca_cutover_cycle_notes FROM PUBLIC, anon, authenticated;'
    );
  });

  it('is one transaction and probes its own body on production and on a schema-only copy', () => {
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain('-- @probe-for: public.fn_ca_note_cycle_did_not_seal');
    expect(sql).toContain(
      'IF EXISTS (SELECT 1 FROM smarter_private.reliability_settings WHERE id) THEN'
    );
    expect(sql).toContain(
      "RAISE EXCEPTION 'cutover note probe: a replay sent a second message (%)', v_replay;"
    );
    expect(sql.indexOf('@probe-for')).toBeLessThan(sql.indexOf('COMMIT;'));
  });
});
