/**
 * Weekly payout claims are strict again, and an empty fleet is a truthful
 * claim (2026-11-02). The comparison is 20261028162126's, byte for byte,
 * except that an empty list is no longer refused before the coverage test.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

const dir = 'supabase/migrations';
const body = (name: string) => {
  const s = fs.readFileSync(`${dir}/${name}`, 'utf8');
  const a = s.indexOf('FUNCTION smarter_private.weekly_payout_claims_match');
  const b = s.indexOf('AS $f$', a);
  return s.slice(b, s.indexOf('END $f$', b));
};
const files = fs.readdirSync(dir);
const original = files.find((f) => f.startsWith('20261028162126_'))!;
const strict = files.find((f) =>
  f.endsWith('_weekly_payout_claims_strict_with_truthful_empty_fleet.sql')
)!;

describe('weekly payout claims are strict with a truthful empty fleet', () => {
  const before = body(original);
  const after = body(strict);
  it('drops only the empty-list refusal', () => {
    const emptyRule = '\n  OR jsonb_array_length(p_claims)=0 THEN RETURN false;END IF;';
    expect(before).toContain(emptyRule);
    const expected = before.replace(emptyRule, ' THEN RETURN false;END IF;');
    const actual = after.replace(
      /\n -- AN EMPTY FLEET IS A TRUTHFUL CLAIM[^\n]*\n -- [^\n]*\n/,
      '\n'
    );
    expect(actual).toBe(expected);
  });
  it('keeps every coverage, instance and live-lease test', () => {
    for (const kept of [
      'l.instance_id IS DISTINCT FROM p_instance',
      'l.protocol_version<>2',
      "interval '30 seconds'",
      'HAVING count(*)<>1',
    ])
      expect(after).toContain(kept);
  });
  it('installs only after the record of the relaxed body, and never mid-payout', () => {
    const sql = fs.readFileSync(`${dir}/${strict}`, 'utf8');
    expect(sql).toContain("version='20261102192634'");
    expect(sql).toContain('claims_rule_changes_wait_for_the_weekly_payout');
  });
});
