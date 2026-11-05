/**
 * Phase 5.3: the complaint replay library (HorseComplaintReplay.ts). Uses the
 * first committed complaint fixture (the Phase 3 QQ hand) plus small
 * synthetic nodes. No database is read or written.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import {
  actionKind,
  classifySpot,
  complaintPathHits,
  horseNodes,
  parseBoard,
  parseExtract,
  recordedPathMatches,
  replayHand,
  replayProfiles,
  rowsFromResultText,
  stateAt,
  toComplaintFixture,
  wagerFaced,
  type ComplaintAction,
  type ComplaintFixture,
  type ComplaintPublicNode,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import FIXTURE from './horseComplaints/qq-big-blind-four-bet-then-fold-to-the-deeper-opener.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;

/** The committed fixture, turned back into the extract shape (user ids p<seat>). */
function asExtract(fx: ComplaintFixture): ExtractedHand {
  return {
    handId: fx.handId,
    tournamentId: fx.fmt === 'tour' ? 't' : null,
    variant: fx.variant,
    bigBlind: 0.5,
    smallBlind: 0.25,
    players: fx.players.map((p) => ({ seat: p.seat, userId: `p${p.seat}`, isHorse: p.isHorse })),
    horseHoleCards: Object.fromEntries(Object.entries(fx.hole).map(([s, c]) => [`p${s}`, c])),
    actions: fx.actions.map((a) => ({ ...a, userId: `p${a.seat}` })),
  };
}

describe('complaint replay library', () => {
  afterEach(() => HorseMind.reset());

  it('finds every recorded horse decision and rebuilds the exact state at it', () => {
    const nodes = horseNodes(FX);
    expect(nodes.map((n) => n.ord)).toEqual([9, 12]);
    const st = stateAt(FX, nodes[0]);
    expect(st.gs.pot).toBe(6.15);
    expect(st.gs.toCall).toBe(3.33);
    expect(st.gs.stage).toBe('preflop');
    expect(st.gs.actionHistory!).toHaveLength(8);
    expect(st.gs.actionHistory!.every((a) => (a as { stage: string }).stage === 'preflop')).toBe(
      true
    );
    expect(st.hero.seat).toBe(2);
    expect(st.hero.cards.map((c) => c.rank).join('')).toBe('QQ');
    expect(st.gs.players.find((p) => p.seat === 4)?.stack).toBe(93.45);
    expect(st.gs.players.find((p) => p.seat === 1)?.is_folded).toBe(true);
    const at12 = stateAt(FX, nodes[1]);
    expect(at12.gs.toCall).toBe(85.71);
    expect(at12.gs.players.find((p) => p.seat === 4)?.is_all_in).toBe(true);
  });

  it('reduces actions to kinds: an all-in raise is a jam, an all-in that cannot raise is a call', () => {
    const pn = { seats: [[2, 10, 0, 0, 0, 0, 0]], actorSeat: 2, currentBet: 20, toCall: 20 };
    expect(actionKind('all_in', 10, pn)).toBe('call');
    const deep = { ...pn, seats: [[2, 100, 0, 0, 0, 0, 0]] };
    expect(actionKind('all_in', 100, deep)).toBe('jam');
    expect(actionKind('raise', 60, deep)).toBe('raise');
    expect(actionKind('bet', 60, deep)).toBe('raise');
    expect(actionKind('fold', 0, deep)).toBe('fold');
    expect(actionKind('check', 0, deep)).toBe('check');
  });

  it('classifies the 4-bet and the 5-bet nodes into the 4-bet-then-fold cell', () => {
    const [n9, n12] = horseNodes(FX);
    const c9 = classifySpot(FX, n9);
    expect(c9.preflopRaises).toBe(2);
    expect(c9.cell).toMatchObject({ family: 'four_bet_fold', key: 'nlh|cash' });
    const c12 = classifySpot(FX, n12);
    expect(c12.preflopRaises).toBe(4); // open, 3-bet, the horse 4-bet, the 5-bet jam
    expect(c12.situation).toContain('after the horse 4-bet');
    expect(c12.cell?.family).toBe('four_bet_fold');
  });

  it('replays deterministically, live hybrid profile first, and records brain receipts', () => {
    const a = replayHand(FX, { seeds: [1, 7, 42] });
    const b = replayHand(FX, { seeds: [1, 7, 42] });
    expect(a.map((n) => n.profiles.map((p) => p.kinds))).toEqual(
      b.map((n) => n.profiles.map((p) => p.kinds))
    );
    expect(a[0].profiles[0]).toMatchObject({ profile: 'hybrid_cash_grinder', live: true });
    expect(a[0].profiles).toHaveLength(replayProfiles('cash').length);
    expect(Object.keys(a[0].profiles[0].receipts)).toContain('decide_nlh');
    for (const n of a) expect(n.verdict.length).toBeGreaterThan(0);
  });

  it('the forbidden path is checked per profile, and a path the hand never took is refused', () => {
    expect(recordedPathMatches(FX)).toBe(true);
    expect(complaintPathHits(FX)).toEqual([]);
    const ex = asExtract(FX);
    expect(() =>
      toComplaintFixture(ex, {
        slug: 's',
        title: 't',
        complaint: '',
        forbidden: [{ ord: 12, kind: 'call' }],
      })
    ).toThrow(/did not take that path/);
    expect(() =>
      toComplaintFixture(ex, {
        slug: 's',
        title: 't',
        complaint: '',
        forbidden: [{ ord: 5, kind: 'raise' }],
      })
    ).toThrow(/not a recorded horse decision/);
  });

  it('a fixture is anonymised: no user ids, only the cards of the horses on the path', () => {
    const fx = toComplaintFixture(
      {
        ...asExtract(FX),
        horseHoleCards: {
          ...asExtract(FX).horseHoleCards,
          p4: [
            { rank: 'A', suit: 'spades' },
            { rank: 'A', suit: 'hearts' },
          ],
        },
      },
      { slug: 's', title: 't', complaint: 'c', forbidden: FX.forbidden }
    );
    const text = JSON.stringify(fx);
    expect(text).not.toContain('userId');
    expect(Object.keys(fx.hole)).toEqual(['2']);
  });

  it('reads execute_sql results, raw or in the MCP wrapper, and refuses an empty extract', () => {
    const row = [{ hand: asExtract(FX) }];
    expect(parseExtract(rowsFromResultText(JSON.stringify(row))).handId).toBe(FX.handId);
    const wrapped = JSON.stringify({
      result: `Below is the result.\n\n<untrusted-data-abc>\n${JSON.stringify(row)}\n</untrusted-data-abc>\n\nUse this data.`,
    });
    expect(parseExtract(rowsFromResultText(wrapped)).actions).toHaveLength(FX.actions.length);
    expect(() => parseExtract([{ hand: null }])).toThrow();
  });

  it('rebuilds the wager faced and the pot before it when the bettor carries no snapshot', () => {
    const pn: ComplaintPublicNode = {
      pot: 16,
      mode: 'cash',
      seats: [
        [1, 90, 3, 8, 0, 0, 0],
        [2, 90, 3, 8, 0, 0, 0],
        [3, 90, 0, 5, 0, 0, 0],
      ],
      boards: ['Ks7d2cQh'],
      street: 'turn',
      toCall: 3,
      currentBet: 3,
      minRaiseTo: 6,
      maxRaiseTo: 95,
      legalActions: ['fold', 'call', 'raise'],
      dealerSeat: 3,
      chipUnit: 1,
      bigBlind: 1,
      smallBlind: 0.5,
      variant: 'nlh',
      actorSeat: 3,
    };
    const actions: ComplaintAction[] = [
      { ord: 1, seat: 1, stage: 'turn', action: 'bet', amount: 3 },
      { ord: 2, seat: 2, stage: 'turn', action: 'call', amount: 3 },
      {
        ord: 3,
        seat: 3,
        stage: 'turn',
        action: 'call',
        amount: 3,
        origin: 'horse_policy',
        publicNode: pn,
      },
    ];
    expect(wagerFaced({ actions }, actions[2])).toMatchObject({
      wager: 3,
      potBefore: 10,
      exact: false,
    });
    expect(
      parseBoard('Ks7d2cQh')
        .map((c) => c.rank + c.suit[0])
        .join(' ')
    ).toBe('Ks 7d 2c Qh');
    expect(() => parseBoard('Kx')).toThrow();
  });
});
