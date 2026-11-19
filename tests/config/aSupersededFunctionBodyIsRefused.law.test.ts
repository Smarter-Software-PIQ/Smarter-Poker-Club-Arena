/**
 * A SUPERSEDED FUNCTION BODY CAN NEVER BE REPLAYED - incident 758cd269 (2026-11-18)
 *
 * At 06:16 UTC a session re-ran the August file
 * 20260826_tournament_rake_settlement_integrity.sql against production. Its
 * filename version (20260826) was never a recorded version - it had been
 * applied as 20260827011455 - so it looked "pending". It set five tournament
 * money functions back 2.5 months; fn_settle_tournament_rake lost attribution
 * and every tournament finish was refused (TournamentFinishRefusalsPersisting,
 * reason=rake_attribution). It also resurrected a dropped rebuy overload that
 * anon could execute.
 *
 * The database now refuses, at the statement, any CREATE FUNCTION whose body
 * fingerprint is a superseded body of that function (event trigger
 * ca_superseded_function_body_is_refused, SQLSTATE 55000). These pins read the
 * migrations so the law cannot be removed or weakened silently.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, '..', '..', 'supabase', 'migrations');
const GUARD = '20261118072356_a_superseded_function_body_can_never_be_replayed.sql';
const guard = readFileSync(join(DIR, GUARD), 'utf8');
const laterFiles = readdirSync(DIR).filter((f) => f.endsWith('.sql') && f > GUARD);

describe('a superseded function body can never be replayed', () => {
  it('installs the refusal on CREATE FUNCTION and the drop bookkeeping', () => {
    expect(guard).toMatch(/CREATE EVENT TRIGGER ca_superseded_function_body_is_refused ON ddl_command_end/);
    expect(guard).toMatch(/WHEN TAG IN \('CREATE FUNCTION','CREATE PROCEDURE'\)/);
    expect(guard).toMatch(/CREATE EVENT TRIGGER ca_dropped_function_body_is_superseded ON sql_drop/);
  });

  it('refuses with 55000 and names the only escape hatch', () => {
    expect(guard).toMatch(/SUPERSEDED_FUNCTION_BODY_REFUSED/);
    expect(guard).toMatch(/ERRCODE = '55000'/);
    expect(guard).toMatch(/ca\.allow_function_rollback/);
  });

  it('fingerprints bodies so a comment-stripped or re-spaced copy still matches', () => {
    expect(guard).toMatch(/fn_ca_body_fingerprint/);
    expect(guard).toMatch(/'--\[\^\\n\]\*'/);
  });

  it('bookkeeping can never block unrelated DDL, but the refusal is outside that handler', () => {
    const refuse = guard.indexOf('SUPERSEDED_FUNCTION_BODY_REFUSED');
    const handler = guard.indexOf('EXCEPTION WHEN OTHERS THEN', refuse);
    expect(refuse).toBeGreaterThan(0);
    expect(handler).toBeGreaterThan(refuse);
  });

  it('no later migration drops or disables the guard', () => {
    for (const f of laterFiles) {
      const s = readFileSync(join(DIR, f), 'utf8');
      expect(s, f).not.toMatch(/DROP EVENT TRIGGER[^;]*ca_superseded_function_body_is_refused/i);
      expect(s, f).not.toMatch(/ALTER EVENT TRIGGER\s+ca_superseded_function_body_is_refused\s+DISABLE/i);
    }
  });

  it('no later migration sets a blanket rollback allowance', () => {
    for (const f of laterFiles) {
      const s = readFileSync(join(DIR, f), 'utf8');
      expect(s, f).not.toMatch(/ca\.allow_function_rollback\s*=\s*'\*'/i);
      expect(s, f).not.toMatch(/ALTER (DATABASE|ROLE)[^;]*ca\.allow_function_rollback/i);
    }
  });
});
