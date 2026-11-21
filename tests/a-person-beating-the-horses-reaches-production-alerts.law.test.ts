/**
 * A PERSON BEATING THE PLO HORSES BEYOND 2 SE REACHES PRODUCTION ALERTS WITHIN THE HOUR
 * (PLO-OWNER repair programme, lane EXPOSURE, 2026-11-20).
 *
 * fn_ca_horse_exposure_watch (migration 20261121011654) reads each person's PLO4/PLO5 cash result against
 * the Horses every hour and raises one warning when the EV-adjusted rate is above +2 SE. These laws keep
 * it what it was built to be:
 *
 *   1. an analysis trigger only: its body writes its own run table and the Production Alerts inbox and
 *      nothing else; it reads no Horse option, setting or seat table, so it can never change a decision;
 *   2. a warning that never pages: its source and alert name are absent from the newest
 *      fn_ca_owner_page_kind on main, and the migration proves it against production at install;
 *   3. the declared rule: windows 500 / 1,000 / 2,500 and 60 days, +2 SE on the EV-adjusted rate;
 *   4. hourly at :17, outside the :50-:03 break window;
 *   5. its native proof runs on every change to it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const FILE = '20261121011654_a_person_beating_the_plo_horses_reaches_production_alerts.sql';
const migration = read(`supabase/migrations/${FILE}`);
const workflow = read(
  '.github/workflows/a-person-beating-the-horses-reaches-production-alerts.yml'
);
const body = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.fn_ca_horse_exposure_watch'),
  migration.indexOf('REVOKE ALL ON FUNCTION smarter_private.fn_ca_horse_exposure_hands')
);
const helper = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION smarter_private.fn_ca_horse_exposure_hands'),
  migration.indexOf('CREATE OR REPLACE FUNCTION public.fn_ca_horse_exposure_watch')
);
const code = (s: string) => s.replace(/--[^\n]*/g, '');

describe('the exposure watch only starts an analysis', () => {
  it('writes only its run table and the Production Alerts inbox', () => {
    const writes = [...code(body).matchAll(/\b(INSERT\s+INTO|UPDATE)\s+([a-z_]+\.[a-z_]+)/gi)].map(
      (m) => m[2]
    );
    expect(new Set(writes)).toEqual(
      new Set(['smarter_private.ca_horse_exposure_runs', 'public.operational_alert_events'])
    );
    // three writes: its run row, alert records through fn_record_operational_alert, 'resolved' on its own alerts
    expect(code(body)).toMatch(
      /WHERE e\.source = c_source AND e\.alertname = c_alert AND e\.status = 'firing'/
    );
    expect(code(body)).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|\bALTER\b/i);
    expect(code(body)).toContain(
      "public.fn_record_operational_alert(c_source, v_key, c_alert, 'firing', 'warning'"
    );
  });

  it('reads no Horse option, setting, seat or table row, and the helper is a read-only SQL function', () => {
    for (const forbidden of [
      'ca_horse_style_switch',
      'runtime_settings',
      'table_seats',
      'public.tables',
      'horse_profile',
    ]) {
      expect(code(body + helper)).not.toContain(forbidden);
    }
    expect(helper).toMatch(/LANGUAGE sql\s+STABLE/);
  });

  it('addresses the Production Alerts fleet', () => {
    expect(code(body)).toContain("'target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca'");
  });
});

describe('the exposure warning never pages the owner', () => {
  it('the newest definition of fn_ca_owner_page_kind on main does not map its source or alert name', () => {
    // 20261119234116 is the latest migration that rewrites fn_ca_owner_page_kind; the install probe below
    // re-checks the live production definition inside the install transaction, so a later editor is covered too.
    const latest = read(
      'supabase/migrations/20261119234116_the_3_am_check_says_whether_the_4_am_cutover_will_ship.sql'
    );
    expect(latest).toContain('fn_ca_owner_page_kind');
    expect(latest).not.toContain('horse-exposure-watch');
    expect(latest).not.toContain('PersonBeatsHorsesBeyondTwoSE');
  });

  it('the migration proves at install and in its live proof that the kind is NULL', () => {
    expect(migration).toContain(
      "public.fn_ca_owner_page_kind('horse-exposure-watch', 'PersonBeatsHorsesBeyondTwoSE', 'warning') IS NOT NULL THEN"
    );
    expect(migration).toMatch(
      /@live-proof: .*fn_ca_owner_page_kind\('horse-exposure-watch', 'PersonBeatsHorsesBeyondTwoSE', 'warning'\) IS NULL/
    );
  });
});

describe('the reliability controller never escalates it', () => {
  it('its own class row: never an incident, never escalated, proved at install', () => {
    expect(code(migration)).toMatch(
      /SELECT 305, 'horse-exposure-watch', 'PersonBeatsHorsesBeyondTwoSE', '%', 'horse_exposure_analysis', 'warning', false, false/
    );
    expect(code(migration)).toContain(
      "reliability_classify('horse-exposure-watch', 'PersonBeatsHorsesBeyondTwoSE', 'warning', false)).is_incident IS NOT FALSE"
    );
  });
});

describe('the declared rule', () => {
  it('windows 500 / 1,000 / 2,500 and every hand of 60 days, +2 SE on the EV-adjusted rate', () => {
    expect(code(body)).toContain('CROSS JOIN (VALUES (500), (1000), (2500), (0)) AS n(win)');
    expect(code(body)).toContain('c_z constant numeric := 2;');
    expect(code(body)).toContain('c_min constant integer := 500;');
    expect(code(body)).toMatch(
      /max\(hands\) FILTER \(WHERE ev_se > 0 AND ev_bb100 > c_z \* ev_se\)/
    );
    expect(code(helper)).toContain("hh.created_at > p_at - interval '60 days'");
  });

  it('the split is rake-free pro-rata and the EV figure uses ev_net_bb', () => {
    expect(code(helper)).toContain('s.n * COALESCE(h.hl_real, 0) / h.l_real');
    expect(code(helper)).toContain('s.n * COALESCE(h.hw_real, 0) / h.l_real');
    expect(code(helper)).toContain('COALESCE(f.ev_net_bb, f.net_bb)');
  });
});

describe('the schedule and the proof', () => {
  it('runs hourly at :17, outside the :50-:03 break window, one run at a time', () => {
    const m = /cron\.schedule\('ca-horse-exposure-watch-hourly', '(\d+) \* \* \* \*'/.exec(
      migration
    );
    expect(m).not.toBeNull();
    const minute = Number(m![1]);
    expect(minute >= 4 && minute < 50).toBe(true);
    expect(migration).toContain("pg_try_advisory_lock(hashtext('ca-horse-exposure-watch'))");
    expect(migration).toMatch(/^-- periodic-work: \S/m);
  });

  it('its native proof runs on every change to it', () => {
    expect(workflow).toContain(`supabase/migrations/${FILE}`);
    expect(workflow).toContain(
      'scripts/ci/test-a-person-beating-the-horses-reaches-production-alerts.py'
    );
    expect(workflow).toContain(
      'python3 -B scripts/ci/test-a-person-beating-the-horses-reaches-production-alerts.py'
    );
  });
});
