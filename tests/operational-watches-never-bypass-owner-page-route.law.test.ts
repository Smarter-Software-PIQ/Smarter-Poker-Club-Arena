/**
 * LAW: OPERATIONAL WATCHES NEVER BYPASS THE OWNER PAGE ROUTE OR PAGE RECOVERIES
 * (Owner direction, 2026-11-20 15:13 Chicago: "I DO NOT WANT NOTIFICATIONS FOR
 * WHEN THE ISSUES ARE CLEARED, ONLY WHEN THERE IS A PROBLEM... CHANGE THE SYSTEM
 * TO ONLY NOTIFY ME OF PROBLEMS").
 *
 * Why this law exists:
 * Migration 20261119180500 made fn_ca_hand_gap_watch call fn_raise_notification
 * directly on both open and clear, bypassing ca_owner_page_state and spamming
 * "Hand Delay Cleared" to the owner's phone/feed. Migration 20261120034809 fixed
 * that bypass. This law ensures:
 *   1. The owner page trigger zz_a_real_alert_reaches_the_owner remains strictly
 *      gated on WHEN (NEW.status = 'firing') so resolved/cleared events never page.
 *   2. No future migration after 20261120034809 may reintroduce a direct
 *      fn_raise_notification call inside any fn_ca_*_watch function or emit a
 *      "Cleared" / "Resolved" / "Recovered" owner notification.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const ALL_MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const readMigration = (name: string): string => readFileSync(join(MIGRATIONS_DIR, name), 'utf8');

describe('LAW: operational watches never bypass the owner page route or page recoveries', () => {
  it('zz_a_real_alert_reaches_the_owner stays strictly gated on firing status', () => {
    const triggerMigrations = ALL_MIGRATIONS.filter((f) =>
      /CREATE\s+TRIGGER\s+zz_a_real_alert_reaches_the_owner\b/i.test(readMigration(f))
    );
    expect(triggerMigrations.length).toBeGreaterThanOrEqual(1);
    const latest = readMigration(triggerMigrations[triggerMigrations.length - 1]);
    const triggerMatch = latest.match(
      /CREATE\s+TRIGGER\s+zz_a_real_alert_reaches_the_owner\b[\s\S]*?;/i
    );
    expect(triggerMatch).not.toBeNull();
    expect(triggerMatch![0]).toMatch(/WHEN\s*\(\s*NEW\.status\s*=\s*'firing'\s*\)/i);
  });

  it('20261120034809 removed Hand Delay Cleared direct notifications from fn_ca_hand_gap_watch', () => {
    const fixFile = ALL_MIGRATIONS.find((f) => f.startsWith('20261120034809_'));
    expect(fixFile).toBeDefined();
    const sql = readMigration(fixFile!);
    expect(sql).toContain('paged_via');
    expect(sql).toContain('operational_alert_events');
    expect(sql).toContain('hand_delay');
  });

  it('no migration from 20261120034809 onward calls fn_raise_notification from a fn_ca_*_watch function or emits Cleared/Resolved owner pages', () => {
    const newer = ALL_MIGRATIONS.filter((f) => f.slice(0, 14) >= '20261120034809');
    for (const file of newer) {
      const sql = readMigration(file);
      const watchDefs = [
        ...sql.matchAll(
          /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(fn_ca_[a-z0-9_]*watch[a-z0-9_]*)\b[\s\S]*?(?=\n\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|REVOKE\s+ALL|GRANT\s+|COMMIT\s*;|$))/gi
        ),
      ];
      for (const m of watchDefs) {
        const fnName = m[1];
        const body = m[0];
        expect(
          body,
          `${file} (${fnName}) must route operational pages through operational_alert_events / ca_owner_page_state, never call fn_raise_notification directly`
        ).not.toMatch(/\bfn_raise_notification\s*\(/i);
        expect(
          body,
          `${file} (${fnName}) must never emit Cleared/Resolved/Recovered owner notifications`
        ).not.toMatch(
          /'Hand Delay Cleared'|'[^']*\bCleared'|'[^']*\(Resolved\)'|'[^']*\bRecovered'/
        );
      }
    }
  });
});
