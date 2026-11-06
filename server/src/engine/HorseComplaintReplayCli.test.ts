/**
 * Phase 5.3: the complaint replay CLI (scripts/horse-measure/horse-complaint-replay.ts)
 * end to end on the first committed complaint (the Phase 3 QQ hand), turned
 * back into the extract shape complaint-extract.sql returns. The CLI only
 * reads its input; --emit-law writes into a temporary directory here.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import FIXTURE from './horseComplaints/qq-big-blind-four-bet-then-fold-to-the-deeper-opener.fixture.json';
import type { ComplaintFixture } from './HorseComplaintReplay.js';

const FX = FIXTURE as unknown as ComplaintFixture;
const SERVER = process.cwd();
const TSX = resolve(SERVER, 'node_modules/.bin/tsx');
const CLI = resolve(SERVER, '../scripts/horse-measure/horse-complaint-replay.ts');
const dir = mkdtempSync(join(tmpdir(), 'complaint-cli-'));
const extract = join(dir, 'extract.json');
writeFileSync(
  extract,
  JSON.stringify({
    result: `Below is the result of the SQL query.\n<untrusted-data-q1>\n${JSON.stringify([
      {
        hand: {
          handId: FX.handId,
          tournamentId: null,
          variant: FX.variant,
          bigBlind: 0.5,
          smallBlind: 0.25,
          hasHuman: false,
          players: FX.players.map((p) => ({
            seat: p.seat,
            userId: `u${p.seat}`,
            isHorse: p.isHorse,
          })),
          horseHoleCards: Object.fromEntries(Object.entries(FX.hole).map(([s, c]) => [`u${s}`, c])),
          actions: FX.actions.map((a) => ({ ...a, userId: `u${a.seat}` })),
        },
      },
    ])}\n</untrusted-data-q1>`,
  })
);
const cli = (...args: string[]) => {
  const r = spawnSync(TSX, [CLI, '--extract', extract, ...args], { cwd: SERVER, encoding: 'utf8' });
  return { status: r.status, out: r.stdout, err: r.stderr };
};

describe('complaint replay CLI', () => {
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('replays every horse decision and reports verdict, rules and the scorecard cell', () => {
    const r = cli('--json', '--seeds', '3', '--complaint', 'QQ 4-bet then folded');
    expect(r.status, r.err).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.complaint).toBe('QQ 4-bet then folded');
    expect(j.seeds).toEqual([1, 7, 42]);
    expect(j.nodes.map((n: { ord: number }) => n.ord)).toEqual([9, 12]);
    expect(j.nodes[0].recorded.kind).toBe('raise');
    expect(j.nodes[0].spot.cell).toMatchObject({ family: 'four_bet_fold', key: 'nlh|cash' });
    expect(j.nodes[0].measured).toContain('--scorecard');
    expect(j.nodes[0].profiles[0].live).toBe(true);
  }, 60_000);

  it('looks the cell up in an assembled scorecard and checks a forbidden path', () => {
    const sc = join(dir, 'scorecard.json');
    writeFileSync(
      sc,
      JSON.stringify({
        day: '2026-11-04',
        cells: [
          {
            variant: 'nlh',
            format: 'cash',
            four_bet_hands: 1059,
            four_bet_then_fold_hands: 130,
            four_bet_then_fold_ci: [0.1, 0.14],
          },
        ],
      })
    );
    const r = cli('--ord', '9', '--seeds', '2', '--scorecard', sc);
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('4-bet-then-fold nlh cash on 2026-11-04: 130 of 1059');
    expect(r.out).toContain('Decision 9 (seat 2, preflop)');
    const path = cli('--forbid', '9:raise,12:fold');
    expect(path.status, path.err).toBe(0);
    expect(path.out).toContain('taken by no profile at any seed');
    expect(cli('--forbid', '9:raise,12:call').status).not.toBe(0);
  }, 60_000);

  it('emits a permanent law from the template: anonymised fixture plus a law test', () => {
    const out = join(dir, 'laws');
    const r = cli(
      '--emit-law',
      'qq-cli-check',
      '--forbid',
      '9:raise,12:fold',
      '--title',
      "QQ's 4-bet then fold",
      '--complaint',
      'it folded */ QQ',
      '--control',
      'holdemPremiumAggression=false',
      '--out-dir',
      out
    );
    expect(r.status, r.err).toBe(0);
    const fx = JSON.parse(readFileSync(join(out, 'qq-cli-check.fixture.json'), 'utf8'));
    expect(JSON.stringify(fx)).not.toMatch(/userId|"u\d"/);
    expect(fx.forbidden).toEqual([
      { ord: 9, kind: 'raise' },
      { ord: 12, kind: 'fold' },
    ]);
    expect(fx.control).toEqual({ holdemPremiumAggression: false });
    const law = readFileSync(join(out, 'qq-cli-check.law.test.ts'), 'utf8');
    expect(law).not.toMatch(/__[A-Z]+__/);
    expect(law).toContain("import FIXTURE from './qq-cli-check.fixture.json';");
    expect(law).toContain('raise at decision 9, then fold at decision 12');
    expect(law).toContain('QQ’s 4-bet then fold');
    expect(law).not.toContain('folded */');
    // A law written outside server/src is not registered in docs/laws.d/.
    expect(r.out).not.toContain('laws.d');
    // A second emit never overwrites an existing law.
    expect(
      cli('--emit-law', 'qq-cli-check', '--forbid', '9:raise', '--title', 't', '--out-dir', out)
        .status
    ).not.toBe(0);
    expect(
      cli('--emit-law', 'Bad Slug', '--forbid', '9:raise', '--title', 't', '--out-dir', out).status
    ).not.toBe(0);
    expect(existsSync(join(out, 'bad-slug.law.test.ts'))).toBe(false);
  }, 60_000);
});
