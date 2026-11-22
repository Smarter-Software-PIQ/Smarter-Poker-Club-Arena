/**
 * LAW: THE ENGINE CUTS OVER EVERY THREE HOURS (owner order 2026-11-21).
 *
 * Dan, 02:22-02:23 Chicago, Claude session session_01Gw7aDsC1z7GdpSYmDAM2kv:
 * "I WANT A ENGINE CUT OVER EVERY 3 HOURS." The scheduled certified cutover
 * runs at 01, 04, 07, 10, 13, 16, 19 and 22 America/Chicago, 04:00 staying an
 * anchor, through the one existing route (Stage -> single receiver -> host
 * transaction). The eight hours live in surfaces that cannot import each
 * other; this law makes them agree, and pins the two DST days:
 *
 *   - spring forward (2026-03-08): 02:00 does not exist; 01:00 CST and
 *     04:00 CDT are two real hours apart, and nothing is invented;
 *   - fall back (2026-11-01): 01:00 happens twice; it is ONE cycle, the first
 *     (CDT), in the engine, the client, Stage and the release scripts.
 *
 * Window migrations, the nightly schema freeze and the games-closed window
 * stay DAILY at the 04:00 anchor (docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import {
  maintenanceFrequency,
  nearbyMaintenanceWindows,
  nextMaintenanceAnnouncement,
  scheduledMaintenanceAt,
  THREE_HOURLY_SLOT_HOURS,
} from '../server/src/maintenance/maintenanceSchedule';
import {
  isRoutineMaintenanceUpcoming,
  observedMaintenanceSchedule,
  THREE_HOURLY_SLOT_HOURS as CLIENT_HOURS,
} from '../src/utils/maintenanceSchedule';
import {
  msUntilNextAnnouncement,
  nextThreeHourlyStart,
  THREE_HOURLY_START_HOURS as CI_HOURS,
} from '../scripts/ci/await-engine-gameplay.mjs';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const HOURS = [1, 4, 7, 10, 13, 16, 19, 22];
const HOURS_PY = '(1, 4, 7, 10, 13, 16, 19, 22)';
const policy = JSON.parse(read('server/src/maintenance/maintenanceSchedulePolicy.json'));
const chicagoHour = (ms: number) =>
  Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(ms)
  );
const starts = (fromIso: string, hours: number) => {
  const from = Date.parse(fromIso);
  const out: string[] = [];
  let at = from;
  for (;;) {
    const next = nextMaintenanceAnnouncement(at, 'three-hourly') + 120_000;
    if (next >= from + hours * 3_600_000) return out;
    out.push(new Date(next).toISOString());
    at = next;
  }
};

describe('the protected policy records the owner order and selects three-hourly', () => {
  it('is the v2 policy with the eight start hours and the verbatim order', () => {
    expect(policy.schema).toBe('engine-maintenance-schedule/v2');
    expect(policy.frequency).toBe('three-hourly');
    expect(policy.startHours).toEqual(HOURS);
    expect(policy.ownerMessageId).toBe('session_01Gw7aDsC1z7GdpSYmDAM2kv');
    expect(policy.ownerOrder).toContain('I WANT A ENGINE CUT OVER EVERY 3 HOURS.');
    expect(policy.ownerOrder).toContain('CREATE A DEDICATED ENGINE CUT OFF SWITCH');
    expect(maintenanceFrequency()).toBe('three-hourly');
    // Reverting is one field.
    expect(maintenanceFrequency({ ...policy, frequency: 'daily' })).toBe('daily');
    expect(() => maintenanceFrequency({ ...policy, frequency: 'hourly' })).toThrow();
    expect(() => maintenanceFrequency({ ...policy, startHours: [4] })).toThrow();
  });
});

describe('the engine breaks on the eight Chicago hours, over real epoch hours', () => {
  it('an ordinary CST day has exactly the eight cycles', () => {
    const day = starts('2026-11-20T06:00:00Z', 24); // 00:00 CST Nov 20
    expect(day.map((iso) => chicagoHour(Date.parse(iso)))).toEqual([1, 4, 7, 10, 13, 16, 19, 22]);
    expect(day[0]).toBe('2026-11-20T07:00:00.000Z');
  });
  it('spring forward: 01:00 CST and 04:00 CDT, two real hours apart, nothing invented', () => {
    const day = starts('2026-03-08T06:00:00Z', 23);
    expect(day.slice(0, 3)).toEqual([
      '2026-03-08T07:00:00.000Z',
      '2026-03-08T09:00:00.000Z',
      '2026-03-08T12:00:00.000Z',
    ]);
    expect(day).toHaveLength(8);
  });
  it('fall back: the repeated 01:00 is ONE cycle, the first (CDT)', () => {
    const day = starts('2026-11-01T05:00:00Z', 25);
    expect(day.slice(0, 3)).toEqual([
      '2026-11-01T06:00:00.000Z', // 01:00 CDT
      '2026-11-01T10:00:00.000Z', // 04:00 CST (the 07:00Z 01:00 CST is not a cycle)
      '2026-11-01T13:00:00.000Z',
    ]);
    expect(day).toHaveLength(8);
    expect(scheduledMaintenanceAt(Date.parse('2026-11-01T07:01:00Z'), 'three-hourly')).toBeNull();
  });
  it('each window is the unchanged 2-minute drain and 5-minute break, starting on the hour', () => {
    expect(scheduledMaintenanceAt(Date.parse('2026-11-20T13:02:00Z'), 'three-hourly')).toEqual({
      announcedAt: Date.parse('2026-11-20T12:58:00Z'),
      startsAt: Date.parse('2026-11-20T13:00:00Z'),
      endsAt: Date.parse('2026-11-20T13:05:00Z'),
    });
    for (const w of nearbyMaintenanceWindows(Date.parse('2026-11-20T13:02:00Z'), 'three-hourly'))
      expect(HOURS).toContain(chicagoHour(w.startsAt));
  });
  it('/health exposes the frequency and start hours, and never an hourly cash freeze', () => {
    const engine = read('server/src/maintenance/MaintenanceBreak.ts');
    expect(engine).toContain('startHours: maintenanceSlotHours(),');
    expect(engine).toContain("hourlyCashFreeze: MAINTENANCE_FREQUENCY === 'phase1-hourly',");
    expect([...THREE_HOURLY_SLOT_HOURS]).toEqual(HOURS);
  });
});

describe('every reader of the schedule agrees on the eight hours and the fall-back rule', () => {
  const served = {
    timeZone: 'America/Chicago',
    startHour: 4,
    startHours: HOURS,
    startMinute: 0,
    durationMs: 300000,
    nextAnnouncementAt: 1,
    hourlyCashFreeze: false,
    frequency: 'three-hourly',
    policyId: 'three-hourly-01Gw7aDs',
  };
  it('the client banner and late-registration countdown', () => {
    expect([...CLIENT_HOURS]).toEqual(HOURS);
    expect(observedMaintenanceSchedule(served)).toBe('three-hourly');
    // It still reads the daily and Phase1 producers the engine serves until adoption.
    expect(observedMaintenanceSchedule({ ...served, frequency: 'daily', startHours: [4] })).toBe(
      'daily'
    );
    expect(isRoutineMaintenanceUpcoming(Date.parse('2026-11-20T12:56:00Z'), 'three-hourly')).toBe(
      true
    );
    expect(isRoutineMaintenanceUpcoming(Date.parse('2026-11-20T11:56:00Z'), 'three-hourly')).toBe(
      false
    );
    expect(read('src/components/lobby/lateRegCountdown.ts')).toContain(
      'MAINTENANCE_HOURS_CHICAGO: readonly number[] = [1, 4, 7, 10, 13, 16, 19, 22]'
    );
  });
  it('the CI gameplay wait', () => {
    expect(CI_HOURS).toEqual(HOURS);
    expect(nextThreeHourlyStart(Date.parse('2026-11-01T06:30:00Z'))).toBe(
      Date.parse('2026-11-01T10:00:00Z')
    );
    expect(msUntilNextAnnouncement(Date.parse('2026-11-20T12:00:00Z'), served)).toBe(58 * 60_000);
  });
  it('the release scripts name the same hours', () => {
    expect(read('server/scripts/engine-release-seal.py')).toContain(
      `THREE_HOURLY_START_HOURS = ${HOURS_PY}`
    );
    expect(read('server/scripts/engine-release-activation-floor.py')).toContain(
      `SCHEDULED_START_HOURS = ${HOURS_PY}`
    );
    expect(read('scripts/ci/select-daily-engine.py')).toContain(
      `THREE_HOURLY_START_HOURS = ${HOURS_PY}`
    );
    expect(read('scripts/ci/read-engine-prequalification.py')).toContain(
      `THREE_HOURLY_START_HOURS = ${HOURS_PY}`
    );
    expect(read('scripts/ci/prestage-engine-image.sh')).toContain(`hours = ${HOURS_PY} if`);
    const transaction = read('server/scripts/engine-release-transaction.sh');
    expect(transaction).toContain('routine_start_hours\nrequire_backup_certificate');
    expect(transaction).toContain(
      'raise SystemExit(0 if n.hour in hours and n.minute < 5 and first else 1)  # first fall-back 01:00 only'
    );
    // A v2 policy always lists the eight hours; daily still resolves to 4 alone.
    expect(transaction).toContain(
      'print(",".join(str(h) for h in p["startHours"]) if p.get("frequency")=="three-hourly" else "4")'
    );
  });
  // The release transaction's cycle clocks, executed at a pinned instant.
  const transactionText = read('server/scripts/engine-release-transaction.sh');
  const pinNow = (code: string) =>
    code
      .replace(
        'datetime.now(ZoneInfo("America/Chicago"))',
        'datetime.fromtimestamp(int(os.environ["NOW"]), ZoneInfo("America/Chicago"))'
      )
      .replace(
        'local = datetime.now(ZoneInfo("America/Chicago"))',
        'local = datetime.fromtimestamp(int(os.environ["NOW"]), ZoneInfo("America/Chicago"))'
      );
  const clockAt = (code: string, iso: string, hours: string) =>
    spawnSync('python3', ['-c', `import os\n${pinNow(code)}`], {
      encoding: 'utf8',
      env: { ...process.env, NOW: String(Date.parse(iso) / 1000), ROUTINE_START_HOURS: hours },
    }).status;
  it('the transaction cycle clock admits only the FIRST fall-back 01:00', () => {
    const start = transactionText.indexOf('daily_cutover_clock() {');
    const body = transactionText.slice(
      transactionText.indexOf("python3 -c '", start) + "python3 -c '".length,
      transactionText.indexOf("\n'\n}", start)
    );
    const three = HOURS.join(',');
    expect(clockAt(body, '2026-11-01T06:02:00Z', three)).toBe(0); // 01:02 CDT, first
    expect(clockAt(body, '2026-11-01T07:02:00Z', three)).toBe(1); // 01:02 CST, repeat
    expect(clockAt(body, '2026-11-01T10:02:00Z', three)).toBe(0); // 04:02 CST
    expect(clockAt(body, '2026-11-01T10:02:00Z', '4')).toBe(0);
    expect(clockAt(body, '2026-11-01T06:02:00Z', '4')).toBe(1);
    expect(clockAt(body, '2026-11-01T10:06:00Z', three)).toBe(1);
  });
  it('every daily= admission in the transaction applies the same first-occurrence rule', () => {
    const lines = transactionText.split('\n').filter((l) => /(^|; )daily ?= ?\(/.test(l));
    expect(lines.length).toBe(3);
    for (const line of lines) expect(line).toMatch(/!= ?local\.hour/);
    const snippet = (iso: string, hours: string) =>
      clockAt(
        `from datetime import datetime\nfrom zoneinfo import ZoneInfo\nlocal=datetime.now(ZoneInfo("America/Chicago"))\n${lines.find((l) => l.startsWith('daily=('))!}\nraise SystemExit(0 if daily else 1)`,
        iso,
        hours
      );
    expect(snippet('2026-11-01T06:02:00Z', HOURS.join(','))).toBe(0);
    expect(snippet('2026-11-01T07:02:00Z', HOURS.join(','))).toBe(1);
    const holdDaily = lines.find((l) => l.startsWith('hour0 = '))!;
    const holdAt = (iso: string) =>
      clockAt(
        `import os\nfrom datetime import datetime\nfrom zoneinfo import ZoneInfo\nlocal = datetime.now(ZoneInfo("America/Chicago"))\nhours = tuple(int(h) for h in os.environ.get("ROUTINE_START_HOURS", "4").split(","))\n${holdDaily}\nraise SystemExit(0 if daily else 1)`,
        iso,
        HOURS.join(',')
      );
    expect(holdAt('2026-11-01T05:59:00Z')).toBe(0); // 00:59 CDT, before the first 01:00
    expect(holdAt('2026-11-01T06:02:00Z')).toBe(0);
    expect(holdAt('2026-11-01T06:59:00Z')).toBe(1); // 01:59 CDT: next hour is the repeat
    expect(holdAt('2026-11-01T07:02:00Z')).toBe(1);
    expect(holdAt('2026-11-01T09:58:00Z')).toBe(0); // 03:58 CST
  });
  it('the host prestage door closes only the cycles the target policy names', () => {
    const prestage = read('scripts/ci/prestage-engine-image.sh');
    const code = prestage
      .slice(prestage.indexOf("<<'PY'\n") + 6, prestage.indexOf('\nPY\n'))
      .replace('now = int(time.time())', 'now = int(os.environ["NOW"])');
    const door = (iso: string, hours: string) => {
      const r = spawnSync('python3', ['-c', code], {
        encoding: 'utf8',
        env: { ...process.env, NOW: String(Date.parse(iso) / 1000), START_HOURS: hours },
      });
      return r.status === 0 ? Number(r.stdout.trim()) : null;
    };
    const three = HOURS.join(',');
    // 06:40Z Nov 20 = 00:40 CST: inside the 01:00 cycle's closed window.
    expect(door('2026-11-20T06:40:00Z', three)).toBeNull();
    expect(door('2026-11-20T06:40:00Z', '4')).toBe(Date.parse('2026-11-20T06:50:00Z') / 1000);
    // 09:40Z = 03:40 CST: closed under both policies.
    expect(door('2026-11-20T09:40:00Z', '4')).toBeNull();
    expect(door('2026-11-20T09:40:00Z', three)).toBeNull();
    // 09:25Z = 03:25 CST: the daily deadline stops before the 03:30 cutoff.
    expect(door('2026-11-20T09:25:00Z', '4')).toBe(Date.parse('2026-11-20T09:29:50Z') / 1000);
    // Fall back: 06:40Z = 01:40 CDT. The repeated 01:00 CST (07:00Z) is not a
    // cycle, so the door stays open; the next cutoff is 03:30 CST (09:30Z).
    expect(door('2026-11-01T06:40:00Z', three)).toBe(Date.parse('2026-11-01T06:50:00Z') / 1000);
    expect(prestage).toContain('[[ "$hours" = 4 || "$hours" = 1,4,7,10,13,16,19,22 ]]');
    const prequal = read('.github/workflows/engine-release-prequalification.yml');
    expect(prequal).toContain("'$transport' '$hours'");
    expect(prequal).toContain('schedule-policy --repo . --sha "$GITHUB_SHA"');
  });
  it('the receiver admits the 30-50 minute preparation of a scheduled cycle only', () => {
    const deploy = read('.github/workflows/auto-deploy-hetzner.yml');
    expect(deploy).toContain(
      `hours = ${HOURS_PY} if policy.get("frequency") == "three-hourly" else (4,)`
    );
    expect(deploy).toContain('if not (30 <= now.minute < 50 and local.hour in hours');
    expect(deploy).toContain('the serving engine does not break on this three-hourly cycle yet');
  });
});

describe('Stage prepares once per cycle start, never a later cycle early', () => {
  const stage = read('.github/workflows/stage-engine-release.yml');
  const start = stage.indexOf('window=$(MOMENT="$moment" POLICY="$POLICY" python3 - <<\'PYTHON\'');
  const body = stage.slice(
    stage.indexOf('\n', start) + 1,
    stage.indexOf('          PYTHON\n', start)
  );
  const script = body
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
  const reserve = (moment: string, frequency = 'three-hourly') => {
    const r = spawnSync('python3', ['-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MOMENT: moment,
        EVENT_NAME: 'push',
        POLICY: JSON.stringify({ frequency }),
      },
    });
    return r.status === 0 ? r.stdout.trim().split(' ') : null;
  };
  it('the crons cover each preparation hour in both offsets', () => {
    const utc = new Set<number>();
    for (const m of stage.matchAll(/cron: '31,35,39,43 ([0-9,]+) \* \* \*'/g))
      for (const h of m[1].split(',')) utc.add(Number(h));
    // Preparation hour AND the reservation hour before it, in CST and CDT.
    for (const local of [0, 3, 6, 9, 12, 15, 18, 21])
      for (const offset of [5, 6])
        for (const early of [0, 1]) expect(utc.has((local - early + offset + 24) % 24)).toBe(true);
  });
  it('a run reserves the nearest cycle whose preparation has not ended, at most 100 minutes early', () => {
    // 11:00Z Nov 20 = 05:00 CST; nearest cycle 07:00 CST, preparation 12:30Z.
    // The reservation opens 100 minutes before 12:30Z, at 10:50Z.
    expect(reserve('2026-11-20T10:49:00Z')).toBeNull();
    expect(reserve('2026-11-20T10:50:00Z')?.[0]).toBe('2026-11-20T07');
    const owned = reserve('2026-11-20T11:30:00Z');
    expect(owned?.[0]).toBe('2026-11-20T07');
    expect(owned?.[5]).toBe('7');
    // The 04:00 anchor keeps its plain date identity and the daily policy its 5 h.
    expect(reserve('2026-11-20T09:45:00Z')?.[0]).toBe('2026-11-20');
    expect(reserve('2026-11-20T05:00:00Z', 'daily')?.[0]).toBe('2026-11-20');
    expect(reserve('2026-11-20T12:00:00Z', 'daily')).toBeNull();
  });
  it('fall back: one 01:00 cycle, the first', () => {
    // 05:45Z Nov 1 = 00:45 CDT -> the 01:00 CDT cycle (06:00Z).
    expect(reserve('2026-11-01T05:45:00Z')?.[3]).toBe(
      String(Date.parse('2026-11-01T05:30:00Z') / 1000)
    );
    // 06:40Z = 01:40 CDT: the next cycle is 04:00 CST (10:00Z); 01:00 CST is not one.
    expect(reserve('2026-11-01T06:40:00Z')).toBeNull();
    expect(reserve('2026-11-01T08:00:00Z')?.[0]).toBe('2026-11-01');
  });
  it('spring forward: 01:00 CST then 04:00 CDT', () => {
    expect(reserve('2026-03-08T06:35:00Z')?.[0]).toBe('2026-03-08T01');
    expect(reserve('2026-03-08T07:10:00Z')?.[0]).toBe('2026-03-08');
  });
  it('a non-anchor cycle needs a serving three-hourly engine; window migrations stay at 04:00', () => {
    expect(stage).toContain(
      '.frequency == "three-hourly" and (.startHours == [1,4,7,10,13,16,19,22])'
    );
    expect(stage).toContain("!contains(needs.detect.outputs.daily_preparation_date, 'T') &&");
    expect(read('scripts/ci/maintenance-window-migrations.mjs')).toContain("time '03:55'");
  });
});

describe('a booked owner window and a scheduled cycle never break in the same rolling hour', () => {
  it('the seal defers an off-cycle announcement within an hour of a cycle, never an engine-degraded one', () => {
    const seal = read('server/scripts/engine-release-seal.py');
    expect(seal).toContain('def scheduled_cycle_spacing(');
    expect(seal).toContain(
      "if not blocker and cause != 'engine-degraded' and scheduled_cycle is None:"
    );
    const r = spawnSync(
      'python3',
      [
        '-c',
        `import importlib.util,sys
spec=importlib.util.spec_from_file_location('seal','server/scripts/engine-release-seal.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
from datetime import datetime,timezone
ms=lambda s:int(datetime.fromisoformat(s).replace(tzinfo=timezone.utc).timestamp()*1000)
h=m.THREE_HOURLY_START_HOURS
print(m.scheduled_cycle_spacing(h, ms('2026-11-20T12:30:00')))
print(m.scheduled_cycle_spacing(h, ms('2026-11-20T14:30:00')))
print(m.scheduled_cycle_spacing(h, ms('2026-11-20T15:00:00')))
print(m.scheduled_cycle_spacing((4,), ms('2026-11-20T09:30:00')))`,
      ],
      { cwd: root, encoding: 'utf8' }
    );
    expect(r.status, r.stderr).toBe(0);
    const [nearCycle, after, clear, daily] = r.stdout.trim().split('\n').map(Number);
    // 12:30Z: within an hour of the 13:00Z cycle; eligible from 13:58Z.
    expect(nearCycle).toBe(Date.parse('2026-11-20T13:58:00Z'));
    expect(after).toBe(0); // 14:32 break start: over an hour after 13:00, 2.5 h before 16:00
    expect(clear).toBe(Date.parse('2026-11-20T16:58:00Z')); // 15:02 is inside 16:00's hour
    expect(daily).toBe(0); // the daily route is unchanged
  });
});

describe('the database freeze marks follow every cycle the engine actually announces', () => {
  it('marks the eight hours, the first fall-back 01:00 only, and a non-anchor cycle only on its own announcement', () => {
    const sql = read(
      'supabase/migrations/20261121091106_freeze_marks_follow_every_three_hourly_engine_cycle.sql'
    );
    expect(sql).toContain('IF v_hour <> ALL (ARRAY[1,4,7,10,13,16,19,22])');
    expect(sql).toContain(
      "IF extract(hour FROM (v_cycle - interval '1 hour') AT TIME ZONE 'America/Chicago')::integer = v_hour THEN"
    );
    expect(sql).toContain("IF v_hour <> 4 AND p_kind = 'pre' AND NOT EXISTS (");
    expect(sql).toContain("cron.schedule('ca-freeze-mark-pre','0 * * * *'");
    expect(sql).toContain("cron.schedule('ca-freeze-mark-post','5 * * * *'");
  });
});

describe('prequalification waits once across a closed prestage window and keeps the host door fail-closed', () => {
  const workflowRaw = read('.github/workflows/engine-release-prequalification.yml');
  const workflow = parse(workflowRaw);
  const prestageJob = workflow.jobs.prestage;
  const stageStep = prestageJob.steps.find((s: { id?: string }) => s.id === 'stage');
  const stageRun: string = stageStep.run;
  const waitMarker = 'wait_seconds="$(START_HOURS="$hours" python3 - <<\'PRESTAGE_WAIT_PY\'\n';
  const waitCodeStart = stageRun.indexOf(waitMarker) + waitMarker.length;
  const waitCodeEnd = stageRun.indexOf('\nPRESTAGE_WAIT_PY\n', waitCodeStart);
  const waitCode = stageRun.slice(waitCodeStart, waitCodeEnd);

  const prestageScript = read('scripts/ci/prestage-engine-image.sh');
  const hostDoorCode = prestageScript
    .slice(prestageScript.indexOf("<<'PY'\n") + 6, prestageScript.indexOf('\nPY\n'))
    .replace('now = int(time.time())', 'now = int(os.environ["NOW"])');

  const computeWait = (iso: string, hours: string) => {
    const pinned = waitCode.replace('now = int(time.time())', 'now = int(os.environ["NOW"])');
    const r = spawnSync('python3', ['-c', pinned], {
      encoding: 'utf8',
      env: { ...process.env, NOW: String(Math.floor(Date.parse(iso) / 1000)), START_HOURS: hours },
    });
    return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
  };

  const hostDoor = (epochSec: number, hours: string) => {
    const r = spawnSync('python3', ['-c', hostDoorCode], {
      encoding: 'utf8',
      env: { ...process.env, NOW: String(epochSec), START_HOURS: hours },
    });
    return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
  };

  it('bounds the prestage job timeout, parses cleanly in bash, and sleeps once without loops or retries', () => {
    expect(prestageJob['timeout-minutes']).toBe(85);
    expect(waitCodeStart).toBeGreaterThan(waitMarker.length);
    expect(waitCodeEnd).toBeGreaterThan(waitCodeStart);
    expect(waitCode).toContain('now = int(time.time())');
    expect(waitCode).toContain(`hours = ${HOURS_PY}`);
    expect(stageRun.indexOf("<<'PRESTAGE_WAIT_PY'")).toBeLessThan(
      stageRun.indexOf('base64 -w0 scripts/ci/prestage-engine-image.sh')
    );
    expect(stageRun.indexOf('sleep "$wait_seconds"')).toBeLessThan(
      stageRun.indexOf('gzip -1c "$dir/image.tar"')
    );
    expect(stageRun).not.toMatch(/^\s*(while|until)\b/m);
    expect(stageRun.match(/\bsleep\b/g)).toHaveLength(1);
    // Host-side fail-closed guard stays intact.
    expect(prestageScript).toContain('raise SystemExit("production preparation window is closed")');
    // Entire bash step parses cleanly.
    const syntax = spawnSync('bash', ['-n'], { input: stageRun, encoding: 'utf8' });
    expect(syntax.status, syntax.stderr).toBe(0);
  });

  it('returns exact seconds to cycle+305s (<= 2165s) during closed three-hourly windows and 0 outside', () => {
    const three = HOURS.join(',');
    // 2026-11-20 CST (UTC-6), 16:00 Chicago cycle = 22:00:00Z, wake target = 22:05:05Z.
    const cases: Array<[string, number]> = [
      ['2026-11-20T21:28:59Z', 0], // 15:28:59 CST: outside 60s lead
      ['2026-11-20T21:29:00Z', 2165], // 15:29:00 CST: exact upper bound (start - 1860)
      ['2026-11-20T21:30:00Z', 2105], // 15:30:00 CST: preparation cutoff (start - 1800)
      ['2026-11-20T21:45:00Z', 1205], // 15:45:00 CST: mid-preparation
      ['2026-11-20T22:00:00Z', 305], // 16:00:00 CST: break start
      ['2026-11-20T22:04:00Z', 65], // 16:04:00 CST: break minute 4
      ['2026-11-20T22:04:59Z', 6], // 16:04:59 CST: final closed second
      ['2026-11-20T22:05:00Z', 0], // 16:05:00 CST: door reopened
      ['2026-11-20T22:05:05Z', 0], // 16:05:05 CST: wake instant
      ['2026-11-20T20:00:00Z', 0], // 14:00:00 CST: open afternoon
      ['2026-11-20T23:00:00Z', 0], // 17:00:00 CST: open evening
    ];
    for (const [iso, expected] of cases) {
      const r = computeWait(iso, three);
      expect(r.status, `${iso}: ${r.stderr}`).toBe(0);
      const wait = Number(r.stdout);
      expect(wait, iso).toBe(expected);
      expect(wait, iso).toBeLessThanOrEqual(2165);
      // Every non-zero wait wakes at an instant accepted by the unchanged host door with a full 600s deadline.
      if (wait > 0) {
        const nowSec = Math.floor(Date.parse(iso) / 1000);
        const wakeSec = nowSec + wait;
        expect(wakeSec, `${iso} wake target`).toBe(Date.parse('2026-11-20T22:05:05Z') / 1000);
        const after = hostDoor(wakeSec, three);
        expect(after.status, `${iso} wake host door: ${after.stderr}`).toBe(0);
        expect(Number(after.stdout)).toBe(wakeSec + 600);
        // Inside [start - 1800, start + 300), the host door itself still refuses fail-closed.
        if (nowSec >= Date.parse('2026-11-20T21:30:00Z') / 1000) {
          const during = hostDoor(nowSec, three);
          expect(during.status, `${iso} host door must still refuse`).not.toBe(0);
          expect(during.stderr).toContain('production preparation window is closed');
        }
      }
    }
    // Every one of the eight Chicago cycles closes on its own :30-:05 window.
    for (const utcHour of [6, 9, 12, 15, 18, 21]) {
      const hh = String(utcHour).padStart(2, '0');
      const r = computeWait(`2026-11-20T${hh}:45:00Z`, three);
      expect(r.status, r.stderr).toBe(0);
      expect(Number(r.stdout), `UTC ${hh}:45`).toBe(1205);
    }
  });

  it('on a daily policy, returns 0 for non-04:00 cycles and waits only for 04:00', () => {
    for (const iso of [
      '2026-11-20T06:40:00Z', // 00:40 CST (01:00 cycle)
      '2026-11-20T21:30:00Z', // 15:30 CST (16:00 cycle)
      '2026-11-20T22:02:00Z', // 16:02 CST (16:00 cycle)
      '2026-11-21T00:45:00Z', // 18:45 CST (19:00 cycle)
    ]) {
      const r = computeWait(iso, '4');
      expect(r.status, `${iso}: ${r.stderr}`).toBe(0);
      expect(Number(r.stdout), iso).toBe(0);
    }
    expect(Number(computeWait('2026-11-20T09:29:00Z', '4').stdout)).toBe(2165); // 03:29 CST
    expect(Number(computeWait('2026-11-20T09:30:00Z', '4').stdout)).toBe(2105); // 03:30 CST
    expect(Number(computeWait('2026-11-20T10:04:59Z', '4').stdout)).toBe(6); // 04:04:59 CST
    expect(Number(computeWait('2026-11-20T10:05:00Z', '4').stdout)).toBe(0); // 04:05:00 CST
  });

  it('handles DST fall-back (only the first 01:00 is closed) and spring-forward accurately', () => {
    const three = HOURS.join(',');
    // Fall-back day 2026-11-01: first 01:00 CDT = 06:00Z; repeated 01:00 CST = 07:00Z; 04:00 CST = 10:00Z.
    expect(Number(computeWait('2026-11-01T05:29:00Z', three).stdout)).toBe(2165);
    expect(Number(computeWait('2026-11-01T05:30:00Z', three).stdout)).toBe(2105);
    expect(Number(computeWait('2026-11-01T06:04:00Z', three).stdout)).toBe(65);
    expect(Number(computeWait('2026-11-01T06:05:00Z', three).stdout)).toBe(0);
    // Repeated 01:00 CST (07:00Z) is NOT a cycle: zero wait throughout its lead and break.
    for (const iso of [
      '2026-11-01T06:29:00Z',
      '2026-11-01T06:30:00Z',
      '2026-11-01T06:40:00Z',
      '2026-11-01T07:00:00Z',
      '2026-11-01T07:04:59Z',
    ]) {
      const r = computeWait(iso, three);
      expect(r.status, `${iso}: ${r.stderr}`).toBe(0);
      expect(Number(r.stdout), iso).toBe(0);
    }
    // Anchor 04:00 CST (10:00Z) still closes.
    expect(Number(computeWait('2026-11-01T09:30:00Z', three).stdout)).toBe(2105);

    // Spring-forward day 2026-03-08: 01:00 CST = 07:00Z; 04:00 CDT = 09:00Z.
    expect(Number(computeWait('2026-03-08T06:30:00Z', three).stdout)).toBe(2105);
    expect(Number(computeWait('2026-03-08T07:30:00Z', three).stdout)).toBe(0);
    expect(Number(computeWait('2026-03-08T08:00:00Z', three).stdout)).toBe(0);
    expect(Number(computeWait('2026-03-08T08:30:00Z', three).stdout)).toBe(2105);

    // Unsupported START_HOURS fails closed.
    expect(computeWait('2026-11-20T21:45:00Z', '1,2,3').status).not.toBe(0);
  });

  it('executes the workflow bash wait block once during a blackout and skips sleep when open', () => {
    const blockStart = stageRun.indexOf('wait_seconds=');
    const blockEnd = stageRun.indexOf('\ncode="$(base64', blockStart);
    const bashWaitBlock = stageRun
      .slice(blockStart, blockEnd)
      .replace('now = int(time.time())', 'now = int(os.environ["NOW"])');
    const runBlock = (iso: string, hours: string) =>
      spawnSync(
        'bash',
        [
          '-euo',
          'pipefail',
          '-c',
          `hours=${JSON.stringify(hours)}\nsleep() { echo "MOCK_SLEEP:$*"; }\n${bashWaitBlock}`,
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, NOW: String(Math.floor(Date.parse(iso) / 1000)) },
        }
      );

    const closed = runBlock('2026-11-20T21:45:00Z', HOURS.join(','));
    expect(closed.status, closed.stderr).toBe(0);
    expect(closed.stdout).toContain('sleeping once for 1205s until cycle+305s before SSH transfer');
    expect(closed.stdout.match(/MOCK_SLEEP:/g)).toHaveLength(1);
    expect(closed.stdout).toContain('MOCK_SLEEP:1205');

    const open = runBlock('2026-11-20T23:00:00Z', HOURS.join(','));
    expect(open.status, open.stderr).toBe(0);
    expect(open.stdout).not.toContain('MOCK_SLEEP:');
  });
});
