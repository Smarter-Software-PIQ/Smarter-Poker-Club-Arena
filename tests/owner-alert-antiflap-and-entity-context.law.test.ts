import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20261121163606_owner_alert_antiflap_and_actionable_entity_context.sql'
);

describe('owner alert anti-flap dampening and actionable entity context', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('adds rolling 24h flap-tracking columns to ca_owner_page_state and enforces 6h cooldown', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS window_started_at timestamptz');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS pages_in_window integer NOT NULL DEFAULT 0');
    expect(sql).toContain('c_flap_window');
    expect(sql).toContain('c_flap_threshold');
    expect(sql).toContain('c_flap_cooldown');
  });

  it('attaches table_id, tournament_id, and pages_in_24h to owner problem pages without ever paging clears', () => {
    expect(sql).toContain('v_table_id');
    expect(sql).toContain('v_tournament_id');
    expect(sql).toContain('pages_in_24h');
    expect(sql).not.toMatch(/Hand Delay Cleared|Issue Resolved|Problem Cleared/i);
  });
});
