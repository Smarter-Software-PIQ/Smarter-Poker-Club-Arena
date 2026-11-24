import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * A RESOLVED TWIN RESOLVES ITS FIRING MIRROR (2026-11-24).
 *
 * The financial and drift alert mirrors record a firing row per alert
 * (financial-alerts-backfill/-updates, drift-incidents-backfill/-updates) and a
 * resolved twin when the original resolves. Until 2026-11-24 the twin rule
 * (fn_operational_alert_resolved_twin_closes_firing) only re-labelled the firing
 * rows' investigation_status; their status stayed 'firing', and 38,391
 * financial-alerts-backfill rows were firing for alerts long resolved. The
 * newest migration that rewrites the rule must set the mirror rows' status to
 * 'resolved'.
 */
const DIR = join(__dirname, '..', 'supabase', 'migrations');
const FN = 'fn_operational_alert_resolved_twin_closes_firing';
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');

export function twinResolvesMirror(sql: string): boolean {
  return (
    /UPDATE\s+public\.operational_alert_events\s+o\s+SET\s+status\s*=\s*'resolved'/i.test(sql) &&
    sql.includes("v_prefix || '-backfill'") &&
    sql.includes("f.status = 'firing'")
  );
}

describe('a resolved twin resolves its firing mirror', () => {
  const touching = files.filter((f) => read(f).includes(FN));

  it('the newest rewrite of the twin rule sets the mirror rows resolved', () => {
    expect(touching.length).toBeGreaterThan(0);
    expect(twinResolvesMirror(read(touching.at(-1)!))).toBe(true);
  });

  it('would have failed on the rule that only re-labelled (before 2026-11-24)', () => {
    const before = touching.filter((f) => f < '20261124000000');
    expect(before.length).toBeGreaterThan(0);
    expect(twinResolvesMirror(read(before.at(-1)!))).toBe(false);
  });
});
