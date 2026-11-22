/**
 * Lane DRAWS x omahaMathCore law tests (2026-11-19, owner 8:17 PM Chicago:
 * raise and take charge with combo draws). Constructed spots only; no recorded
 * hole cards. Each law reads the core's own receipt: the choice is the largest
 * EV, so these laws pin what the EV must say in the named spots.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setWiredValueForTests } from './OmahaMathCoreWire.js';
import { parseCardString } from './OmahaMathCoreEval.js';
import { decideOmahaMathCore, type CoreState } from './OmahaMathCore.js';

const now = () => performance.now();

function spot(
  input: Omit<Partial<CoreState>, 'hole' | 'board'> & {
    hole: string;
    board: string;
    oppStack?: number;
    oppPerson?: boolean;
  }
): CoreState {
  const { hole, board, oppStack, oppPerson, ...p } = input;
  const toCall = p.toCall ?? 0;
  const pot = p.pot ?? 100;
  return {
    variant: hole.length === 10 ? 'plo5' : 'plo4',
    chipUnit: 0.01,
    mode: 'table',
    street: p.street ?? 'flop',
    pot,
    toCall,
    heroBet: 0,
    heroStack: p.heroStack ?? 1000,
    currentBet: toCall,
    minRaiseTo: toCall > 0 ? toCall * 2 : 2,
    maxRaiseTo: toCall > 0 ? toCall + pot + toCall : pot,
    bigBlind: 2,
    legal: toCall > 0 ? ['fold', 'call', 'raise', 'all_in'] : ['check', 'bet', 'all_in'],
    heroSeat: 5,
    heroPosition: 'BTN',
    ip: true,
    opponents: [
      {
        seat: 2,
        user: 'u2',
        person: oppPerson ?? true,
        stack: oppStack ?? 1000,
        bet: toCall,
        folded: false,
        allIn: false,
        streetAction: toCall > 0 ? 'wager' : 'check',
        calledPrevStreet: false,
        prevAggressor: false,
        position: 'BB',
        preflopLevel: 'call',
      },
    ],
    aggressorSeat: toCall > 0 ? 2 : null,
    line: toCall > 0 ? 'stab' : null,
    band: toCall > 0 ? 'pot' : null,
    wagerFrac: toCall > 0 ? toCall / (pot - toCall) : 0,
    heroWagerLine: toCall > 0 ? 'raise' : 'stab',
    preflopRaises: 0,
    rake: { percent: 5, cap: 6, noFlopNoDrop: true },
    seed: `${hole}|${board}|${pot}|${toCall}`,
    ...p,
    hole: parseCardString(hole),
    board: parseCardString(board),
  } as CoreState;
}
const ev = (r: ReturnType<typeof decideOmahaMathCore>['receipt'], a: string) =>
  Math.max(-Infinity, ...r.evs.filter((e) => e.action === a).map((e) => e.ev));
const aggressive = (a: string) => a === 'bet' || a === 'raise' || a === 'all_in';

describe('DRAWS laws inside the core', () => {
  // lane COREWIRE: the DRAWS term lives on the core's one-step path only (planValue off); with
  // planValue on, VALUE's multi-street pricing replaces it (no double count, DRAWS.md section 7)
  beforeAll(() => setWiredValueForTests(false));
  afterAll(() => setWiredValueForTests(true));
  it('every flop/turn PLO4/PLO5 receipt carries the exact draw profile and per-action later-street term', () => {
    const { receipt } = decideOmahaMathCore(spot({ hole: '9h8h7cKd', board: '9c6h2h', pot: 100 }), {
      now,
    });
    expect(receipt.draw?.cls).toBe('pair+FD+SD');
    expect(receipt.evs.every((e) => e.future === null || typeof e.future?.chips === 'number')).toBe(
      true
    );
  });

  it('pair + open-ender + flush draw, checked to in position: the aggressive line is taken whenever its EV is the largest, and it is', () => {
    const { receipt } = decideOmahaMathCore(spot({ hole: '9h8h7cKd', board: '9c6h2h', pot: 100 }), {
      now,
    });
    const bestWager = Math.max(ev(receipt, 'bet'), ev(receipt, 'all_in'));
    expect(bestWager).toBeGreaterThan(ev(receipt, 'check'));
    expect(aggressive(receipt.choice.action)).toBe(true);
  });

  it('nut wrap + nut flush draw facing a pot bet at SPR ~3 raises or gets it in (never folds, does not just call when raising is worth more)', () => {
    // pot 300 after a 100 bet into 100 + 100 dead; stacks 300 behind: SPR ~1-3
    const s = spot({
      hole: 'AhKhQsJd',
      board: 'Th9h2c',
      pot: 300,
      toCall: 100,
      heroStack: 600,
      oppStack: 500,
    });
    const { receipt } = decideOmahaMathCore(s, { now });
    expect(receipt.choice.action).not.toBe('fold');
    const raiseEv = Math.max(ev(receipt, 'raise'), ev(receipt, 'all_in'));
    expect(raiseEv).toBeGreaterThan(ev(receipt, 'call'));
    expect(['raise', 'all_in']).toContain(receipt.choice.action);
  });

  it('a dominated non-nut draw (non-nut flush draw + low gutshot) facing a pot bet at SPR ~2 does not stack off', () => {
    const s = spot({
      hole: 'Qh5h4cTd',
      board: '8h7s2h',
      pot: 300,
      toCall: 100,
      heroStack: 600,
      oppStack: 600,
    });
    const { receipt } = decideOmahaMathCore(s, { now });
    expect(receipt.choice.action).not.toBe('all_in');
    const nut = decideOmahaMathCore(
      spot({
        hole: 'AhKhQsJd',
        board: 'Th9h2c',
        pot: 300,
        toCall: 100,
        heroStack: 600,
        oppStack: 600,
      }),
      { now }
    ).receipt;
    expect(receipt.draw!.nutOuts).toBeLessThan(nut.draw!.nutOuts);
  });

  it('turn, the draw missed: a big nut draw continues against a pot bet; a bare gutshot is worth less and folds whenever its call is worth less than nothing', () => {
    const big = decideOmahaMathCore(
      spot({
        hole: 'AhKhQsJd',
        board: 'Th9h2c3s',
        street: 'turn',
        pot: 300,
        toCall: 100,
        heroStack: 1500,
        oppStack: 1500,
      }),
      { now }
    ).receipt;
    expect(big.choice.action).not.toBe('fold');
    const gut = decideOmahaMathCore(
      spot({
        hole: 'AcKd5s4s',
        board: 'QhJh7c2d',
        street: 'turn',
        pot: 300,
        toCall: 100,
        heroStack: 1500,
        oppStack: 1500,
      }),
      { now }
    ).receipt;
    expect(gut.draw!.outs).toBeLessThanOrEqual(4);
    expect(ev(gut, 'call')).toBeLessThan(ev(big, 'call'));
    if (ev(gut, 'call') < 0 && Math.max(ev(gut, 'raise'), ev(gut, 'all_in')) < 0)
      expect(gut.choice.action).toBe('fold');
    // the later-street term of a gutshot to a non-nut end is far smaller than the nut draw's
    const fBig = big.evs.find((e) => e.action === 'call')!.future!.chips;
    const fGut = gut.evs.find((e) => e.action === 'call')?.future?.chips ?? 0;
    expect(fGut).toBeLessThan(fBig);
  });

  it('all-ins carry no later-street term (no later street)', () => {
    const { receipt } = decideOmahaMathCore(
      spot({
        hole: 'AhKhQsJd',
        board: 'Th9h2c',
        pot: 300,
        toCall: 100,
        heroStack: 600,
        oppStack: 500,
      }),
      { now }
    );
    for (const e of receipt.evs) if (e.action === 'all_in') expect(e.future?.chips ?? 0).toBe(0);
  });

  it('PLO6 is not touched: the core does not run for six cards today, and the draw profile is null for six cards', async () => {
    const { omahaDrawFeatures } = await import('./OmahaDraws.js');
    expect(
      omahaDrawFeatures(parseCardString('AhKhQsJd2c3d'), parseCardString('Th9h4c'))
    ).toBeNull();
  });
});
