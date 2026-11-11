import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { scoreOmahaHiPartial, scoreOmahaLowPartial } from '../../server/src/engine/HorseEval';
import type { Card } from '../../server/src/types';
import { classifyChangedPaths } from '../../scripts/ci/classify-ci-changes.mjs';

describe('private Horse historical analysis independent references', () => {
  it('runs this wrapper when its Python inputs change without selecting engine jobs', () => {
    for (const path of [
      'horse-study-report.py',
      'horse_census_audit.py',
      'horse_census_statistics.py',
      'horse_study_subjects.py',
      'horse_fleet_acceptance.py',
      'test_horse_census.py',
      'test_horse_fleet_acceptance.py',
      'horse_river_appendix.py',
      'horse_river_opportunities.py',
      'horse_hand_analysis.py',
      'omaha_reference.py',
      'test_horse_river_appendix.py',
      'test_omaha_reference.py',
    ]) {
      const selected = classifyChangedPaths([`scripts/ops/${path}`]);
      expect(selected.tests, path).toBe(true);
      expect(selected.server, path).toBe(false);
      expect(selected.src, path).toBe(false);
    }
    expect(classifyChangedPaths(['scripts/ops/horse-river-appendix.md']).tests).toBe(false);
    const bridge = classifyChangedPaths(['scripts/ops/horse-river-terminal-prices.mjs']);
    expect(bridge.tests).toBe(true);
    expect(bridge.server).toBe(false);
  });
  it('runs the outcome isolation, domain and exact-card regression suite', () => {
    const result = spawnSync(
      'python3',
      ['-B', '-m', 'unittest', 'discover', '-s', 'scripts/ops', '-p', 'test_*.py'],
      { encoding: 'utf8', timeout: 30_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/Ran [1-9][0-9]* tests/);
  });

  it('agrees with the production Omaha high and low evaluators on physical deals', () => {
    const suits: Card['suit'][] = ['clubs', 'diamonds', 'hearts', 'spades'];
    const cases: Array<{ hero: Card[]; opponent: Card[]; board: Card[]; variant: string }> = [];
    for (const holes of [4, 5, 6]) {
      for (const boardCount of [3, 4, 5]) {
        for (let sample = 1; sample <= 16; sample++) {
          let state = holes * 10000 + boardCount * 1000 + sample;
          const deck: Card[] = suits.flatMap((suit) =>
            [...'23456789TJQKA'].map((rank) => ({ rank: rank as Card['rank'], suit }))
          );
          for (let i = deck.length - 1; i > 0; i--) {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            const j = state % (i + 1);
            [deck[i], deck[j]] = [deck[j], deck[i]];
          }
          cases.push({
            hero: deck.slice(0, holes),
            opponent: deck.slice(holes, holes * 2),
            board: deck.slice(holes * 2, holes * 2 + boardCount),
            variant: `plo${holes}`,
          });
        }
      }
    }
    const result = spawnSync(
      'python3',
      [
        '-B',
        '-c',
        "import json,sys;sys.path.insert(0,'scripts/ops');from omaha_reference import omaha,five,card;from itertools import combinations\n" +
          "out=[]\nfor c in json.load(sys.stdin):\n h=omaha(c['hero'],c['board'],c['variant'])[0];o=omaha(c['opponent'],c['board'],c['variant'])[0]\n" +
          " def low(holes):\n  scores=[five(tuple(sorted(map(card,(*a,*b)))))[1] for a in combinations(holes,2) for b in combinations(c['board'],3)]\n  return min((s for s in scores if s is not None),default=(99,))\n" +
          " l=low(c['hero']);ol=low(c['opponent']);out.append([(h>o)-(h<o),(l<ol)-(l>ol)])\nprint(json.dumps(out))",
      ],
      { input: JSON.stringify(cases), encoding: 'utf8', timeout: 30000 }
    );
    expect(result.status, result.stderr).toBe(0);
    const reference: number[][] = JSON.parse(result.stdout);
    expect(reference).toHaveLength(cases.length);
    cases.forEach((c, i) => {
      expect(
        Math.sign(scoreOmahaHiPartial(c.hero, c.board) - scoreOmahaHiPartial(c.opponent, c.board)),
        `high case ${i}`
      ).toBe(reference[i][0]);
      const a = scoreOmahaLowPartial(c.hero, c.board),
        b = scoreOmahaLowPartial(c.opponent, c.board);
      expect(a === b ? 0 : a < b ? 1 : -1, `low case ${i}`).toBe(reference[i][1]);
    });
  });
});
