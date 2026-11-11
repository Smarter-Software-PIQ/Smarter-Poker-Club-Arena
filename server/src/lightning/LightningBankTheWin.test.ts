import { afterEach, describe, expect, it } from 'vitest';
import {
  noteLightningHandForBankTheWin,
  onLightningBankTheWin,
  resetLightningBankTheWin,
  type LightningBankParticipant,
} from './LightningBankTheWin.js';
import { bankTheWinMultiple } from '../services/HorseBankTheWin.js';

const HORSE = 'horse-lightning-1';
const others = ['p2', 'p3', 'p4', 'p5', 'p6'];

function hand(role: string, before: number, after: number, session = 'ps-1') {
  const participants: LightningBankParticipant[] = [
    { playerId: HORSE, poolSessionId: session, isHorse: true, blindRole: role, stackBefore: before },
    ...others.map((id) => ({
      playerId: id,
      poolSessionId: `ps-${id}`,
      isHorse: false,
      blindRole: 'none',
      stackBefore: 100,
    })),
  ];
  return noteLightningHandForBankTheWin({
    clusterId: 'c1',
    maxBuyIn: 100,
    participants,
    stacksAfter: new Map([[HORSE, after], ...others.map((id) => [id, 100] as [string, number])]),
  });
}

afterEach(() => resetLightningBankTheWin());

describe('BANK THE WIN ON LIGHTNING (owner 2026-11-10)', () => {
  it('books at the line, one orbit after the big pot, right before its big blind', () => {
    const line = bankTheWinMultiple(HORSE) * 100;
    const asked: string[] = [];
    onLightningBankTheWin(({ playerId }) => asked.push(playerId));
    expect(hand('none', 100, 100)).toEqual([]); // session opens at 100
    expect(hand('none', line - 50, line + 10)).toEqual([]); // a big pot: never the next hand
    for (let i = 0; i < 3; i++) expect(hand('none', line + 10, line + 10)).toEqual([]);
    expect(hand('bb', line + 10, line + 9)).toEqual([]); // posts a big blind inside the orbit
    for (let i = 0; i < 4; i++) expect(hand('none', line + 9, line + 9)).toEqual([]);
    // Orbit served (6 dealt), five hands since its big blind: due next. It goes now.
    expect(hand('none', line + 9, line + 9)).toEqual([HORSE]);
    expect(asked).toEqual([HORSE]);
    expect(hand('none', line + 9, line + 9)).toEqual([]); // once per session
  });

  it('measures from at most the maximum buy-in, so a carried stack cannot outrun its line', () => {
    const asked: string[] = [];
    onLightningBankTheWin(({ playerId }) => asked.push(playerId));
    for (let i = 0; i < 12; i++) hand(i === 0 ? 'bb' : 'none', 1391.85, 1391.85, 'ps-carried');
    expect(asked).toEqual([HORSE]);
  });

  it('a refused leave asks again on a later hand', () => {
    let release: (() => void) | null = null;
    let asks = 0;
    onLightningBankTheWin((r) => {
      asks += 1;
      release = r.release;
    });
    for (let i = 0; i < 6; i++) hand('none', 700, 700, 'ps-r');
    expect(asks).toBe(1);
    release!();
    hand('none', 700, 700, 'ps-r');
    expect(asks).toBe(2);
  });

  it('a human is never asked', () => {
    const asked: string[] = [];
    onLightningBankTheWin(({ playerId }) => asked.push(playerId));
    for (let i = 0; i < 12; i++) hand('none', 900, 900);
    expect(asked.every((id) => id === HORSE)).toBe(true);
  });
});
