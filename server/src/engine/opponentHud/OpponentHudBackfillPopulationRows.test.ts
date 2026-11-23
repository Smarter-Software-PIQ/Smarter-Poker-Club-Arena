/**
 * OPPONENT HUD BACKFILL, LOAD HARDENING (2026-11-22, PLO-OWNER lead-5; review of the 24-hour audit, P2-4):
 * a rebuild that applied no hand writes no population row (never a '*' row with wm_ms -1), and the operator
 * workflow that runs the rebuild is manual only, backs off at 2000 ms by default and passes the reader's
 * window / concurrency only when the operator names them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { backfillPopulationRows } from './OpponentHudBackfillPlan.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('opponent HUD backfill: the population rows of a rebuild', () => {
  const priors = { plo4: { family: { a: 1 }, stakes: {} }, plo5: { family: { b: 2 }, stakes: {} } };
  const families = ['plo4', 'plo5'] as const;

  it('a rebuild that applied no hand writes no population row: never wm_ms -1 over the stored sync point', () => {
    expect(backfillPopulationRows({ families, hands: 0, lastHandAtMs: -1, priors })).toEqual([]);
    // no hand counted, whatever the watermark says; and no watermark, whatever the count says
    expect(
      backfillPopulationRows({ families, hands: 0, lastHandAtMs: 1_800_000_000_000, priors })
    ).toEqual([]);
    expect(backfillPopulationRows({ families, hands: 3, lastHandAtMs: -1, priors })).toEqual([]);
    expect(
      backfillPopulationRows({ families, hands: 3, lastHandAtMs: Number.NaN, priors })
    ).toEqual([]);
  });

  it('a rebuild that applied hands writes one row per family, stamped with its newest hand', () => {
    const rows = backfillPopulationRows({
      families,
      hands: 2,
      lastHandAtMs: 1_800_000_000_000.4,
      priors,
    });
    expect(rows).toEqual([
      {
        user_id: '*',
        family: 'plo4',
        version: 1,
        hands: 0,
        wm_ms: 1_800_000_000_000,
        profile: priors.plo4,
        rebuild: true,
      },
      {
        user_id: '*',
        family: 'plo5',
        version: 1,
        hands: 0,
        wm_ms: 1_800_000_000_000,
        profile: priors.plo5,
        rebuild: true,
      },
    ]);
    expect(rows.every((r) => r.wm_ms > 0)).toBe(true);
  });

  it('the build script writes its population rows only through that rule', () => {
    const src = read('../../../scripts/opponent-hud-build.ts');
    expect(src).toMatch(/backfillPopulationRows\(\{/);
    expect(src).toMatch(/rows\.push\(\.\.\.populationRows\)/);
    // no population row is built in the script itself
    expect(src).not.toMatch(/user_id:\s*'\*'/);
    expect(src).not.toMatch(/wm_ms:\s*Math\.round\(lastHandAt\)/);
  });
});

describe('opponent HUD backfill: the operator workflow', () => {
  const yml = read('../../../../.github/workflows/opponent-hud-backfill.yml');
  const input = (name: string): string => {
    const start = yml.indexOf(`\n      ${name}:\n`);
    expect(start).toBeGreaterThan(-1);
    const rest = yml.slice(start + 1);
    const next = rest.slice(1).search(/\n {6}[a-z_]+:\n|\n[a-z]/);
    return next < 0 ? rest : rest.slice(0, next + 1);
  };

  it('runs only when an operator dispatches it', () => {
    const on = yml.slice(yml.indexOf('\non:\n'), yml.indexOf('\nconcurrency:\n'));
    expect(on).toMatch(/^\non:\n {2}workflow_dispatch:\n/);
    expect(on.match(/^ {2}[a-z_]+:/gm)).toEqual(['  workflow_dispatch:']);
    expect(yml).not.toMatch(
      /^\s*(schedule|push|pull_request|pull_request_target|workflow_run|workflow_call|repository_dispatch):/m
    );
    expect(yml).not.toMatch(/cron:/);
  });

  it('backs off at 2000 ms by default (500-row pages), not the 6000 ms tuned for 1,500-row pages', () => {
    expect(input('slow_ms')).toMatch(/default: '2000'\n/);
    expect(yml).not.toMatch(/default: '6000'/);
  });

  it('window_hours and concurrency are optional, blank by default, validated, and passed only when named', () => {
    for (const name of ['window_hours', 'concurrency']) {
      expect(input(name)).toMatch(/required: false\n/);
      expect(input(name)).toMatch(/default: ''\n/);
    }
    expect(yml).toMatch(/BACKFILL_WINDOW_HOURS: \$\{\{ inputs\.window_hours \}\}/);
    expect(yml).toMatch(/BACKFILL_CONCURRENCY: \$\{\{ inputs\.concurrency \}\}/);
    // an input never reaches the shell as text: only through the environment, and only after its check
    const script = yml.slice(
      yml.indexOf('run: |\n          set -euo pipefail'),
      yml.indexOf('      - name: Upload backfill log')
    );
    expect(script.length).toBeGreaterThan(500);
    expect(script).not.toMatch(/\$\{\{/);
    expect(yml).toMatch(
      /if \[ -n "\$\{BACKFILL_WINDOW_HOURS:-\}" \]; then\n.*Invalid window_hours.*\n\s+EXTRA_ARGS\+=\(--window-hours "\$BACKFILL_WINDOW_HOURS"\)/
    );
    expect(yml).toMatch(
      /if \[ -n "\$\{BACKFILL_CONCURRENCY:-\}" \]; then\n.*Invalid concurrency.*\n\s+EXTRA_ARGS\+=\(--concurrency "\$BACKFILL_CONCURRENCY"\)/
    );
    // both runs of the script (dry-run and apply) carry the optional flags
    expect(
      yml.match(/--slow-ms "\$BACKFILL_SLOW_MS" \$\{EXTRA_ARGS\[@\]\+"\$\{EXTRA_ARGS\[@\]\}"\}/g)
        ?.length
    ).toBe(2);
  });
});
