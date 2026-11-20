/**
 * LAW: A HAND DELAY PAGES THROUGH THE OWNER PAGE ROUTE, NOT AROUND IT
 * (Production Alerts fleet, routing defect hand-delay-owner-page-route).
 *
 * 20261119180500 made fn_ca_hand_gap_watch call fn_raise_notification on every
 * open and every clear of every kind x shape, so a delay flapping around the
 * budget pushed the owner's phone every 15-30 minutes (18 pushes in 100
 * minutes on 2026-11-20, four in one second). 20261120034809 removes the
 * watch's own notifications; its financial_alerts row reaches the private
 * alert store, and the one governed page path (20261007000420) pages a
 * hand-delay episode once under its own kind, holding and counting flaps.
 *
 * Pinned here, statically:
 *   1. the newest migration that defines fn_ca_hand_gap_watch never calls
 *      fn_raise_notification or any notification table;
 *   2. that migration maps exactly the store's hand-delay row to the page
 *      kind 'hand_delay' with its own ca_owner_page_state row and title;
 *   3. no later migration reintroduces a direct notification in the watch.
 * The behaviour is proved on PostgreSQL by scripts/ci/test-hand-gap-watch.py
 * (workflow hand-gap-watch-proof.yml), on the production pre-image of the
 * page route.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const DIR = join(ROOT, 'supabase', 'migrations');
const FILE = '20261120034809_a_hand_delay_pages_through_the_owner_page_route.sql';
const sql = readFileSync(join(DIR, FILE), 'utf8');
const code = (s: string) => s.replace(/--[^\n]*/g, ' ');

const definesWatch = (s: string) =>
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_ca_hand_gap_watch\s*\(/i.test(code(s));

describe('a hand delay pages through the owner page route, not around it', () => {
  it('the newest definition of fn_ca_hand_gap_watch notifies nobody itself', () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) => definesWatch(readFileSync(join(DIR, f), 'utf8')));
    const newest = files[files.length - 1];
    expect(newest >= FILE, `newest watch definition is ${newest}`).toBe(true);
    for (const f of files.filter((x) => x >= FILE)) {
      const body = code(readFileSync(join(DIR, f), 'utf8')).split('$f$')[1] ?? '';
      expect(body.length, f).toBeGreaterThan(0);
      expect(body, f).not.toMatch(/fn_raise_notification|\bnotifications\b|push_outbox|send_sms/i);
      expect(body, f).not.toMatch(/ca_incident_recipients/);
    }
  });

  it('the watch still detects: history, one critical alert per kind x shape, auto-resolve', () => {
    const body = code(sql).split('$f$')[1] ?? '';
    expect(body).toContain('ON CONFLICT (window_end, kind, shape) DO NOTHING');
    expect(body).toContain("VALUES ('critical', c_source,");
    expect(body).toContain("fa.context->>'kind' = r.kind AND fa.context->>'shape' = r.shape");
    expect(body).toMatch(/c_windows\s+constant int\s+:= 3;/);
    expect(body).toContain("'paged_via', 'operational_alert_events'");
  });

  it('the store row for a hand delay pages under its own kind, title and clock', () => {
    expect(sql).toContain(
      "WHEN p_source = ''financial-alerts-backfill'' AND p_alertname = ''fn_ca_hand_gap_watch'' AND p_severity = ''critical'' THEN ''hand_delay''"
    );
    expect(sql).toContain("WHEN ''hand_delay'' THEN ''Unintended Delay Between Hands''");
    expect(sql).toContain("INSERT INTO public.ca_owner_page_state (kind) VALUES ('hand_delay')");
    expect(sql).toMatch(/CHECK \(kind IN \([^)]*'cutover_readiness', 'hand_delay'\)\)/);
    // The page must not be diverted back into the store by the owner capture.
    expect(sql).toContain('HAND_DELAY_PAGE_WOULD_BE_DIVERTED');
    // Patches the live route by exact anchors, once each, or aborts.
    expect((sql.match(/anchor did not match exactly once/g) ?? []).length).toBe(1);
  });

  it('is one transaction with a bounded lock and a rolled-back probe', () => {
    expect((sql.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((sql.match(/^COMMIT;$/gm) ?? []).length).toBe(1);
    expect(sql).toMatch(/SET LOCAL lock_timeout = '3s';/);
    expect(sql).toContain("RAISE EXCEPTION 'probe-unwind'");
    expect(sql).toMatch(/^-- @live-proof: \(SELECT /m);
  });
});
