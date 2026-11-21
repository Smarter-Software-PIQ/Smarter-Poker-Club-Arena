/**
 * LAW: INERT LEGACY PIN-MANIFEST FUNCTIONS STAY RETIRED (2026-11-20, Wave 2
 * hardening).
 *
 * Two completed one-shot pin-manifest functions kept tripping the applier's
 * stale-pin guard (migration-stale-pins.mjs) on unrelated tournament and
 * hand-settlement migrations:
 *   1. smarter_private.original_hand_correction_sources_match() (26 pins;
 *      historical correction window closed, already returned false on prod).
 *   2. public.fn_ca_guard_mtt_admission_contract() (149 pins; read only on the
 *      completed legacy-capacity-v1 -> unlimited-mtt-v2 transition).
 *
 * Migration 20261120213500_retire_inert_legacy_pin_manifests.sql retires both
 * to pin-free forms while preserving exact runtime behavior (false return;
 * MTT_ADMISSION_CONTRACT_IMMUTABLE enforcement on ca_mtt_admission_contract).
 *
 * This law keeps both functions pin-free and guards that no later migration
 * reintroduces md5 pins into either function.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allowedStalePins } from '../scripts/ci/migration-stale-pins.mjs';
import { missingProbes } from '../scripts/ci/migration-function-probes.mjs';

const DIR = resolve(process.cwd(), 'supabase/migrations');
const RETIREMENT = '20261120213500_retire_inert_legacy_pin_manifests.sql';
const SQL = readFileSync(resolve(DIR, RETIREMENT), 'utf8');

const HAND_CORRECTION_HEAD =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+smarter_private\.original_hand_correction_sources_match\s*\(\s*\)/gi;
const MTT_GUARD_HEAD =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_ca_guard_mtt_admission_contract\s*\(\s*\)/gi;

function extractBodies(sql: string, head: RegExp): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(head)) {
    const rest = sql.slice(m.index ?? 0);
    const tag = rest.match(/AS\s+(\$[A-Za-z_]*\$)/);
    if (!tag || tag.index === undefined) throw new Error('function body has no dollar quote');
    const start = tag.index + tag[0].length;
    const end = rest.indexOf(tag[1], start);
    out.push(rest.slice(0, tag.index) + '\n' + rest.slice(start, end));
  }
  return out;
}

function assertHandCorrectionRetired(body: string) {
  expect(body).toMatch(/LANGUAGE\s+sql\s+STABLE\b/i);
  expect(body).toMatch(/\bSELECT\s+false\s*;/i);
  expect(body).not.toMatch(/[0-9a-f]{32}/);
  expect(body).not.toMatch(/\$sourcepins\$/i);
}

function assertMttGuardRetired(body: string) {
  const code = body.replace(/--[^\n]*/g, '');
  expect(code).toMatch(/RETURNS\s+trigger\b/i);
  expect(code).toMatch(/LANGUAGE\s+plpgsql\b/i);
  expect(code).toContain("RAISE EXCEPTION 'MTT_ADMISSION_CONTRACT_IMMUTABLE'");
  expect(body).not.toMatch(/[0-9a-f]{32}/);
  expect(code).not.toMatch(/\$prepared\$/i);
  expect(code).not.toMatch(/legacy-capacity-v1/);
}

describe('inert legacy pin-manifest functions stay retired', () => {
  it('retires both functions in one transaction with lock_timeout, live-proof, probes, and zero stale pins', () => {
    expect(SQL.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(SQL.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(SQL).toContain("SET LOCAL lock_timeout = '3s';");
    expect(allowedStalePins(SQL)).toEqual([]);
    expect(missingProbes(SQL)).toEqual([]);
    expect(SQL).toMatch(/^-- @live-proof: .*original_hand_correction_sources_match\(\) IS FALSE/m);
    expect(SQL).toContain('-- @probe-for: smarter_private.original_hand_correction_sources_match');
    expect(SQL).toContain('-- @probe-exempt: public.fn_ca_guard_mtt_admission_contract');

    const handBodies = extractBodies(SQL, HAND_CORRECTION_HEAD);
    expect(handBodies).toHaveLength(1);
    assertHandCorrectionRetired(handBodies[0]);

    const mttBodies = extractBodies(SQL, MTT_GUARD_HEAD);
    expect(mttBodies).toHaveLength(1);
    assertMttGuardRetired(mttBodies[0]);
  });

  it('no later migration reintroduces md5 pins into either retired function', () => {
    const later = readdirSync(DIR)
      .filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > RETIREMENT)
      .sort();
    for (const f of later) {
      const sql = readFileSync(resolve(DIR, f), 'utf8');
      for (const body of extractBodies(sql, HAND_CORRECTION_HEAD))
        assertHandCorrectionRetired(body);
      for (const body of extractBodies(sql, MTT_GUARD_HEAD)) assertMttGuardRetired(body);
    }
  });
});
