import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHeroCardRerequest,
  heroCardHoldAllowed,
  heroCardsAlreadyDealtFor,
  heroIsBlindInLiveHand,
  previousHeroRow,
  HERO_CARD_REREQUEST_WAITS_MS,
} from '../src/lib/heroCardCustody';
import { earlyHeroCardsReady } from '../src/utils/earlyHeroCards';
import {
  heroCardsCollideWithBoard,
  heroHoleCardsAreForThisHand,
} from '../src/lib/tableCardDisplay';

/* Mongo, 2026-11-09, Lightning NLH hand 58167350: "Had a hand where I never saw
   my cards. Waited till the time bank showed up and never saw them."

   lightning_hand_player for that session: button (seat 6) in hand 58167227,
   which he won, then small blind (seat 1) in 58167350, folded by the clock 31
   seconds after it formed. The rules below are the three custody decisions
   that could each leave a dealt-in hero holding nothing. */

const HERO = 'd55730d2-da5a-45fc-8478-82e49f97cd7e';
const cards = [
  { rank: 'A', suit: 's' },
  { rank: 'K', suit: 's' },
];

describe('the hero is found by identity, not by seat', () => {
  // Hand 58167227: hero on seat 6 (index 5), holding the cards just delivered.
  const prev = [null, null, null, null, null, { id: HERO, isHero: true, holeCards: cards }];

  it('reproduces the defect: the old seat-index read finds nobody at the new seat', () => {
    // Hand 58167350 seats the hero on seat 1 (index 0).
    expect(prev[0]).toBeNull();
  });

  it('finds the hero row at its previous seat when the seat changed', () => {
    expect(previousHeroRow(prev, 0, HERO)?.holeCards).toBe(cards);
  });

  it('prefers the same index at a physical table', () => {
    const same = { id: HERO, isHero: true, holeCards: cards };
    expect(previousHeroRow([same, null], 0, HERO)).toBe(same);
  });

  it('never returns another player, and never guesses without an id', () => {
    const other = [{ id: 'someone-else', isHero: false, holeCards: cards }];
    expect(previousHeroRow(other, 0, HERO)).toBeNull();
    expect(previousHeroRow(prev, 0, '')).toBeNull();
    expect(previousHeroRow(prev, 0, undefined)).toBeNull();
    expect(previousHeroRow(null, 0, HERO)).toBeNull();
  });
});

describe('cards delivered for the incoming hand are held across its first snapshot', () => {
  it('keeps the existing rule: same hand or an unknown hand holds', () => {
    expect(heroCardHoldAllowed({ nextHand: 7, prevHand: 7, heldCardsHand: 0 })).toBe(true);
    expect(heroCardHoldAllowed({ nextHand: 0, prevHand: 7, heldCardsHand: 0 })).toBe(true);
    expect(heroCardHoldAllowed({ nextHand: 7, prevHand: 0, heldCardsHand: 0 })).toBe(true);
  });

  it('holds cards stamped with the incoming hand while the felt was a hand behind', () => {
    expect(
      heroCardHoldAllowed({ nextHand: 58167350, prevHand: 58167227, heldCardsHand: 58167350 })
    ).toBe(true);
  });

  it('still drops the previous hand at the boundary', () => {
    expect(
      heroCardHoldAllowed({ nextHand: 58167350, prevHand: 58167227, heldCardsHand: 58167227 })
    ).toBe(false);
    expect(heroCardHoldAllowed({ nextHand: 58167350, prevHand: 58167227, heldCardsHand: 0 })).toBe(
      false
    );
  });
});

describe('HAND_STARTED does not clear cards already delivered for that hand', () => {
  it('reproduces the defect: with the deal cue silent, only the cards stamp knows', () => {
    // A muted table never writes the cue hand. The old test read it alone.
    const dealCueHand = 58167227;
    expect(dealCueHand === 58167350).toBe(false);
    expect(
      heroCardsAlreadyDealtFor({ startedHand: 58167350, heldCardsHand: 58167350, dealCueHand })
    ).toBe(true);
  });

  it('accepts the deal cue as a witness as before', () => {
    expect(heroCardsAlreadyDealtFor({ startedHand: 9, heldCardsHand: 0, dealCueHand: 9 })).toBe(
      true
    );
  });

  it('clears a holding from any other hand, and when the hand is unknown', () => {
    expect(heroCardsAlreadyDealtFor({ startedHand: 9, heldCardsHand: 8, dealCueHand: 8 })).toBe(
      false
    );
    expect(heroCardsAlreadyDealtFor({ startedHand: 0, heldCardsHand: 0, dealCueHand: 0 })).toBe(
      false
    );
  });
});

describe('a blind hero in a live hand is the only one who asks again', () => {
  it('is blind when dealt in and holding nothing', () => {
    expect(
      heroIsBlindInLiveHand({
        hero: { id: HERO, isHero: true, status: 'active' },
        isHandInProgress: true,
      })
    ).toBe(true);
    expect(
      heroIsBlindInLiveHand({
        hero: { id: HERO, isHero: true, status: 'active', holeCards: [] },
        isHandInProgress: true,
      })
    ).toBe(true);
  });

  it('is not blind when holding cards, out of the hand, or between hands', () => {
    const base = { id: HERO, isHero: true };
    expect(
      heroIsBlindInLiveHand({ hero: { ...base, holeCards: cards }, isHandInProgress: true })
    ).toBe(false);
    for (const status of ['sitting_out', 'away', 'folded']) {
      expect(heroIsBlindInLiveHand({ hero: { ...base, status }, isHandInProgress: true })).toBe(
        false
      );
    }
    expect(heroIsBlindInLiveHand({ hero: base, isHandInProgress: false })).toBe(false);
    expect(heroIsBlindInLiveHand({ hero: null, isHandInProgress: true })).toBe(false);
  });

  it('a player who has left is never blind, whatever the roster still says', () => {
    expect(
      heroIsBlindInLiveHand({
        hero: { id: HERO, isHero: true, status: 'active' },
        isHandInProgress: true,
        leaving: true,
      })
    ).toBe(false);
  });
});

describe('TablePage keeps the hero cards by these rules and no others', () => {
  const page = readFileSync('src/pages/TablePage.tsx', 'utf8');
  const engineServer = readFileSync('server/src/index.ts', 'utf8');

  it('the snapshot hold never reads the hero by seat index again', () => {
    expect(page).not.toMatch(/const prevHero = prev\.players\[i\]/);
    expect(page).toMatch(/const prevHero = previousHeroRow\(prev\.players, i, sp\.id\)/);
    expect(page).toMatch(/const cardHoldSameHand = heroCardHoldAllowed\(\{/);
  });

  it('every accepted delivery stamps its hand before any sound decision', () => {
    const stamp = page.indexOf('heroCardsHandRef.current = dealtHandNumber;');
    const cue = page.indexOf('lightningHoldsHeroDealSound({');
    expect(stamp).toBeGreaterThan(0);
    expect(cue).toBeGreaterThan(stamp);
    // One stamping writer (the guarded private-frame door) and one reset.
    expect(page.split('heroCardsHandRef.current = dealtHandNumber;').length - 1).toBe(1);
    expect(page.split('heroCardsHandRef.current =').length - 1).toBe(2);
  });

  it('HAND_STARTED asks the cards stamp, not the deal cue alone', () => {
    expect(page).not.toMatch(
      /startedHandNumber > 0 && heroDealSoundHandRef\.current === startedHandNumber/
    );
    expect(page).toMatch(/const heroCardsAlreadyDealtForThisHand = heroCardsAlreadyDealtFor\(\{/);
  });

  it('a Lightning room owns a recovery, and it is the bounded engine resync', () => {
    const at = page.indexOf("'TablePage.lightning_hole_cards_rerequested'");
    expect(at).toBeGreaterThan(0);
    const effect = page.slice(
      page.lastIndexOf('useEffect(() => {', at),
      page.indexOf('\n  }, [', at) + 120
    );
    expect(effect).toMatch(/!lightningRoomActive \|\| lightningObserver/);
    expect(effect).toMatch(/createHeroCardRerequest\(\{/);
    expect(effect).toMatch(/pl\?\.isHero && pl\.id === userId/);
    expect(effect).toMatch(/leaving: leftSeatPendingRef\.current/);
    expect(effect).toMatch(/requestEngineSnapshot\(\);/);
    expect(effect).toMatch(/heroCardFetchRef\.current = rerequest\.arm;/);
    expect(effect).toMatch(/rerequest\.dispose\(\);/);
    expect(effect).toMatch(/lightningRoomActive, lightningObserver, requestEngineSnapshot\]/);
    // No timer of its own, and never a wallet, seat or action call.
    expect(effect).not.toMatch(/setInterval|setTimeout|supabase\.|sendAction|submitAction|rpc\(/);
  });

  it('the delivery door drops everything for a player who has left', () => {
    const door = page.indexOf('const handleHoleCardPayload = useCallback(');
    const guard = page.indexOf('if (leftSeatPendingRef.current) {', door);
    const firstRead = page.indexOf('const row = payload.new;', door);
    expect(guard).toBeGreaterThan(door);
    expect(guard).toBeLessThan(firstRead);
    expect(page.slice(firstRead, firstRead + 200)).toMatch(/row\.user_id === userId/);
  });

  it('the hand stamp is cleared with the table and the player', () => {
    expect(page).toMatch(
      /earlyHeroCardsRef\.current = null;\s+\/\/ The stamp belongs to one player at one table\.\s+heroCardsHandRef\.current = 0;\s+\}, \[tableId, userId\]\);/
    );
  });

  it('the engine answers that resync with the Lightning hero cards', () => {
    expect(engineServer).toMatch(
      /onResync: \(tableId, userId\) => \{[\s\S]{0,400}lightningRooms\.rePushHoleCards\(tableId, userId\)/
    );
  });
});

/* The real snapshot merge, lifted out of TablePage and run: the same harness
   tests/unit/expiredSeatClears.test.ts uses, so these are the page's own
   lines and not a copy of them. */
describe('the page snapshot merge, executed', () => {
  const source = readFileSync('src/pages/TablePage.tsx', 'utf8');
  const ast = ts.createSourceFile(
    'TablePage.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let fn: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'nextPlayers') {
      fn = (node.initializer as ts.CallExpression).arguments[0];
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!fn) throw new Error('Missing real snapshot merge callback');
  const code =
    ts.transpile('const run = ' + fn.getText(ast), { target: ts.ScriptTarget.ES2022 }) +
    '\nreturn run;';

  function merge(input: {
    prevPlayers: unknown[];
    prevHand: number;
    nextHand: number;
    heldCardsHand: number;
    board?: unknown[];
    leaving?: boolean;
  }) {
    const scoped: Record<string, unknown> = {
      lightningObserver: false,
      leftSeatPendingRef: { current: input.leaving === true },
      userId: HERO,
      prev: { players: input.prevPlayers, handNumber: input.prevHand },
      mapped: {
        handNumber: input.nextHand,
        communityCards: input.board ?? [],
        communityCards2: [],
        communityCards3: [],
      },
      cardHoldSameHand: heroCardHoldAllowed({
        nextHand: input.nextHand,
        prevHand: input.prevHand,
        heldCardsHand: input.heldCardsHand,
      }),
      cardHoldOpponentSameHand: input.nextHand > 0 && input.nextHand === input.prevHand,
      previousHeroRow,
      heroCardsCollideWithBoard,
      heroEngineCardOrderRef: { current: null },
      cardsPreSortRef: { current: false },
      heroDisplayHoleCards: (c: unknown) => c,
    };
    return new Function(...Object.keys(scoped), code)(...Object.values(scoped)) as (
      p: unknown,
      i: number
    ) => { holeCards?: unknown[] } | null;
  }

  const heroAt = (extra: Record<string, unknown> = {}) => ({
    id: HERO,
    isHero: true,
    status: 'active',
    ...extra,
  });
  const seatSix = (holeCards: unknown[]) => [null, null, null, null, null, heroAt({ holeCards })];

  it('MONGO: cards on seat 6 are still held when the next snapshot seats the hero on seat 1', () => {
    // HAND_STARTED 58167350 arrived first and the cards were written onto the
    // row the hero still occupied; the snapshot then moved the hero.
    const run = merge({
      prevPlayers: seatSix(cards),
      prevHand: 58167350,
      nextHand: 58167350,
      heldCardsHand: 58167350,
    });
    expect(run(heroAt(), 0)?.holeCards).toBe(cards);
  });

  it('cards delivered before the felt left the previous hand survive the first snapshot', () => {
    // No HAND_STARTED yet: the felt is still on 58167227, the stamp is not.
    const run = merge({
      prevPlayers: seatSix(cards),
      prevHand: 58167227,
      nextHand: 58167350,
      heldCardsHand: 58167350,
    });
    expect(run(heroAt(), 0)?.holeCards).toBe(cards);
  });

  it('the previous hand is never carried into the next one, at any seat', () => {
    for (const index of [0, 5]) {
      const run = merge({
        prevPlayers: seatSix(cards),
        prevHand: 58167227,
        nextHand: 58167350,
        heldCardsHand: 58167227,
      });
      expect(run(heroAt(), index)?.holeCards ?? []).toHaveLength(0);
    }
  });

  it('another player is never handed the hero cards, and the hero never theirs', () => {
    const villain = { id: 'villain', isHero: false, status: 'active', holeCards: cards };
    const run = merge({
      prevPlayers: [villain, null, null, null, null, heroAt({ holeCards: [] })],
      prevHand: 7,
      nextHand: 7,
      heldCardsHand: 7,
    });
    expect(run(heroAt(), 0)?.holeCards ?? []).toHaveLength(0);
    const run2 = merge({ prevPlayers: seatSix(cards), prevHand: 7, nextHand: 7, heldCardsHand: 7 });
    const other = { id: 'villain', isHero: false, status: 'active' } as { holeCards?: unknown[] };
    expect(run2(other, 0)?.holeCards ?? []).toHaveLength(0);
  });

  it('a held hand that the new board disproves is dropped', () => {
    const run = merge({
      prevPlayers: seatSix(cards),
      prevHand: 7,
      nextHand: 7,
      heldCardsHand: 7,
      board: [{ rank: 'A', suit: 's' }],
    });
    expect(run(heroAt(), 0)?.holeCards ?? []).toHaveLength(0);
  });

  it('a player who has left has no row and so no cards', () => {
    const run = merge({
      prevPlayers: seatSix(cards),
      prevHand: 7,
      nextHand: 7,
      heldCardsHand: 7,
      leaving: true,
    });
    expect(run(heroAt(), 0)).toBeNull();
  });
});

describe('a late answer is judged by the door, not trusted', () => {
  const ROOM = '8eb84c0c-225b-4239-902c-7c84f7607fd7';
  it('an answer for the previous hand is refused once the next hand is live', () => {
    expect(
      heroHoleCardsAreForThisHand({
        rowTableId: ROOM,
        tableId: ROOM,
        rowHandNumber: 58167227,
        currentHandNumber: 58167350,
        cards,
        boards: [[], [], []],
      })
    ).toEqual({ ok: false, reason: 'stale-hand' });
  });
  it('an answer for another room is refused', () => {
    expect(
      heroHoleCardsAreForThisHand({
        rowTableId: '0f84a1ab-5abb-41b4-a8bd-a33af58f73ea',
        tableId: ROOM,
        rowHandNumber: 58167350,
        currentHandNumber: 58167350,
        cards,
        boards: [[], [], []],
      })
    ).toEqual({ ok: false, reason: 'wrong-table' });
  });
});

describe('the re-request is bounded, single and ends on its own', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function rig(start: { hand: number; blind: boolean }) {
    const state = { ...start };
    const ask = vi.fn();
    const onExhausted = vi.fn();
    const r = createHeroCardRerequest({
      currentHand: () => state.hand,
      isBlind: () => state.blind,
      ask,
      onExhausted,
    });
    return { state, ask, onExhausted, r };
  }
  const total = HERO_CARD_REREQUEST_WAITS_MS.reduce((a, b) => a + b, 0);

  it('asks at 0.6 s, 1.2 s, 2 s, 5 s and 10 s, then never again', () => {
    const { ask, onExhausted, r } = rig({ hand: 9, blind: true });
    r.arm();
    const at: number[] = [];
    ask.mockImplementation(() => at.push(Date.now()));
    const t0 = Date.now();
    vi.advanceTimersByTime(60_000);
    expect(at.map((t) => t - t0)).toEqual([600, 1200, 2000, 5000, 10000]);
    expect(total).toBe(10000);
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('DROPPED DELIVERY: a blind hero asks; the ask stops the moment cards arrive', () => {
    const { state, ask, onExhausted, r } = rig({ hand: 9, blind: true });
    r.arm();
    vi.advanceTimersByTime(600);
    expect(ask).toHaveBeenCalledTimes(1);
    state.blind = false; // the re-sent cards landed
    vi.advanceTimersByTime(60_000);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(onExhausted).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a hero who was dealt normally never asks', () => {
    const { ask, r } = rig({ hand: 9, blind: false });
    r.arm();
    vi.advanceTimersByTime(60_000);
    expect(ask).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops when the hand changes, and the old hand never asks again', () => {
    const { state, ask, r } = rig({ hand: 9, blind: true });
    r.arm();
    vi.advanceTimersByTime(600);
    state.hand = 10;
    vi.advanceTimersByTime(60_000);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenLastCalledWith(9, 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a new hand gets its own budget and drops the old watch', () => {
    const { state, ask, r } = rig({ hand: 9, blind: true });
    r.arm();
    vi.advanceTimersByTime(1200);
    state.hand = 10;
    r.arm();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(ask.mock.calls.filter((c) => c[0] === 9)).toHaveLength(2);
    expect(ask.mock.calls.filter((c) => c[0] === 10)).toHaveLength(5);
  });

  it('stops when the player leaves (no longer blind by definition)', () => {
    const left = { current: false };
    const ask = vi.fn();
    const r = createHeroCardRerequest({
      currentHand: () => 9,
      isBlind: () =>
        heroIsBlindInLiveHand({
          hero: { id: HERO, isHero: true, status: 'active' },
          isHandInProgress: true,
          leaving: left.current,
        }),
      ask,
    });
    r.arm();
    vi.advanceTimersByTime(600);
    left.current = true;
    vi.advanceTimersByTime(60_000);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('stops on unmount, and a disposed watch cannot be re-armed', () => {
    const { ask, r } = rig({ hand: 9, blind: true });
    r.arm();
    r.dispose();
    r.arm();
    vi.advanceTimersByTime(60_000);
    expect(ask).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('RECONNECTS: arming again and again never adds a timer or an ask', () => {
    const { ask, r } = rig({ hand: 9, blind: true });
    for (let i = 0; i < 50; i += 1) r.arm();
    expect(vi.getTimerCount()).toBe(1);
    for (let ms = 0; ms < 60_000; ms += 100) {
      vi.advanceTimersByTime(100);
      r.arm(); // HAND_STARTED, a refused push, a socket return, the hand effect
      expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
    }
    expect(ask).toHaveBeenCalledTimes(HERO_CARD_REREQUEST_WAITS_MS.length);
  });

  it('cards lost again in the same hand resume the same budget, not a new one', () => {
    const { state, ask, r } = rig({ hand: 9, blind: true });
    r.arm();
    vi.advanceTimersByTime(1200); // two asks
    state.blind = false;
    vi.advanceTimersByTime(5000); // watch ended
    state.blind = true;
    r.arm();
    vi.advanceTimersByTime(60_000);
    expect(ask).toHaveBeenCalledTimes(HERO_CARD_REREQUEST_WAITS_MS.length);
  });

  it('does nothing while the hand is unknown', () => {
    const { ask, r } = rig({ hand: 0, blind: true });
    r.arm();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('muted audio and reordered events', () => {
  // HAND_STARTED's keep decision, for each order the two frames can arrive in.
  const N = 58167350;
  it('cards first, HAND_STARTED second, table muted: kept', () => {
    // Muted: the deal cue hand is never written (still the previous hand).
    expect(heroCardsAlreadyDealtFor({ startedHand: N, heldCardsHand: N, dealCueHand: 0 })).toBe(
      true
    );
  });
  it('HAND_STARTED first, cards second: nothing to keep, the previous holding is cleared', () => {
    expect(
      heroCardsAlreadyDealtFor({ startedHand: N, heldCardsHand: 58167227, dealCueHand: 58167227 })
    ).toBe(false);
  });
  it('a replayed HAND_STARTED for the live hand does not clear the live holding', () => {
    expect(heroCardsAlreadyDealtFor({ startedHand: N, heldCardsHand: N, dealCueHand: N })).toBe(
      true
    );
  });
});

/* The page's own delivery door, replay effect and HAND_STARTED reset, lifted
   out and run in the orders the transport can produce. Sound is OFF in every
   case (`soundService.isEnabled() === false`, `ambientSoundsAllowed === false`,
   no held Lightning cue), which is the muted table. */
describe('the page delivery door and hand-start reset, executed', () => {
  const ast = ts.createSourceFile(
    'TablePage.tsx',
    readFileSync('src/pages/TablePage.tsx', 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let handler = '';
  let replay = '';
  let reset: ts.ArrowFunction | undefined;
  const inHandStarted = (node: ts.Node): boolean => {
    for (let parent = node.parent; parent; parent = parent.parent)
      if (ts.isCaseClause(parent) && ts.isStringLiteral(parent.expression))
        return parent.expression.text === 'HAND_STARTED';
    return false;
  };
  const walk = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(ast) === 'handleHoleCardPayload' &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    )
      handler = node.initializer.arguments[0].getText(ast);
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === 'useEffect' &&
      node.arguments[0]?.getText(ast).includes('const decision = earlyHeroCardsReady')
    )
      replay = node.arguments[0].getText(ast);
    if (
      ts.isArrowFunction(node) &&
      inHandStarted(node) &&
      ts.isBlock(node.body) &&
      node.body.statements.some((st) => st.getText(ast).startsWith('const unfolded'))
    )
      reset = node;
    ts.forEachChild(node, walk);
  };
  walk(ast);
  if (!handler || !replay || !reset) throw new Error('Actual card pipeline not found');
  const compile = (text: string, deps: Record<string, unknown>) =>
    new Function(
      ...Object.keys(deps),
      ts.transpileModule(`const callback = ${text};`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText + '\nreturn callback;'
    )(...Object.values(deps));
  const resetPlayer = new Function(
    'p',
    'userId',
    'heroCardsAlreadyDealtForThisHand',
    ts.transpileModule(
      (reset.body as ts.Block).statements.map((st) => st.getText(ast)).join('\n'),
      { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
    ).outputText
  );

  const ROOM = '8eb84c0c-225b-4239-902c-7c84f7607fd7';
  const PREV = 58167227;
  const NEXT = 58167350;
  const prevCards = [
    { rank: '7', suit: 'd' },
    { rank: '2', suit: 'c' },
  ];

  function table() {
    // Hand 58167227 on the felt: hero on seat 6 holding that hand.
    const state: any = {
      handNumber: PREV,
      isHandInProgress: true,
      communityCards: [],
      players: [null, null, null, null, null, { id: HERO, isHero: true, holeCards: prevCards }],
    };
    const d: any = {
      userId: HERO,
      tableId: ROOM,
      engineSnapshotRef: { current: null },
      isLightningObserverSnapshot: () => false,
      tableStateRef: { current: state },
      tableState: state,
      heroHandRef: { current: PREV },
      leftSeatPendingRef: { current: false },
      heroCardsHandRef: { current: PREV },
      lightningRoomRef: { current: { id: ROOM } },
      earlyHeroCardsRef: { current: null },
      heroHoleCardsAreForThisHand,
      reportError: vi.fn(),
      heroCardsRecoveredRef: { current: false },
      heroCardFetchRef: { current: vi.fn() },
      // MUTED: no cue is ever owed, so the cue hand stays on the previous hand.
      heroDealSoundHandRef: { current: PREV },
      lastDealPresentationHandRef: { current: 0 },
      dealSettledHandRef: { current: 0 },
      heldHeroDealSoundRef: { current: 0 },
      lightningHoldsHeroDealSound: () => false,
      soundService: { isEnabled: () => false, playDeal: vi.fn() },
      ambientSoundsAllowed: false,
      canonicalCards: (c: unknown) => c,
      cardsPreSortRef: { current: false },
      heroEngineCardOrderRef: { current: [] },
      heroHandOutcomeRef: { current: {} },
      setTableState: (update: (s: unknown) => unknown) => Object.assign(state, update(state)),
    };
    d.handleHoleCardPayload = compile(handler, d);
    const deliver = (over: Record<string, unknown> = {}) =>
      d.handleHoleCardPayload({
        new: { table_id: ROOM, user_id: HERO, hand_number: NEXT, cards, ...over },
      });
    const handStarted = (hand: number) => {
      d.heroHandRef.current = hand;
      const keep = heroCardsAlreadyDealtFor({
        startedHand: hand,
        heldCardsHand: d.heroCardsHandRef.current,
        dealCueHand: d.heroDealSoundHandRef.current,
      });
      state.players = state.players.map((p: unknown) => (p ? resetPlayer(p, HERO, keep) : p));
      state.handNumber = hand;
      const early = d.earlyHeroCardsRef.current;
      if (early && early.hand === hand) {
        d.earlyHeroCardsRef.current = null;
        d.handleHoleCardPayload({ new: early.row });
      }
    };
    const replayEffect = () => compile(replay, { ...d, earlyHeroCardsReady })();
    const hero = () => state.players.find((p: any) => p?.id === HERO);
    return { state, d, deliver, handStarted, replayEffect, hero };
  }
  it('ORDER A, muted: cards, then HAND_STARTED - the new hand is on the hero row', () => {
    const t = table();
    t.deliver();
    // Kept aside: never painted onto the previous hand.
    expect(t.hero().holeCards).toBe(prevCards);
    expect(t.d.earlyHeroCardsRef.current?.hand).toBe(NEXT);
    t.handStarted(NEXT);
    expect(t.hero().holeCards).toEqual(cards);
    expect(t.d.heroCardsHandRef.current).toBe(NEXT);
    // The cue hand never moved: the table is muted.
    expect(t.d.heroDealSoundHandRef.current).toBe(PREV);
  });

  it('ORDER B, muted: cards, snapshot (replay), then HAND_STARTED - the cards survive it', () => {
    const t = table();
    t.deliver();
    // The snapshot for the next hand lands first: hero re-seated on seat 1.
    t.state.handNumber = NEXT;
    t.d.heroHandRef.current = NEXT;
    t.state.players = [{ id: HERO, isHero: true, holeCards: [] }, null, null, null, null, null];
    t.replayEffect();
    expect(t.hero().holeCards).toEqual(cards);
    // THE DEFECT: with the old cue-only test this reset cleared them.
    expect(NEXT === t.d.heroDealSoundHandRef.current).toBe(false);
    t.handStarted(NEXT);
    expect(t.hero().holeCards).toEqual(cards);
  });

  it('ORDER C: HAND_STARTED, then cards - the previous hand is cleared, the new one painted', () => {
    const t = table();
    t.handStarted(NEXT);
    expect(t.hero().holeCards).toEqual([]);
    t.deliver();
    expect(t.hero().holeCards).toEqual(cards);
  });

  it('a late answer for the previous hand is refused and never painted', () => {
    const t = table();
    t.handStarted(NEXT);
    t.deliver();
    t.deliver({ hand_number: PREV, cards: prevCards });
    expect(t.hero().holeCards).toEqual(cards);
    expect(t.d.heroCardsHandRef.current).toBe(NEXT);
    expect(t.d.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      'TablePage.hole_card_push_refused',
      expect.objectContaining({ reason: 'stale-hand' })
    );
  });

  it("another player's delivery, or another room's, never reaches the hero", () => {
    const t = table();
    t.handStarted(NEXT);
    t.deliver({ user_id: 'someone-else' });
    t.deliver({ table_id: '0f84a1ab-5abb-41b4-a8bd-a33af58f73ea' });
    expect(t.hero().holeCards).toEqual([]);
    expect(t.d.heroCardsHandRef.current).toBe(PREV);
  });

  it('after leaving, nothing is painted, stamped or kept for later', () => {
    const t = table();
    t.d.leftSeatPendingRef.current = true;
    t.deliver();
    t.handStarted(NEXT);
    t.deliver();
    expect(t.hero().holeCards).toEqual([]);
    expect(t.d.earlyHeroCardsRef.current).toBeNull();
    expect(t.d.heroCardsHandRef.current).toBe(PREV);
  });
});
