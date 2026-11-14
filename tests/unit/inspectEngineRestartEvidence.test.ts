import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const script = resolve(__dirname, '../../scripts/ci/inspect-engine-restart-evidence.py');
const source = readFileSync(script, 'utf8');
const workflowText = readFileSync(
  resolve(__dirname, '../../.github/workflows/inspect-engine-restart-evidence.yml'),
  'utf8'
);

function py(code: string, ...args: string[]) {
  return spawnSync(
    'python3',
    ['-B', '-c', `import json,runpy,sys; m=runpy.run_path(sys.argv[1]); ${code}`, script, ...args],
    { encoding: 'utf8', timeout: 5000 }
  );
}

describe('engine restart evidence inspector', () => {
  it('masks every identifier, number, string, url and address before anything leaves', () => {
    const line =
      "[Tournament:b6d94533] FATAL (GameServer.Uncaught_exception) user 12345678-abcd-4321-abcd-123456789abc lost 2500.50 chips 'secret' at https://db.example.co/x?k=1 owner a@b.co deadbeefcafe";
    const result = py('print(m["mask"](sys.argv[2]))', line);
    expect(result.status, result.stderr).toBe(0);
    const out = result.stdout.trim();
    expect(out).toContain('FATAL (GameServer.Uncaught_exception)');
    for (const leaked of [
      'b6d94533',
      '12345678-abcd',
      '2500',
      'secret',
      'example.co',
      'a@b.co',
      'deadbeef',
    ]) {
      expect(out).not.toContain(leaked);
    }
  });

  it('keeps the words of a dockerd health failure and masks its identifiers', () => {
    const line =
      'club-arena-engine dockerd[812]: level=error msg="Error running exec 3fa9c2d1e4 in container: OCI runtime exec failed: context deadline exceeded" container=03f7547c876b error="dial https://x.example.co/a 10.0.0.5"';
    const result = py(
      'print(json.dumps({k:m["mask_keep_words"](v) for k,v in m["DOCKERD_FIELD"].findall(sys.argv[2])}))',
      line
    );
    expect(result.status, result.stderr).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out.msg).toContain('OCI runtime exec failed: context deadline exceeded');
    for (const leaked of ['3fa9c2d1e4', '03f7547c876b', 'example.co', '10.0.0.5']) {
      expect(result.stdout).not.toContain(leaked);
    }
  });

  it('refuses malformed, future, oversized or stale windows before any host read', () => {
    const now =
      'datetime=__import__("datetime"); now=datetime.datetime(2026,11,14,15,0,0,tzinfo=datetime.timezone.utc)';
    const ok = py(
      `${now}; s,e=m["window"](sys.argv[2],sys.argv[3],now); print(m["iso"](s), m["iso"](e))`,
      '2026-11-14T06:10:00Z',
      '30'
    );
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout.trim()).toBe('2026-11-14T06:10:00Z 2026-11-14T06:40:00Z');
    for (const [start, minutes] of [
      ['2026-11-14 06:10:00', '30'],
      ['2026-11-14T06:10:00Z', '4'],
      ['2026-11-14T06:10:00Z', '61'],
      ['2026-11-14T14:50:00Z', '30'],
      ['2026-11-01T06:10:00Z', '30'],
      ['2026-11-14T06:10:00Z', '3; rm -rf /'],
    ]) {
      const bad = py(`${now}; m["window"](sys.argv[2],sys.argv[3],now)`, start, minutes);
      expect(bad.status, `${start} ${minutes}`).not.toBe(0);
    }
  });

  it('admits only one 8-character hex focus prefix, or none', () => {
    expect(py('print(m["parse_focus"](sys.argv[2]))', '-').stdout.trim()).toBe('None');
    expect(py('print(m["parse_focus"](sys.argv[2]))', 'b6d94533').stdout.trim()).toBe('b6d94533');
    for (const bad of ['B6D94533', 'b6d9453', 'b6d945333', 'b6d9453z', "'; ls", '']) {
      expect(py('m["parse_focus"](sys.argv[2])', bad).status, bad).not.toBe(0);
    }
  });

  it('keeps the focus elimination sweep in order with timestamps, masked, and bounded', () => {
    const code = [
      'lines = [',
      '  "2026-11-14T07:33:01.123456789Z [Tournament:b6d94533] Eliminated: 1a2b3c4d at position 412 (prize: 0)\\n",',
      '  "2026-11-14T07:33:01.200Z [Tournament:b6d94533] dealt hand 12 at table 3\\n",',
      '  "2026-11-14T07:33:02.000Z [Tournament:b6d94533] bust preparation spent the whole 5000ms budget\\n",',
      '  "2026-11-14T07:33:03.000Z [Tournament.horse_rebuy_decision] {\\"tournamentId\\":\\"b6d94533-26fe-4c9b-98d2-352489b9596e\\",\\"phase\\":\\"declined\\"}\\n",',
      '  "2026-11-14T07:33:04.000Z Tournament.elimination_scheduler_all_slots_stalled after 61000ms\\n",',
      '  "2026-11-14T07:33:05.000Z [Tournament:a1b2c3d4] Eliminated: 99999999 at position 3 (prize: 10)\\n",',
      ']',
      'm["stream"].__globals__["stream"] = lambda argv: iter(lines)',
      'import datetime',
      's=datetime.datetime(2026,11,14,7,28,tzinfo=datetime.timezone.utc); e=s+datetime.timedelta(minutes=30)',
      'r=m["read_container_log"]("x", s, e, lambda p: False, None, "b6d94533")',
      'print(json.dumps(r["sweepLines"])); print(r["sweepLinesDropped"])',
    ].join("\n");
    const result = spawnSync('python3', ['-B', '-c', `import json,runpy,sys; m=runpy.run_path(sys.argv[1])\n${code}`, script], {
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status, result.stderr).toBe(0);
    const [jsonLine, dropped] = result.stdout.trim().split('\n');
    const sweep = JSON.parse(jsonLine) as Array<{ at: string; focus: boolean; line: string }>;
    expect(dropped).toBe('0');
    expect(sweep.map((entry) => entry.at)).toEqual([
      '2026-11-14T07:33:01.123Z',
      '2026-11-14T07:33:02.000Z',
      '2026-11-14T07:33:03.000Z',
      '2026-11-14T07:33:04.000Z',
    ]);
    expect(sweep[0].line).toBe('[Tournament:<F>] Eliminated: <id> at position <n> (prize: <n>)');
    expect(sweep[3].focus).toBe(false);
    for (const leaked of ['b6d94533', '1a2b3c4d', '412', 'declined', 'a1b2c3d4', '26fe']) {
      expect(jsonLine).not.toContain(leaked);
    }
    expect(source).toMatch(/MAX_SWEEP_LINES = \d{3,4}\n/);
  });

  it('reads aggregate elimination series from the local Prometheus with fixed queries only', () => {
    const code = [
      'seen=[]',
      'def fetch(url):',
      '  seen.append(url)',
      '  return json.dumps({"status":"success","data":{"result":[{"metric":{"step":"db:tournament_players","bad label":"x y"},"values":[[1794641280,"812.5"],[1794641295,"NaN"]]}]}})',
      'import datetime',
      's=datetime.datetime(2026,11,14,7,28,tzinfo=datetime.timezone.utc); e=s+datetime.timedelta(minutes=30)',
      'out=m["prom_series"](s, e, fetch)',
      'print(json.dumps(out["stepMeanMs"])); print(json.dumps(seen))',
    ].join("\n");
    const result = spawnSync('python3', ['-B', '-c', `import json,runpy,sys; m=runpy.run_path(sys.argv[1])\n${code}`, script], {
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status, result.stderr).toBe(0);
    const [seriesLine, urlsLine] = result.stdout.trim().split('\n');
    expect(JSON.parse(seriesLine)).toEqual({
      readOk: true,
      series: [{ labels: { step: 'db:tournament_players' }, points: [['2026-11-14T07:28:00Z', 812.5]] }],
    });
    const urls = JSON.parse(urlsLine) as string[];
    expect(urls.length).toBeGreaterThan(5);
    for (const url of urls) {
      expect(url.startsWith('http://127.0.0.1:9090/api/v1/query_range?')).toBe(true);
      expect(url).toContain('start=2026-11-14T07%3A28%3A00Z');
    }
    expect(source).not.toMatch(/urlopen\([^)]*data=/);
  });

  it('answers a refused argument with one fixed line and no exception text', () => {
    const result = spawnSync('python3', [script, 'not-a-sha', '2026-11-14T06:10:00Z', '30'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(
      '{"readOnly":true,"status":"diagnostic_refused","rawLogsExported":false}'
    );
  });

  it('reads host pressure only from the loopback Prometheus query_range API', () => {
    const source = readFileSync(script, 'utf8');
    const urls = source.match(/http:\/\/[^'"\s]+/g) ?? [];
    expect(urls).toEqual(['http://127.0.0.1:9090/api/v1/query_range?']);
    expect(source).not.toMatch(/method=|data=|urlopen\([^)]*data/);
  });

  it('only ever reads: no command in it can change the host', () => {
    expect(source).not.toMatch(
      /['"]docker['"],\s*['"](?:restart|stop|kill|rm|start|update|exec|run|pause|cp)['"]/
    );
    expect(source).not.toMatch(/systemctl|reboot|open\([^)]*['"][wa]/);
  });

  it('runs only from main, by a person, with pinned SSH and read-only repository access', () => {
    const workflow = parse(workflowText);
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    const job = workflow.jobs.inspect;
    expect(job.environment).toBe('ci-main');
    expect(job.if).toContain("github.triggering_actor != 'github-actions[bot]'");
    expect(job.if).toContain('refs/heads/{0}');
    expect(workflowText).toContain('-o StrictHostKeyChecking=yes');
    expect(workflowText).toContain('-o GlobalKnownHostsFile=/dev/null');
    expect(workflowText).toContain('< scripts/ci/inspect-engine-restart-evidence.py');
    expect(workflowText).toContain('^(-|[0-9a-f]{8})$');
  });
});
