/**
 * LAW: the Backup soak may be shorter than 30 minutes only because memory
 * growth across it is a judged gate.
 * ============================================================================
 * 2026-11-26 (engine cutover lane; the owner asked for a certification short
 * enough that two attempts fit in one three-hour cycle):
 *   1. `standby-engine certify` soaks for 900 s. The workflow call, the
 *      script default and the selector floor carry the same number.
 *   2. `judge_soak_memory_growth` in `server/standby/standby-engine.sh` judges
 *      memory sampled across the whole soak: the median of pairwise slopes
 *      must exceed 141 MiB per minute over the whole soak and half of that in
 *      each half before a build is refused. 141 = (26,624 MiB container limit
 *      minus the 1,243 MiB largest healthy start) / 180 minutes.
 *   3. It passes every real certificate measured before the change (the 73
 *      below, start and end `docker stats` readings of 1800 s soaks), even
 *      with each one's whole 30-minute growth squeezed into the soak.
 *   4. "Unreadable" is its own status and its own certificate reason; it is
 *      never a pass, and it takes most of the soak's reads failing.
 *   5. The selector refuses a soak under 1800 s without a passing
 *      `memoryGrowthCheck`, and still accepts a certificate made by the
 *      earlier script (no such key) with its full 1800 s soak.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const STANDBY_PATH = join(ROOT, 'server/standby/standby-engine.sh');
const SELECTOR_PATH = join(ROOT, 'scripts/ci/select-daily-engine.py');
const standby = readFileSync(STANDBY_PATH, 'utf8');
const workflow = readFileSync(join(ROOT, '.github/workflows/backup-engine.yml'), 'utf8');
const selector = readFileSync(SELECTOR_PATH, 'utf8');

const SOAK = 900;
const LIMIT = 141;

/**
 * Every Backup certificate with two memory readings from runs 2026-11-21
 * 02:51Z to 2026-11-26 05:09Z, read from the certify job logs on 2026-11-26:
 * [sha, certifiedAt, verdict, memoryStart, memoryEnd]. All soaked 1800 s. The
 * 15 failures failed for a hand-gap verdict, none for memory.
 */
const MEASURED: [string, string, string, string, string][] = [
  ['f90f60b7c9b0', '2026-11-21T02:51:46Z', 'pass', '1.125GiB', '1.277GiB'],
  ['bb21dc826731', '2026-11-21T03:46:23Z', 'pass', '1.214GiB', '1.324GiB'],
  ['374bf584c25c', '2026-11-21T04:45:18Z', 'pass', '1.163GiB', '1.413GiB'],
  ['d6748b1c0ef9', '2026-11-21T05:48:58Z', 'fail', '1.138GiB', '1.358GiB'],
  ['045782d020fe', '2026-11-21T06:53:03Z', 'pass', '1.109GiB', '1.276GiB'],
  ['ac1d44ba4bc6', '2026-11-21T07:56:03Z', 'pass', '977MiB', '1.134GiB'],
  ['8ece47e777b9', '2026-11-21T10:32:23Z', 'pass', '977.7MiB', '925.7MiB'],
  ['2f5699adac29', '2026-11-21T11:38:02Z', 'pass', '777.8MiB', '845.8MiB'],
  ['945de20c45f7', '2026-11-21T14:19:20Z', 'pass', '710.5MiB', '956.2MiB'],
  ['8d01508d3d4f', '2026-11-21T15:35:39Z', 'pass', '882.7MiB', '1.259GiB'],
  ['28a7048459b0', '2026-11-21T16:31:18Z', 'pass', '871.1MiB', '1.235GiB'],
  ['8f99d9125e9a', '2026-11-21T17:27:21Z', 'pass', '828.5MiB', '1.184GiB'],
  ['c4c5d2efe50a', '2026-11-21T18:41:23Z', 'pass', '951.7MiB', '1.343GiB'],
  ['1a0a6047e1ac', '2026-11-21T19:38:41Z', 'pass', '667.7MiB', '939.4MiB'],
  ['02fa516cbdce', '2026-11-21T20:37:49Z', 'pass', '969.6MiB', '921.9MiB'],
  ['11f23384b046', '2026-11-21T21:39:15Z', 'pass', '955.7MiB', '1.074GiB'],
  ['64a9d8b8ba96', '2026-11-21T23:08:45Z', 'pass', '968.3MiB', '1.118GiB'],
  ['c2d6e45e3bcc', '2026-11-22T00:03:32Z', 'pass', '1018MiB', '1.078GiB'],
  ['0191691c15f3', '2026-11-22T00:59:05Z', 'pass', '982.1MiB', '1.014GiB'],
  ['5e85d1508c6a', '2026-11-22T01:57:40Z', 'pass', '995.5MiB', '1.049GiB'],
  ['d647047b0aa1', '2026-11-22T03:58:18Z', 'fail', '1.006GiB', '1.24GiB'],
  ['0a3a6a5211db', '2026-11-22T05:08:23Z', 'pass', '1.122GiB', '1.293GiB'],
  ['0a3a6a5211db', '2026-11-22T07:36:49Z', 'fail', '1.007GiB', '1.131GiB'],
  ['3b54b071664e', '2026-11-22T08:38:56Z', 'fail', '1.033GiB', '1.116GiB'],
  ['0a3a6a5211db', '2026-11-22T09:41:40Z', 'pass', '941.9MiB', '1.005GiB'],
  ['e22a92341779', '2026-11-22T10:42:18Z', 'pass', '964.1MiB', '959.8MiB'],
  ['b31db252025b', '2026-11-22T12:17:47Z', 'pass', '783MiB', '873.4MiB'],
  ['b31db252025b', '2026-11-22T13:47:32Z', 'pass', '763.4MiB', '1.067GiB'],
  ['3f0a9967d5f4', '2026-11-22T14:49:53Z', 'pass', '800.3MiB', '1.308GiB'],
  ['3f0a9967d5f4', '2026-11-22T15:42:41Z', 'pass', '815MiB', '1.485GiB'],
  ['a1610a68ab3a', '2026-11-22T16:49:56Z', 'pass', '744MiB', '994.2MiB'],
  ['ea92b56f0177', '2026-11-22T17:55:36Z', 'pass', '914.8MiB', '1.204GiB'],
  ['1ad80fe1a32b', '2026-11-22T18:50:57Z', 'pass', '957.9MiB', '1.273GiB'],
  ['ea92b56f0177', '2026-11-22T19:45:53Z', 'pass', '992.2MiB', '1.081GiB'],
  ['88b8dac0ebdc', '2026-11-22T21:15:37Z', 'pass', '975.5MiB', '1.056GiB'],
  ['a0a85b117bed', '2026-11-22T22:10:47Z', 'pass', '1.017GiB', '769.7MiB'],
  ['735299cd5fda', '2026-11-23T00:21:42Z', 'pass', '968.7MiB', '1.102GiB'],
  ['3811538b62a8', '2026-11-23T01:27:29Z', 'pass', '1.017GiB', '1.028GiB'],
  ['c0706e2b3563', '2026-11-23T06:11:26Z', 'pass', '1.07GiB', '1.293GiB'],
  ['8d4a7ef726d9', '2026-11-23T07:27:34Z', 'pass', '1.021GiB', '1.057GiB'],
  ['b99bd306892c', '2026-11-23T14:58:23Z', 'pass', '817.5MiB', '1.114GiB'],
  ['5dcc4a1f3aae', '2026-11-23T16:50:24Z', 'pass', '803.5MiB', '949.1MiB'],
  ['b99bd306892c', '2026-11-23T18:33:20Z', 'pass', '966.3MiB', '1.65GiB'],
  ['e8476fee8301', '2026-11-23T23:34:30Z', 'fail', '1011MiB', '1.171GiB'],
  ['329332c24c32', '2026-11-24T02:07:20Z', 'fail', '1.029GiB', '1.326GiB'],
  ['f3691fbe6097', '2026-11-24T03:04:36Z', 'fail', '1.059GiB', '1.27GiB'],
  ['d749a61e4c94', '2026-11-24T06:29:32Z', 'pass', '1.023GiB', '1.251GiB'],
  ['74d10c32eb6a', '2026-11-24T07:42:24Z', 'pass', '999.5MiB', '1.162GiB'],
  ['329332c24c32', '2026-11-24T09:07:47Z', 'pass', '981.9MiB', '1.075GiB'],
  ['74d10c32eb6a', '2026-11-24T10:49:15Z', 'pass', '798.3MiB', '889MiB'],
  ['19203b9a1f0b', '2026-11-24T12:47:19Z', 'fail', '608.5MiB', '803.2MiB'],
  ['6c6aaa7707ac', '2026-11-24T11:49:40Z', 'pass', '667.9MiB', '711.3MiB'],
  ['6c6aaa7707ac', '2026-11-24T13:47:54Z', 'pass', '622.5MiB', '1.357GiB'],
  ['7f6e30be571d', '2026-11-24T14:50:33Z', 'pass', '657.5MiB', '1.146GiB'],
  ['c8ddf7b05acc', '2026-11-24T15:45:55Z', 'pass', '746.8MiB', '1.014GiB'],
  ['7f6e30be571d', '2026-11-24T16:45:08Z', 'pass', '836.5MiB', '1.254GiB'],
  ['56b30273c6c0', '2026-11-24T17:43:27Z', 'fail', '847.8MiB', '1.289GiB'],
  ['192dc2a33704', '2026-11-24T18:49:40Z', 'pass', '857.5MiB', '1.262GiB'],
  ['cd445e2d0236', '2026-11-24T20:12:03Z', 'pass', '906.1MiB', '1.053GiB'],
  ['26b45e8d6832', '2026-11-24T23:42:08Z', 'pass', '1009MiB', '1.042GiB'],
  ['4a09cd246378', '2026-11-25T00:37:18Z', 'pass', '1.138GiB', '1.134GiB'],
  ['2989e6699e3a', '2026-11-25T01:26:45Z', 'fail', '1.054GiB', '1.143GiB'],
  ['d2833d21eb2a', '2026-11-25T02:31:24Z', 'pass', '1.098GiB', '1.342GiB'],
  ['24fef033b1e1', '2026-11-25T05:19:40Z', 'pass', '1.096GiB', '1.362GiB'],
  ['d07cd7d7feec', '2026-11-25T06:24:01Z', 'pass', '1.093GiB', '1.323GiB'],
  ['b7948ca90719', '2026-11-25T08:26:57Z', 'pass', '842.8MiB', '1.014GiB'],
  ['187d1ee1b4cf', '2026-11-25T07:26:37Z', 'pass', '973MiB', '1.072GiB'],
  ['58227a1bff74', '2026-11-25T16:37:02Z', 'fail', '667.8MiB', '1.027GiB'],
  ['6aa615079b67', '2026-11-25T17:52:55Z', 'fail', '862.7MiB', '1.034GiB'],
  ['4d88b3bf15c7', '2026-11-25T18:41:55Z', 'fail', '763.7MiB', '1.022GiB'],
  ['4311a9aec783', '2026-11-26T03:01:07Z', 'fail', '1.081GiB', '1.369GiB'],
  ['b7948ca90719', '2026-11-26T04:09:16Z', 'pass', '1005MiB', '954MiB'],
  ['9c6fd56475c7', '2026-11-26T05:09:53Z', 'fail', '1.112GiB', '1.321GiB'],
];

type Sample = { t: number; rss?: string | number; container?: string };

function judge(samples: Sample[], soak = SOAK) {
  const dir = mkdtempSync(join(tmpdir(), 'soak-memory-'));
  const file = join(dir, 'samples.tsv');
  writeFileSync(
    file,
    samples.map((s) => `${s.t}\t${s.rss ?? '-'}\t${s.container ?? '-'}\n`).join('')
  );
  const script = `
set -Eeuo pipefail
source ${JSON.stringify(STANDBY_PATH)}
judge_soak_memory_growth ${soak} ${JSON.stringify(file)}
`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  return { rc: r.status, check: JSON.parse(r.stdout), stderr: r.stderr };
}

const T0 = 1764130000;
/** One sample every 15 s across the soak, as the certify loop takes them. */
function series(valueAt: (minute: number, index: number) => number, soak = SOAK): Sample[] {
  const out: Sample[] = [];
  for (let s = 0, i = 0; s <= soak; s += 15, i += 1) {
    out.push({ t: T0 + s, rss: Math.round(valueAt(s / 60, i)) });
  }
  return out;
}

function toMib(text: string) {
  const m = /^([0-9.]+)(MiB|GiB)$/.exec(text);
  if (!m) throw new Error(`fixture ${text}`);
  return Number(m[1]) * (m[2] === 'GiB' ? 1024 : 1);
}

function dockerSize(mib: number) {
  return mib >= 1024 ? `${(mib / 1024).toFixed(3)}GiB` : `${mib.toFixed(1)}MiB`;
}

describe('the soak length agrees on every surface', () => {
  it('workflow call, script defaults and selector floor are all 900 s', () => {
    expect(workflow).toContain(`standby-engine certify $SHA ${SOAK}"`);
    expect(workflow).not.toMatch(/standby-engine certify \$SHA 1800/);
    expect(standby).toContain(`local sha="$1" soak="\${2:-${SOAK}}"`);
    expect(standby).toContain(`certify) cmd_certify "\${2:?sha}" "\${3:-${SOAK}}" ;;`);
    expect(selector).toMatch(new RegExp(`^SOAK_SECONDS = ${SOAK}$`, 'm'));
    expect(selector).toMatch(/^UNJUDGED_SOAK_SECONDS = 1800$/m);
    expect(selector).toContain('not soak_is_sufficient(cert)');
    expect(selector).not.toContain("cert['soakSeconds'] < 1800");
  });

  it('the hand-gap judge still grades its full 15 minutes inside the soak', () => {
    expect(standby).toContain('[ "$soak_window_min" -gt 15 ] && soak_window_min=15');
    expect(SOAK / 60).toBeGreaterThanOrEqual(15);
  });
});

describe('cmd_certify samples and judges memory across the soak', () => {
  const certify = standby.slice(standby.indexOf('cmd_certify() {'));

  it('samples the engine RSS and the container reading on every loop pass', () => {
    const loop = certify.slice(
      certify.indexOf('while [ "$(date +%s)" -lt "$end" ]; do'),
      certify.indexOf('soak_completed=1')
    );
    expect(loop).toContain('health_field memory.rssMb');
    expect(loop).toContain("docker stats --no-stream --format '{{.MemUsage}}'");
    expect(loop).toContain('>> "$mem_samples"');
    expect(loop).toContain('sleep 15');
  });

  it('records a distinct reason for a breach and for unreadable, and writes the check', () => {
    const call = certify.indexOf(
      'memory_growth_check=$(judge_soak_memory_growth "$soak" "$mem_samples") || mg_rc=$?'
    );
    expect(call).toBeGreaterThan(certify.indexOf('soak_completed=1'));
    expect(certify).toContain("record 'memory_growth_exceeded'");
    expect(certify).toContain("record 'memory_growth_unreadable'");
    expect(certify).toContain('"memoryGrowthCheck": json.loads(sys.argv[8])');
    // A judge that printed nothing usable is unreadable, never a pass.
    expect(certify).toContain('"reason": "judge_failed"');
    expect(certify).toContain('[ "$mg_rc" -ne 0 ] || mg_rc=2');
  });

  it('derives the limit from the container limit the engine actually runs with', () => {
    expect(standby).toContain('--memory 26g');
    expect(standby).toContain('CONTAINER_LIMIT_MIB = 26 * 1024');
    expect(standby).toContain('HEALTHY_START_MAX_MIB = 1243');
    expect(standby).toContain('HORIZON_MINUTES = 180');
    expect(Math.floor((26 * 1024 - 1243) / 180)).toBe(LIMIT);
    const starts = MEASURED.map((m) => toMib(m[3]));
    expect(Math.ceil(Math.max(...starts))).toBeLessThanOrEqual(1244);
  });
});

describe('the judge on real certificates', () => {
  it('holds the measured distribution the limit was derived from', () => {
    expect(MEASURED).toHaveLength(73);
    const perMinute = MEASURED.map((m) => (toMib(m[4]) - toMib(m[3])) / 30).sort((a, b) => a - b);
    expect(perMinute[perMinute.length - 1]).toBeCloseTo(25.6, 1);
    expect(perMinute[Math.floor(perMinute.length / 2)]).toBeCloseTo(6.5, 1);
    // The limit is at least five times the largest healthy 30-minute slope.
    expect(LIMIT / perMinute[perMinute.length - 1]).toBeGreaterThan(5);
  });

  it('passes every one, with its whole 30-minute growth squeezed into the 900 s soak', () => {
    for (const [sha, , , start, end] of MEASURED) {
      const a = toMib(start);
      const b = toMib(end);
      const samples: Sample[] = [];
      for (let s = 0; s <= SOAK; s += 15) {
        samples.push({ t: T0 + s, container: dockerSize(a + ((b - a) * s) / SOAK) });
      }
      const r = judge(samples);
      expect(r.rc, `${sha} ${start} -> ${end}: ${r.stderr}`).toBe(0);
      expect(r.check.status).toBe('pass');
      expect(r.check.source).toBe('container');
      expect(r.check.slopeMibPerMin).toBeLessThan(LIMIT / 2);
    }
  }, 120000);

  it('passes each real pair even when all of its growth lands in the first five minutes', () => {
    const [, , , start, end] = MEASURED.reduce((worst, m) =>
      toMib(m[4]) - toMib(m[3]) > toMib(worst[4]) - toMib(worst[3]) ? m : worst
    );
    const a = toMib(start);
    const b = toMib(end);
    const r = judge(series((minute) => a + (b - a) * Math.min(1, minute / 5)));
    expect(r.rc).toBe(0);
    expect(r.check.status).toBe('pass');
  });
});

describe('the judge on synthetic soaks', () => {
  it('fails a steady leak that would reach the container limit inside one cycle', () => {
    const r = judge(series((minute, i) => 1000 + 300 * minute + (i % 2 ? 12 : -12)));
    expect(r.rc).toBe(1);
    expect(r.check.status).toBe('fail');
    expect(r.check.source).toBe('engine_rss');
    expect(r.check.slopeMibPerMin).toBeGreaterThan(290);
    expect(r.check.limitMibPerMin).toBe(LIMIT);
    expect(r.check.samples).toBe(61);
    expect(r.check.series).toHaveLength(61);
    expect(r.stderr).toContain('FAIL memory growth');
    expect(r.stderr).toContain(`limit ${LIMIT} MiB/min`);
  });

  it('fails just above the limit and passes just below it', () => {
    expect(judge(series((minute) => 1000 + (LIMIT + 6) * minute)).rc).toBe(1);
    expect(judge(series((minute) => 1000 + (LIMIT - 6) * minute)).rc).toBe(0);
  });

  it('does not fail on one spike at the end of the soak', () => {
    const r = judge(series((minute, i) => (i >= 59 ? 9000 : 1000 + 5 * minute)));
    expect(r.rc).toBe(0);
    expect(r.check.status).toBe('pass');
    expect(r.check.maxMib).toBe(9000);
    expect(r.check.slopeMibPerMin).toBeLessThan(10);
  });

  it('does not fail on a burst over the last two minutes or on a garbage-collection sawtooth', () => {
    expect(judge(series((minute) => (minute >= 13 ? 6000 : 1000))).rc).toBe(0);
    expect(judge(series((minute, i) => 1000 + 6 * minute + (i % 8) * 60)).rc).toBe(0);
  });

  it('does not fail on a one-time step, which is not a leak', () => {
    const r = judge(series((minute) => (minute >= 7.5 ? 6000 : 1000)));
    expect(r.rc).toBe(0);
    expect(r.check.status).toBe('pass');
    expect(r.check.growthMib).toBe(5000);
  });

  it('parses every size unit docker prints, and bare MiB from /health', () => {
    const units: [string, number][] = [
      ['1073741824B', 1024],
      ['1048576KiB', 1024],
      ['1024MiB', 1024],
      ['1GiB', 1024],
      ['1048576kB', 1000],
      ['1024MB', 976.6],
      ['1.5GB', 1430.5],
    ];
    for (const [text, mib] of units) {
      const samples: Sample[] = [];
      for (let s = 0; s <= SOAK; s += 15) samples.push({ t: T0 + s, container: text });
      const r = judge(samples);
      expect(r.rc, text).toBe(0);
      expect(r.check.startMib, text).toBeCloseTo(mib, 0);
    }
    expect(judge(series(() => 1234)).check.startMib).toBe(1234);
  });

  it('falls back to the container series when /health carries no memory', () => {
    const samples: Sample[] = [];
    for (let s = 0; s <= SOAK; s += 15) {
      samples.push({ t: T0 + s, container: dockerSize(1000 + (300 * s) / 60) });
    }
    const r = judge(samples);
    expect(r.rc).toBe(1);
    expect(r.check.source).toBe('container');
    expect(r.check.sources.engine_rss.samples).toBe(0);
  });

  it('judges through scattered read failures', () => {
    const samples = series((minute) => 1000 + 4 * minute).map((s, i) =>
      i % 3 === 0 ? { t: s.t } : s
    );
    const r = judge(samples);
    expect(r.rc).toBe(0);
    expect(r.check.status).toBe('pass');
    expect(r.check.attempts).toBe(61);
    expect(r.check.samples).toBe(40);
  });
});

describe('unreadable is its own outcome', () => {
  it('no readable sample in a whole soak of attempts is unreadable, not pass', () => {
    const samples: Sample[] = [];
    for (let s = 0; s <= SOAK; s += 15) samples.push({ t: T0 + s, container: 'n/a' });
    const r = judge(samples);
    expect(r.rc).toBe(2);
    expect(r.check.status).toBe('unreadable');
    expect(r.check.reason).toBe('too_few_readable_samples');
    expect(r.check.attempts).toBe(61);
    expect(r.stderr).toContain('memory_growth_unreadable');
  });

  it('samples that cover under half the soak are unreadable', () => {
    const r = judge(series((minute) => 1000 + 400 * minute).slice(0, 20));
    expect(r.rc).toBe(2);
    expect(r.check.status).toBe('unreadable');
  });

  it('a missing samples file is unreadable', () => {
    const script = `set -Eeuo pipefail; source ${JSON.stringify(STANDBY_PATH)}; judge_soak_memory_growth 900 /nonexistent/samples`;
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).status).toBe('unreadable');
  });
});

describe('the selector', () => {
  function sufficient(cert: Record<string, unknown>) {
    const code = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('select_daily_engine', sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
print(json.dumps(mod.soak_is_sufficient(json.loads(sys.argv[2]))))
`;
    const r = spawnSync('python3', ['-B', '-c', code, SELECTOR_PATH, JSON.stringify(cert)], {
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout);
  }

  it('accepts a 900 s soak only with a passing memory growth check', () => {
    expect(sufficient({ soakSeconds: 900, memoryGrowthCheck: { status: 'pass' } })).toBe(true);
    expect(sufficient({ soakSeconds: 900 })).toBe(false);
    expect(sufficient({ soakSeconds: 900, memoryGrowthCheck: null })).toBe(false);
    for (const status of ['fail', 'unreadable', 'not_judged', '']) {
      expect(sufficient({ soakSeconds: 900, memoryGrowthCheck: { status } })).toBe(false);
    }
    expect(sufficient({ soakSeconds: 899, memoryGrowthCheck: { status: 'pass' } })).toBe(false);
  });

  it('still accepts a certificate made before the change: 1800 s and no check key', () => {
    expect(sufficient({ soakSeconds: 1800 })).toBe(true);
    expect(sufficient({ soakSeconds: 1799 })).toBe(false);
  });

  it('a certificate that carries the check must pass it whatever its soak length', () => {
    expect(sufficient({ soakSeconds: 1800, memoryGrowthCheck: { status: 'pass' } })).toBe(true);
    expect(sufficient({ soakSeconds: 1800, memoryGrowthCheck: { status: 'unreadable' } })).toBe(
      false
    );
    expect(sufficient({ soakSeconds: 1800, memoryGrowthCheck: null })).toBe(false);
    expect(sufficient({ soakSeconds: '1800' })).toBe(false);
  });
});
