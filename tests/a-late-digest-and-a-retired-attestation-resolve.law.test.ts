import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * A LATE DIGEST AND A RETIRED-SOURCE ATTESTATION RESOLVE (2026-11-24).
 *
 * After #11893 twelve rows still fired: 10 chip-integrity attestation copies
 * recorded under the retired 'owner-operational-push' source, which the
 * supersede matched only in 'owner-operational-notifications', and 2
 * DailyDigest.not_delivered rows whose digest was delivered late, which
 * nothing resolved (fn_sp_digest_watchdog only raises). The newest migration
 * that rewrites the attestation supersede must cover both sources, and a
 * migration must resolve sp-digest-missing:<day> when that day's run is sent.
 */
const DIR = join(__dirname, '..', 'supabase', 'migrations');
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');

export const supersedesBothSources = (sql: string) =>
  /e\.source IN \(''owner-operational-notifications'', ''owner-operational-push''\)/.test(sql) &&
  sql.includes('financial_attestation:%');

export const sentDigestResolvesMissing = (sql: string) =>
  /AFTER INSERT OR UPDATE OF status ON public\.sp_daily_digest_runs\s+FOR EACH ROW WHEN \(NEW\.status = 'sent'\)/.test(
    sql
  ) && sql.includes("e.event_key = 'sp-digest-missing:' || NEW.day");

describe('a late digest and a retired-source attestation resolve', () => {
  const supersede = files.filter(
    (f) =>
      read(f).includes('A NEWER CHIP-INTEGRITY ATTESTATION SUPERSEDES') ||
      read(f).includes("''owner-operational-push''")
  );

  it('the newest attestation supersede covers the retired source too', () => {
    expect(supersedesBothSources(read(supersede.at(-1)!))).toBe(true);
  });

  it('would have failed on the #11893 supersede (new source only)', () => {
    expect(
      supersedesBothSources(read('20261124072926_re_measured_attestation_and_digest_supersede.sql'))
    ).toBe(false);
  });

  it('a sent digest run resolves its own not-delivered alert', () => {
    expect(files.some((f) => sentDigestResolvesMissing(read(f)))).toBe(true);
  });
});
