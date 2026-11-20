/**
 * ON THE RIVER AN EQUITY POP-UP SHOWS ONLY A SPLIT (Dan 2026-11-19)
 *
 * "on the river it should never display 0% equity and 100% equity... thats
 *  already appearent by the hands. those pop ups with equity are only for pre
 *  flop, on the flop and turn. and only if its a split pot on the river show
 *  the split %"
 *
 * The rule lives in one pure helper (src/lib/equityDisplayGate.ts) and every
 * equity render site goes through it.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  boardCardCounts,
  boardCardCountsFromKey,
  gateEquityDisplay,
  isRiverBoard,
} from '../src/lib/equityDisplayGate';
import { allInEquityBoardKey } from '../src/lib/allInEquityDisplay';
import { EquityBadgeLayer, type EquityBadge } from '../src/components/table/EquityBadgeLayer';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

type E = { id: string; pct: number };
const pct = (e: E) => e.pct;
const gate = (entries: E[], counts: number[]) =>
  gateEquityDisplay(entries, counts, pct).map((e) => `${e.id}:${e.pct}`);

const HU: E[] = [
  { id: 'a', pct: 100 },
  { id: 'b', pct: 0 },
];

describe('the gate', () => {
  it('preflop, flop and turn show every percentage, endpoints included', () => {
    const live: E[] = [
      { id: 'a', pct: 72.4 },
      { id: 'b', pct: 27.6 },
    ];
    for (const counts of [[], [3], [4], [4, 4], [5, 4]]) {
      expect(isRiverBoard(counts)).toBe(false);
      expect(gate(live, counts)).toEqual(['a:72.4', 'b:27.6']);
    }
    // A drawing-dead turn still shows (only the river is gated).
    expect(gate(HU, [4])).toEqual(['a:100', 'b:0']);
  });

  it('river 100% / 0% shows nothing', () => {
    expect(isRiverBoard([5])).toBe(true);
    expect(gate(HU, [5])).toEqual([]);
  });

  it('river 0% is never shown, even beside a split', () => {
    const twoTieOneLoses: E[] = [
      { id: 'a', pct: 50 },
      { id: 'b', pct: 50 },
      { id: 'c', pct: 0 },
    ];
    expect(gate(twoTieOneLoses, [5])).toEqual(['a:50', 'b:50']);
    expect(gate([{ id: 'c', pct: 0 }], [5])).toEqual([]);
  });

  it('river split 50/50 is shown', () => {
    expect(
      gate(
        [
          { id: 'a', pct: 50 },
          { id: 'b', pct: 50 },
        ],
        [5]
      )
    ).toEqual(['a:50', 'b:50']);
  });

  it('river three-way split is shown', () => {
    const third = 100 / 3;
    expect(
      gate(
        [
          { id: 'a', pct: third },
          { id: 'b', pct: third },
          { id: 'c', pct: third },
        ],
        [5]
      )
    ).toHaveLength(3);
  });

  it('a lone non-endpoint on the river is not a split', () => {
    expect(gate([{ id: 'a', pct: 50 }], [5])).toEqual([]);
  });

  it('multi-board: river only once every dealt board is complete', () => {
    expect(isRiverBoard([5, 5])).toBe(true);
    expect(gate(HU, [5, 5])).toEqual([]);
    expect(gate(HU, [5, 3])).toEqual(['a:100', 'b:0']);
  });

  it('board counts come from the same key the equities are stamped with', () => {
    const river = ['Ah', 'Kd', '7c', '2s', '9h'];
    const key = allInEquityBoardKey([river, [], ['Ah', 'Kd', '7c', '3s']]);
    expect(boardCardCountsFromKey(key)).toEqual([5, 4]);
    expect(boardCardCountsFromKey('')).toEqual([]);
    expect(boardCardCounts([river, [], null, undefined])).toEqual([5]);
  });
});

describe('the felt layer draws through the gate', () => {
  const badges = (a: number, b: number): EquityBadge[] => [
    { seatNumber: 1, equity: a, exact: true, order: ['above'] },
    { seatNumber: 2, equity: b, exact: true, order: ['above'] },
  ];
  const Felt = ({ list, counts }: { list: EquityBadge[]; counts: number[] }) => (
    <div>
      <div className="seat-wrapper" data-seat-wrapper="1" />
      <div className="seat-wrapper" data-seat-wrapper="2" />
      <EquityBadgeLayer badges={list} boardCardCounts={counts} />
    </div>
  );
  const labels = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('.equity-overlay')).map((n) => n.textContent);

  it('turn shows; river 100/0 renders no layer; river 50/50 shows the split', () => {
    expect(labels(render(<Felt list={badges(100, 0)} counts={[4]} />).container)).toEqual([
      '100%',
      '0%',
    ]);
    const river = render(<Felt list={badges(100, 0)} counts={[5]} />).container;
    expect(river.querySelector('.equity-layer')).toBeNull();
    expect(labels(render(<Felt list={badges(50, 50)} counts={[5]} />).container)).toEqual([
      '50%',
      '50%',
    ]);
  });
});

describe('source guard: every equity render site goes through the gate', () => {
  const LAYER = strip(read('src/components/table/EquityBadgeLayer.tsx'));
  const PAGE = strip(read('src/pages/TablePage.tsx'));
  const DETAIL = strip(read('src/components/handdetail/HandDetailView.tsx'));

  it('EquityBadgeLayer gates its badges before measuring or drawing and requires board counts', () => {
    expect(LAYER).toMatch(/import \{ gateEquityDisplay \} from '..\/..\/lib\/equityDisplayGate'/);
    expect(LAYER).toMatch(/boardCardCounts: readonly number\[\];/);
    expect(LAYER).not.toMatch(/boardCardCounts\?:/);
    const gated = LAYER.indexOf('gateEquityDisplay(offered, boardCardCounts');
    expect(gated).toBeGreaterThan(-1);
    expect(gated).toBeLessThan(LAYER.indexOf('const signature'));
  });

  it('TablePage feeds the layer the board the equities were computed on', () => {
    expect(PAGE).toMatch(
      /<EquityBadgeLayer\s+boardCardCounts=\{boardCardCountsFromKey\(displayedEquities\[0\]\?\.boardKey \?\? ''\)\}/
    );
  });

  it('the Run It Twice panel reads only gated equities', () => {
    const start = PAGE.indexOf('const ritPanelPlayers = useMemo(');
    const body = PAGE.slice(start, PAGE.indexOf('const ritPanelBoardCards', start));
    expect(body).toMatch(/gateEquityDisplay\(/);
    expect(body).toMatch(/shownEquities\.find\(/);
    expect(body).not.toMatch(/allInEquities\.find\(/);
  });

  it('the hand detail street equities pass through the gate', () => {
    expect(DETAIL).toMatch(/gateEquityDisplay\(r\.equities, boardCardCounts\(\[street\.board\]\)/);
  });

  it('no other source file renders an equity overlay or the layer', () => {
    const hits = execSync(
      `grep -rlE "equity-overlay|<EquityBadgeLayer|equityPct=|<StreetEquity" src --include=*.tsx`,
      { cwd: root, encoding: 'utf8' }
    )
      .trim()
      .split('\n')
      .sort();
    expect(hits).toEqual([
      'src/components/handdetail/HandDetailView.tsx',
      'src/components/table/EquityBadgeLayer.tsx',
      'src/pages/TablePage.tsx',
    ]);
  });
});
