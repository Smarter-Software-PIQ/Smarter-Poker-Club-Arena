import { describe, expect, it, vi } from 'vitest';

// Subprocess contract suite: these tests drive REAL child processes, so their
// wall time scales with machine load, not with the code under test. vitest's
// 5000ms default is a UNIT-test budget: the slowest test here measures 582ms
// solo, and the pre-push hook runs this file in a 90-file suite at full width,
// where contention has been measured to stretch these runs by 7.1x and time
// them out. 90s is 154x the measured solo runtime - past anything observed,
// and still a real bound, so a genuinely hung child still fails the suite.
// File-scoped on purpose: no global testTimeout, no --no-file-parallelism.
vi.setConfig({ testTimeout: 90_000 });
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import {
  compareSpinReportingContract,
  readEvaluatedRules,
  ruleHealthFailures,
} from '../../scripts/ci/check-alert-rules-match.mjs';
import { classifyChangedPaths } from '../../scripts/ci/classify-ci-changes.mjs';
import { metricsIn } from '../../scripts/ci/rule-metric-producers.mjs';

// The existing required hosted client suite executes this contract.
// YAML is already a test dependency used by fixtureNativeCi.test.ts; the
// deployed comparator itself uses only Node built-ins and requires no install.
const root = resolve(__dirname, '../..');
const source = readFileSync(join(root, 'infra/monitoring/spin-rules.yml'), 'utf8');

function loaded() {
  // Independently decode the authoritative YAML, rather than obtaining the
  // expected templates from the comparator's reviewed constants.
  const document = parse(source);
  const groups = document.groups.filter((group: any) => group.name === 'spin-experience');
  expect(groups).toHaveLength(1);
  const rules = groups[0].rules.filter((rule: any) => rule.alert === 'SpinUnfilledBacklog');
  expect(rules).toHaveLength(1);
  const rule = rules[0];
  expect(rule.for).toBe('20m');
  return {
    status: 'success',
    data: {
      groups: [
        {
          name: groups[0].name,
          file: '/etc/prometheus/spin-rules.yml',
          interval: 60,
          rules: [
            {
              type: 'alerting',
              name: rule.alert,
              query: rule.expr,
              duration: 1200,
              keepFiringFor: 0,
              labels: rule.labels,
              annotations: rule.annotations,
              health: 'ok',
              lastError: '',
              lastEvaluation: '2026-09-17T13:05:30.5729651Z',
            },
          ],
        },
      ],
    },
  };
}

const alert = (response: ReturnType<typeof loaded>) => response.data.groups[0].rules[0];

describe('the loaded Spin rule must carry the actual reporting correction', () => {
  it('binds the descriptor to the maintained Prometheus loader configuration', () => {
    const config = parse(readFileSync(join(root, 'infra/monitoring/prometheus.yml'), 'utf8'));
    expect(config.rule_files.filter((file: string) => basename(file) === 'spin-rules.yml')).toEqual(
      ['/etc/prometheus/spin-rules.yml']
    );
  });

  it('accepts the exact current YAML contract through the real comparison function', () => {
    expect(compareSpinReportingContract(source, loaded())).toEqual([]);
  });

  it('rejects the real historical same-name old annotations even with a healthy rule', () => {
    const response = loaded();
    // Exact unexpanded rule-level annotations from retained /api/v1/rules
    // prometheus-rules-0204.json (SHA256 2a91d53e...8b89713b1), group21/rule2.
    // No historical active alert, user identity or membership is fabricated.
    alert(response).annotations = {
      summary: '{{ $value }} Spins are past their fill deadline and still open',
      description:
        'v_spin_unfilled_waits counts Spins open past the point they\n' +
        'should have been expired and refunded. The engine runs\n' +
        'fn_spin_expire_unfilled on its own timer; a standing backlog\n' +
        "means it is not, and registered players' chips are held in games\n" +
        'that are not going to start.\n',
      runbook: 'https://monitor.smarter.poker/runbooks/spin-unfilled-backlog',
    };
    expect(compareSpinReportingContract(source, response)).toEqual(['annotations']);
  });

  it.each(['query', 'duration', 'keepFiringFor', 'labels', 'annotations'])(
    'cannot acknowledge a changed or missing %s',
    (field) => {
      const response = loaded();
      (alert(response) as any)[field] =
        field === 'duration' ? 1199 : field === 'keepFiringFor' ? 1 : {};
      expect(compareSpinReportingContract(source, response)).toContain(field);
      delete (alert(response) as any)[field];
      expect(compareSpinReportingContract(source, response)).toContain(field);
    }
  );

  it('does not use an expanded nested alert as proof of the loaded rule template', () => {
    const response = loaded();
    (alert(response) as any).alerts = [{ annotations: { ...alert(response).annotations } }];
    alert(response).annotations.summary = 'old rule template';
    expect(compareSpinReportingContract(source, response)).toEqual(['annotations']);
  });

  it.each(['name', 'file'])('rejects the right rule under the wrong group %s', (field) => {
    const response = loaded();
    (response.data.groups[0] as any)[field] = 'different';
    expect(compareSpinReportingContract(source, response)).toEqual(['group/file']);
  });

  it('rejects duplicate identities even when one copy has the expected descriptor', () => {
    const response = loaded();
    response.data.groups.push({ ...response.data.groups[0], file: '/other/spin-rules.yml' });
    expect(() => compareSpinReportingContract(source, response)).toThrow('ambiguous');
  });

  it.each([
    null,
    {},
    { status: 'error' },
    { status: 'success', data: {} },
    { status: 'success', data: { groups: [] } },
    { status: 'success', data: { groups: [null] } },
  ])('never accepts unavailable evidence %j', (response) => {
    expect(() => compareSpinReportingContract(source, response)).toThrow();
  });

  it.each(['err', undefined])('refuses a rule without a healthy evaluation: %s', (health) => {
    const response = loaded();
    (alert(response) as any).health = health;
    expect(() => compareSpinReportingContract(source, response)).toThrow('healthy');
  });

  it('refuses stale selected source, missing/duplicate blocks and a changed source group', () => {
    expect(() =>
      compareSpinReportingContract(
        source.replace('partly filled past their human window', 'obsolete claim'),
        loaded()
      )
    ).toThrow('source changed');
    expect(() =>
      compareSpinReportingContract(
        source.replace('alert: SpinUnfilledBacklog', 'alert: Removed'),
        loaded()
      )
    ).toThrow('missing');
    expect(() =>
      compareSpinReportingContract(source + '\n      - alert: SpinUnfilledBacklog\n', loaded())
    ).toThrow('ambiguous');
    expect(() =>
      compareSpinReportingContract(
        source.replace('name: spin-experience', 'name: renamed'),
        loaded()
      )
    ).toThrow('group changed');
  });

  it('does not pin unrelated rules or their annotations', () => {
    expect(
      compareSpinReportingContract(
        source.replace('name: spin-fairness', 'name: other-fairness'),
        loaded()
      )
    ).toEqual([]);
  });
});

describe('every loaded rule must report clean health, with one bounded first-evaluation read', () => {
  // A second group holding one alerting and one recording rule, so the fixture
  // proves the check reads beyond the Spin rule and beyond alerting rules.
  function withOthers(response = loaded()) {
    response.data.groups.push({
      name: 'reliability-controller',
      file: '/etc/prometheus/recovery-rules.yml',
      interval: 15,
      rules: [
        {
          type: 'alerting',
          name: 'ReliabilityControllerStale',
          health: 'ok',
          lastError: '',
          lastEvaluation: '2026-11-11T13:05:30Z',
        },
        {
          type: 'recording',
          name: 'poker_money_health_stale_seconds',
          health: 'ok',
          lastEvaluation: '2026-11-11T13:05:30Z',
        },
      ] as any[],
    } as any);
    return response;
  }
  const other = (response: any, index: number) => response.data.groups[1].rules[index];
  function unevaluated(rule: any) {
    rule.health = 'unknown';
    rule.lastEvaluation = '0001-01-01T00:00:00Z';
    // Prometheus uses omitempty: a fresh no-error rule omits lastError.
    delete rule.lastError;
  }
  async function read(first: any, later: any[] = []) {
    const reads = [first, ...later];
    const waits: number[] = [];
    let count = 0;
    const response = await readEvaluatedRules(
      () => {
        if (count >= reads.length) throw new Error('unexpected extra read');
        return reads[count++];
      },
      async (ms: number) => {
        waits.push(ms);
      }
    );
    return { response, waits, count };
  }

  it('all ok: no wait, one read, no failures', async () => {
    const { response, waits, count } = await read(withOthers());
    expect(waits).toEqual([]);
    expect(count).toBe(1);
    expect(ruleHealthFailures(response)).toEqual([]);
  });

  it.each([
    ['alerting', 0],
    ['recording', 1],
  ])('one %s rule erroring fails at once, without waiting', async (_kind, index) => {
    const first = withOthers();
    other(first, index).health = 'err';
    other(first, index).lastError = 'found duplicate series for the match group';
    const { response, waits, count } = await read(first);
    expect(waits).toEqual([]);
    expect(count).toBe(1);
    const failures = ruleHealthFailures(response);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      name: other(first, index).name,
      health: 'err',
      lastError: 'found duplicate series for the match group',
      unevaluated: false,
    });
  });

  it.each([null, 0, false, {}, 'evaluation failed'])(
    'a lastError that is not empty is a failure even with health ok: %j',
    async (lastError) => {
      const first = withOthers();
      other(first, 0).lastError = lastError;
      const { response, waits } = await read(first);
      expect(waits).toEqual([]);
      expect(ruleHealthFailures(response)).toHaveLength(1);
    }
  );

  it('unevaluated within grace: waits one declared interval, re-reads once, passes', async () => {
    const first = withOthers();
    unevaluated(other(first, 0));
    unevaluated(other(first, 1));
    unevaluated(alert(first));
    expect(ruleHealthFailures(first).map((f: any) => f.unevaluated)).toEqual([true, true, true]);
    const { response, waits, count } = await read(first, [withOthers()]);
    // The largest declared interval among the affected groups: Spin's 60s.
    expect(waits).toEqual([60000]);
    expect(count).toBe(2);
    expect(ruleHealthFailures(response)).toEqual([]);
    expect(compareSpinReportingContract(source, response)).toEqual([]);
  });

  it('the grace is the affected group interval, not the slowest group', async () => {
    const first = withOthers();
    unevaluated(other(first, 1));
    const { waits } = await read(first, [withOthers()]);
    expect(waits).toEqual([15000]);
  });

  it('unevaluated past grace: one wait, one re-read, then fails', async () => {
    const first = withOthers();
    unevaluated(other(first, 1));
    const final = withOthers();
    unevaluated(other(final, 1));
    const { response, waits, count } = await read(first, [final]);
    expect(waits).toEqual([15000]);
    expect(count).toBe(2);
    const failures = ruleHealthFailures(response);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      name: 'poker_money_health_stale_seconds',
      type: 'recording',
      health: 'unknown',
      unevaluated: true,
    });
  });

  it('an error alongside an unevaluated rule does not buy a wait', async () => {
    const first = withOthers();
    unevaluated(other(first, 1));
    other(first, 0).health = 'err';
    other(first, 0).lastError = 'bad';
    const { response, waits, count } = await read(first);
    expect(waits).toEqual([]);
    expect(count).toBe(1);
    expect(ruleHealthFailures(response)).toHaveLength(2);
  });

  it.each([undefined, 0, -15, 301, '15', Number.NaN])(
    'an undeclared or out-of-bounds interval %j gets no wait and fails',
    async (interval) => {
      const first = withOthers();
      unevaluated(other(first, 1));
      (first.data.groups[1] as any).interval = interval;
      const { response, waits, count } = await read(first);
      expect(waits).toEqual([]);
      expect(count).toBe(1);
      expect(ruleHealthFailures(response)).toHaveLength(1);
    }
  );

  it('rechecks Spin content and identity after the wait', async () => {
    for (const kind of ['drift', 'duplicate']) {
      const first = loaded();
      unevaluated(alert(first));
      const final = loaded();
      if (kind === 'drift') alert(final).annotations.summary = 'changed during wait';
      else final.data.groups.push({ ...final.data.groups[0] });
      const { response } = await read(first, [final]);
      if (kind === 'drift')
        expect(compareSpinReportingContract(source, response)).toEqual(['annotations']);
      else expect(() => compareSpinReportingContract(source, response)).toThrow('ambiguous');
    }
  });

  it('propagates transport failure on the final read', async () => {
    const first = loaded();
    unevaluated(alert(first));
    let count = 0;
    await expect(
      readEvaluatedRules(
        () => {
          if (++count === 1) return first;
          throw new Error('transport refused');
        },
        async () => {}
      )
    ).rejects.toThrow('transport refused');
    expect(count).toBe(2);
  });

  it.each([
    null,
    {},
    { status: 'error' },
    { status: 'success', data: {} },
    { status: 'success', data: { groups: [] } },
    { status: 'success', data: { groups: [null] } },
    { status: 'success', data: { groups: [{ name: 'g', rules: [null] }] } },
  ])('never accepts unavailable or malformed evidence %j', (response) => {
    let threw = false;
    try {
      threw = ruleHealthFailures(response).length > 0;
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe('the deployed command actually enforces the comparison', () => {
  it.each(['current', 'old', 'unavailable', 'canary-missing', 'rule-erroring'])(
    'returns the authoritative command outcome for %s evidence',
    (kind) => {
      const directory = mkdtempSync(join(tmpdir(), 'spin-rule-command-'));
      try {
        // Exercise the real command and all its original name/metric/canary
        // checks. Only the HTTP transport is replaced with an offline fixture.
        // No production URL, SSH identity or credential is passed; fixture curl
        // reads local JSON and has no network operation. This is not a VM seal.
        const config = parse(readFileSync(join(root, 'infra/monitoring/prometheus.yml'), 'utf8'));
        const groups: any[] = [];
        const series = new Set<string>();
        for (const file of config.rule_files) {
          const document = parse(
            readFileSync(join(root, 'infra/monitoring', basename(file)), 'utf8')
          );
          for (const group of document.groups ?? []) {
            groups.push({
              name: group.name,
              file,
              rules: (group.rules ?? []).map((rule: any) => {
                for (const metric of metricsIn(String(rule.expr))) series.add(metric);
                return rule.alert === 'SpinUnfilledBacklog'
                  ? { ...alert(loaded()), annotations: { ...rule.annotations } }
                  : {
                      name: rule.alert ?? rule.record,
                      type: rule.alert ? 'alerting' : 'recording',
                      health: 'ok',
                      lastError: '',
                    };
              }),
            });
          }
        }
        const target = groups
          .flatMap((group) => group.rules)
          .filter((rule) => rule.name === 'SpinUnfilledBacklog');
        expect(target).toHaveLength(1);
        if (kind === 'rule-erroring') {
          const stale = groups
            .flatMap((group) => group.rules)
            .filter((rule) => rule.name === 'ReliabilityControllerStale');
          expect(stale).toHaveLength(1);
          stale[0].health = 'err';
          stale[0].lastError = 'vector cannot contain metrics with the same labelset';
        }
        if (kind === 'old')
          target[0].annotations.summary =
            '{{ $value }} Spins are past their fill deadline and still open';
        const responses = {
          'http://fixture.invalid:9090/api/v1/rules':
            kind === 'unavailable'
              ? { status: 'error', error: 'fixture unavailable' }
              : { status: 'success', data: { groups } },
          'http://fixture.invalid:9090/api/v1/label/__name__/values': {
            status: 'success',
            data: [...series],
          },
          'http://fixture.invalid:9093/api/v2/alerts':
            kind === 'canary-missing' ? [] : [{ labels: { alertname: 'MonitoringCanary' } }],
        };
        writeFileSync(join(directory, 'responses.json'), JSON.stringify(responses));
        writeFileSync(
          join(directory, 'curl'),
          '#!/usr/bin/env node\n' +
            "const fs = require('node:fs'); const path = require('node:path');\n" +
            "const responses = JSON.parse(fs.readFileSync(path.join(__dirname, 'responses.json'), 'utf8'));\n" +
            'const url = process.argv.at(-1); if (!Object.hasOwn(responses, url)) process.exit(7);\n' +
            'process.stdout.write(JSON.stringify(responses[url]));\n',
          { mode: 0o700 }
        );
        const result = spawnSync(
          process.execPath,
          [join(root, 'scripts/ci/check-alert-rules-match.mjs')],
          {
            cwd: root,
            encoding: 'utf8',
            timeout: 20000,
            maxBuffer: 1024 * 1024,
            env: {
              PATH: directory + delimiter + dirname(process.execPath),
              PROMETHEUS_URL: 'http://fixture.invalid:9090',
              ALERTMANAGER_URL: 'http://fixture.invalid:9093',
            },
          }
        );
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status, result.stdout + result.stderr).toBe(
          kind === 'current' ? 0 : kind === 'unavailable' ? 2 : 1
        );
        if (kind === 'old') expect(result.stderr).toContain('SpinUnfilledBacklog DIFFERS');
        if (kind === 'canary-missing')
          expect(result.stderr).toContain('THE CANARY IS NOT IN ALERTMANAGER');
        if (kind === 'rule-erroring') {
          expect(result.stderr).toContain('RULES THAT ARE NOT EVALUATING CLEANLY (1)');
          expect(result.stderr).toContain('ReliabilityControllerStale');
        }
        if (kind === 'current')
          expect(result.stdout).toMatch(
            /rule health: all \d+ alerting and \d+ recording rules report health=ok/
          );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    25000
  );
});

describe('the existing directly triggered suites own this regression', () => {
  it.each([
    'infra/monitoring/spin-rules.yml',
    'infra/monitoring/prometheus.yml',
    'scripts/ci/check-alert-rules-match.mjs',
    'scripts/ci/rule-metric-producers.mjs',
  ])('runs the client regression for %s', (path) => {
    expect(classifyChangedPaths([path]).tests).toBe(true);
    expect(classifyChangedPaths([path]).src).toBe(false);
  });
  it('also runs the existing server Spin rule suite for rule-only changes', () => {
    expect(classifyChangedPaths(['infra/monitoring/spin-rules.yml']).server).toBe(true);
  });
  it('keeps unrelated documentation outside the application suites', () => {
    expect(classifyChangedPaths(['docs/example.md'])).toMatchObject({
      src: false,
      server: false,
      tests: false,
    });
  });
});
