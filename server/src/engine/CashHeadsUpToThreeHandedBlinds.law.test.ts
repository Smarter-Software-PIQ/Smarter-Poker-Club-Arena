/**
 * CASH, HEADS-UP BACK TO THREE OR MORE: NOBODY POSTS A BLIND TWICE RUNNING OR
 * SKIPS ONE (2026-11-13, heads-up lane, HU-EXE-002).
 *
 * Heads-up the button is the small blind. When a third player was dealt in,
 * the cash rotation walked the button forward onto the previous big blind:
 * that player never posted the small blind that follows a big blind, and the
 * previous button posted the small blind twice running, half a big blind
 * moved from one incumbent to the other at every such transition. The
 * tournament rule (deadButton.ts) and the three-handed-to-heads-up rule
 * (headsUpButton.ts) already prevented exactly this; the cash
 * heads-up-to-three path did not. The button now stays for the entry hand
 * (ServerTableEngineBase.cashButtonStaysAfterHeadsUp).
 *
 * Review R1 (same day): with two newcomers, one of whom taps Post Big Blind,
 * the post gate judged positions over a roster that included the other
 * waiting player, so a newcomer could be dealt into the small blind while an
 * incumbent posted a blind twice running. postBBToEnter now judges the hand
 * as it would be dealt. The stay hand is also not a completed orbit.
 *
 * Driven through the real ServerTableEngine.dealHand, HandController.start,
 * getBBSeatIndex, postBBToEnter and predictBlindSeats. The dealing loop itself
 * is NOT run: its two entry steps (release the waiter the big blind reaches,
 * then replay standing agreements to post) are repeated here by hand in
 * `hand()`, in the loop's order.
 *
 * Layouts: two incumbents and one newcomer (32); two incumbents and two
 * newcomers who wait, post or one of each, which includes heads-up straight to
 * four-handed (720); three veterans going three-handed to heads-up and back,
 * the returning player dealt straight in, waiting or posting (540).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/supabase/client.js', () => ({ supabase: {}, maintenanceSupabase: {} }));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
const { ServerTableEngine } = await import('./ServerTableEngine.js');

const engines: any[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.preciseTimer.dispose();
    e.engineTelemetry?.dispose?.();
  }
});

const row = (seat: number) => ({
  seat_number: seat,
  user_id: `u${seat}`,
  username: `P${seat}`,
  stack: 10_000,
  is_horse: false,
  occupancy_id: `occupancy-${seat}`,
  seat_id: `00000000-0000-4000-8000-0000000000${String(seat).padStart(2, '0')}`,
  seat_joined_at: '2026-11-13T00:00:00.000Z',
});

function cashTable() {
  const e = new ServerTableEngine('hu-exe-002') as any;
  engines.push(e);
  e.tableInfo = {
    id: 'hu-exe-002',
    game_variant: 'nlh',
    game_type: 'cash',
    tournament_id: null,
    small_blind: 50,
    big_blind: 100,
    ante: 0,
    max_players: 6,
  };
  e.takePreparedHandNumber = () => 123;
  e.bombPotSchedPersistedJson = 'null';
  e.away = new Set<string>();
  e.disconnectEngine.isSittingOut = (_table: string, id: string) => e.away.has(id);
  e.waitingForBB = new Set();
  e.persistEntryHold = () => {};
  e.orbits = 0;
  const refill = e.timeBankEngine.onOrbitComplete.bind(e.timeBankEngine);
  e.timeBankEngine.onOrbitComplete = (...args: unknown[]) => {
    e.orbits++;
    return refill(...args);
  };
  return e;
}

type Hand = {
  dealt: number[];
  button: number;
  sb: number;
  bb: number;
  /** Seats that paid a live big blind to enter, outside the blinds. */
  posts: number[];
  /** predictBlindSeats over the dealt roster, read before the deal. */
  predicted: number[];
  /** Waiting seats the gate released because the big blind reached them. */
  released: number[];
  /** The deal reported a completed orbit (time banks refill, sit-out orbit counted). */
  orbit: boolean;
};

async function hand(e: any): Promise<Hand | null> {
  // The dealing loop's gate: a waiting player is released when the big blind reaches their seat.
  const released: number[] = [];
  if (e.waitingForBB.size > 0) {
    const bbSeat = e.getBBSeatIndex();
    for (const id of [...e.waitingForBB]) {
      const p = e.seatedPlayers.find((s: any) => s.user_id === id);
      if (p && p.seat_number === bbSeat) {
        e.waitingForBB.delete(id);
        e.postBBWhenClear.delete(id);
        released.push(p.seat_number);
      }
    }
  }
  // Then the loop replays every standing agreement to post.
  for (const id of [...e.postBBWhenClear]) {
    if (!e.waitingForBB.has(id)) {
      e.postBBWhenClear.delete(id);
      continue;
    }
    e.postBBToEnter(id);
  }
  const players = e.seatedPlayers.filter(
    (p: any) => !e.waitingForBB.has(p.user_id) && !e.away.has(p.user_id)
  );
  if (players.length < 2) return null;
  const predicted = e.predictBlindSeats(players);
  const orbitsBefore = e.orbits;
  const stop = new Error('controller built');
  e.fetchTimeBankExtras = () => {
    throw stop;
  };
  await expect(e.dealHand(players)).rejects.toBe(stop);
  const hc = e.handController;
  const posted: Array<{ seat: number; kind: string }> = [];
  hc.onEvent((ev: any) => {
    if (ev.type === 'FORCED_BETS_POSTED') posted.push(...ev.postings);
  });
  hc.start();
  expect(posted.filter((p) => p.kind === 'bb')).toHaveLength(1);
  expect(posted.filter((p) => p.kind === 'sb')).toHaveLength(1);
  return {
    dealt: players.map((p: any) => p.seat_number),
    button: hc.getDealerSeat(),
    sb: posted.find((p) => p.kind === 'sb')!.seat,
    bb: posted.find((p) => p.kind === 'bb')!.seat,
    posts: posted.filter((p) => p.kind !== 'sb' && p.kind !== 'bb').map((p) => p.seat),
    predicted: [predicted.button, predicted.smallBlind, predicted.bigBlind],
    released,
    orbit: e.orbits > orbitsBefore,
  };
}

const show = (hands: Hand[]) =>
  hands
    .map(
      (h) =>
        `[${h.dealt}] button ${h.button} sb ${h.sb} bb ${h.bb}${h.posts.length ? ` post ${h.posts}` : ''}${h.orbit ? ' orbit' : ''}`
    )
    .join(' | ');

/**
 * The rotation laws, hand to hand. `everyoneStays` is the strict form used
 * when nobody leaves; without it the one documented exception is allowed: the
 * player who just posted the big blind is no longer dealt in, so the small
 * blind cannot follow them (headsUpButton.ts, the dead button).
 */
function expectHonestRotation(hands: Hand[], everyoneStays: boolean) {
  const all = show(hands);
  for (let i = 0; i < hands.length; i++) {
    const now = hands[i];
    const label = `hand ${i + 1} of ${all}`;
    // The predictor (the wait-for-big-blind gate reads it) and the deal agree.
    expect([now.button, now.sb, now.bb], label).toEqual(now.predicted);
    // Whoever the gate released for the big blind posts the big blind.
    for (const seat of now.released) expect(now.bb, label).toBe(seat);
    // Heads-up, the button is the small blind.
    if (now.dealt.length === 2) expect(now.sb, label).toBe(now.button);
    if (i === 0) continue;
    const prev = hands[i - 1];
    // Nobody posts the big blind twice running.
    expect(now.bb, label).not.toBe(prev.bb);
    const previousBigBlindPlays = now.dealt.includes(prev.bb);
    if (everyoneStays) expect(previousBigBlindPlays, label).toBe(true);
    if (previousBigBlindPlays) {
      // The player who just posted the big blind posts the small blind next:
      // nobody skips the small blind and nobody posts it twice running.
      expect(now.sb, label).toBe(prev.bb);
    }
    // The button stays at most one hand.
    if (i >= 2) {
      expect(
        hands[i - 2].button === prev.button && prev.button === now.button,
        `button on one seat three hands running, ${label}`
      ).toBe(false);
    }
    // The hand the button stays for is not a completed orbit.
    if (prev.dealt.length === 2 && now.dealt.length >= 3 && now.button === prev.button) {
      expect(now.orbit, `orbit counted on the stay hand, ${label}`).toBe(false);
    }
  }
}

/** A player's first hand: in the big blind or behind it with a live post, never the button or small blind. */
function expectHonestEntry(hands: Hand[], seat: number, from: number, within: number) {
  const all = show(hands);
  const entry = hands.findIndex((h, i) => i >= from && h.dealt.includes(seat));
  expect(entry, `seat ${seat} is dealt in, ${all}`).toBeGreaterThanOrEqual(from);
  expect(entry - from, `seat ${seat} is dealt in soon enough, ${all}`).toBeLessThan(within);
  const first = hands[entry];
  expect(first.button, `seat ${seat} enters on the button, ${all}`).not.toBe(seat);
  expect(first.sb, `seat ${seat} enters on the small blind, ${all}`).not.toBe(seat);
  expect(first.bb === seat || first.posts.includes(seat), `seat ${seat} enters free, ${all}`).toBe(
    true
  );
}

const SEATS = [1, 2, 3, 4, 5, 6];

function headsUp(pair: number[], firstButton: number) {
  const e = cashTable();
  const other = pair.find((s) => s !== firstButton)!;
  // The heads-up hand before the first one dealt here: button and small blind `other`, big blind `firstButton`.
  e.lastButtonSeat = other;
  e.lastSmallBlindSeat = other;
  e.lastBigBlindSeat = firstButton;
  e.seatedPlayers = pair.map(row);
  e.dealtInUserIds = new Set(pair.map((s) => `u${s}`));
  return { e, other };
}

function sit(e: any, seats: number[]) {
  e.seatedPlayers = [...e.seatedPlayers.map((p: any) => p.seat_number), ...seats]
    .sort((a, b) => a - b)
    .map(row);
  for (const s of seats) e.waitingForBB.add(`u${s}`);
}

describe('HU-EXE-002: cash heads-up to three-handed, nobody skips or repeats a blind', () => {
  for (const pair of [
    [1, 2],
    [1, 4],
    [2, 5],
    [3, 6],
  ])
    for (const firstButton of pair)
      for (const arrival of SEATS.filter((s) => !pair.includes(s)))
        it(`heads-up seats ${pair.join(' and ')}, button ${firstButton}, a new player sits at ${arrival}`, async () => {
          const { e, other } = headsUp(pair, firstButton);
          const hands: Hand[] = [(await hand(e))!];
          expect([hands[0].button, hands[0].sb, hands[0].bb]).toEqual([
            firstButton,
            firstButton,
            other,
          ]);

          sit(e, [arrival]);
          for (let i = 0; i < 6; i++) hands.push((await hand(e))!);

          const entry = hands.findIndex((h) => h.dealt.includes(arrival));
          expect(entry, 'the new player is dealt in within two hands').toBeGreaterThan(0);
          expect(entry).toBeLessThanOrEqual(2);
          // Published cash rule: a new player enters in the big blind, never on the button.
          expect(hands[entry].bb).toBe(arrival);
          expect(hands[entry].button).not.toBe(arrival);
          expect(hands.flatMap((h) => h.posts)).toEqual([]);
          expectHonestRotation(hands, true);
        });
});

const pairs: number[][] = [];
for (const a of SEATS) for (const b of SEATS) if (a < b) pairs.push([a, b]);

const twoNewcomerModes = [
  { name: 'both wait for the big blind', posts: (_a: number, _b: number): number[] => [] },
  { name: 'both tap Post Big Blind', posts: (a: number, b: number) => [a, b] },
  { name: 'the lower seat posts, the higher waits', posts: (a: number, _b: number) => [a] },
  { name: 'the higher seat posts, the lower waits', posts: (_a: number, b: number) => [b] },
];

describe('HU-EXE-002: cash heads-up plus two new players, every layout (review R1, R2)', () => {
  for (const mode of twoNewcomerModes)
    for (const pair of pairs)
      for (const firstButton of pair) {
        const free = SEATS.filter((s) => !pair.includes(s));
        for (const a of free)
          for (const b of free.filter((s) => s > a))
            it(`${mode.name}: heads-up seats ${pair.join(' and ')}, button ${firstButton}, new players at ${a} and ${b}`, async () => {
              const { e } = headsUp(pair, firstButton);
              const hands: Hand[] = [(await hand(e))!];
              sit(e, [a, b]);
              for (const s of mode.posts(a, b)) e.postBBToEnter(`u${s}`);
              for (let i = 0; i < 8; i++) hands.push((await hand(e))!);
              expectHonestRotation(hands, true);
              expectHonestEntry(hands, a, 1, 3);
              expectHonestEntry(hands, b, 1, 3);
              // Each player who entered behind the blinds paid exactly one live big blind.
              const posts = hands.flatMap((h) => h.posts);
              expect(new Set(posts).size, show(hands)).toBe(posts.length);
              expect(hands[hands.length - 1].dealt).toEqual([...pair, a, b].sort((x, y) => x - y));
            });
      }

  it('heads-up straight to four-handed: both new players are dealt into the same hand', async () => {
    const { e } = headsUp([1, 2], 2);
    const hands: Hand[] = [(await hand(e))!];
    sit(e, [3, 4]);
    e.postBBToEnter('u3');
    e.postBBToEnter('u4');
    for (let i = 0; i < 6; i++) hands.push((await hand(e))!);
    // Seat 3 would be the small blind on the next hand and seat 4 would put
    // seat 3 there, so both are held one heads-up hand; then the big blind
    // reaches seat 3 and seat 4 posts behind it.
    expect(hands.map((h) => h.dealt.length)).toEqual([2, 2, 4, 4, 4, 4, 4]);
    expect(hands[2]).toMatchObject({ dealt: [1, 2, 3, 4], button: 1, sb: 2, bb: 3, posts: [4] });
    expectHonestRotation(hands, true);
  });
});

const triples: number[][] = [];
for (const a of SEATS)
  for (const b of SEATS) for (const c of SEATS) if (a < b && b < c) triples.push([a, b, c]);

describe('HU-EXE-002: cash three-handed to heads-up and back, every layout (review R2)', () => {
  for (const back of ['is dealt straight back in', 'waits for the big blind', 'posts'] as const)
    for (const triple of triples)
      for (const button of triple)
        for (const awayHands of [1, 2, 3])
          it(`a player sits out ${awayHands} hand(s) and ${back}: seats ${triple.join(', ')}, button ${button}`, async () => {
            const e = cashTable();
            const next = (s: number) => triple.find((x) => x > s) ?? triple[0];
            e.seatedPlayers = triple.map(row);
            e.dealtInUserIds = new Set(triple.map((s) => `u${s}`));
            e.lastButtonSeat = button;
            e.lastSmallBlindSeat = next(button);
            e.lastBigBlindSeat = next(next(button));
            const hands: Hand[] = [];
            const deal = async (n: number) => {
              for (let i = 0; i < n; i++) {
                const h = await hand(e);
                if (h) hands.push(h);
              }
            };
            const returns: Array<{ seat: number; from: number }> = [];
            // Each of the three players leaves once and comes back.
            for (const out of triple) {
              await deal(2);
              e.away.add(`u${out}`);
              e.waitingForBB.delete(`u${out}`);
              e.postBBWhenClear.delete(`u${out}`);
              await deal(awayHands);
              e.away.delete(`u${out}`);
              if (back !== 'is dealt straight back in') {
                e.waitingForBB.add(`u${out}`);
                returns.push({ seat: out, from: hands.length });
              }
              if (back === 'posts') e.postBBToEnter(`u${out}`);
            }
            await deal(5);
            expect(hands.length).toBeGreaterThan(10);
            expectHonestRotation(hands, false);
            // A player who came back through the entry gate never lands on the small blind.
            for (const r of returns) {
              const first = hands.find((h, i) => i >= r.from && h.dealt.includes(r.seat));
              if (first)
                expect(first.sb, `seat ${r.seat} back on the small blind, ${show(hands)}`).not.toBe(
                  r.seat
                );
            }
            expect(hands[hands.length - 1].dealt).toEqual(triple);
          });
});

describe('HU-EXE-002: a second new player never pushes an admitted one onto the small blind', () => {
  for (const second of ['posts', 'waits for the big blind'] as const)
    for (const veteran of SEATS)
      it(`one player left at seat ${veteran}, a new player posts, then another sits down and ${second}`, async () => {
        const seatAfter = (s: number, n: number) => ((s - 1 + n) % 6) + 1;
        const first = seatAfter(veteran, 1);
        const later = seatAfter(veteran, 2);
        const gone = seatAfter(veteran, 4);
        const e = cashTable();
        // The last hand was heads-up against a player who has since left.
        e.lastButtonSeat = veteran;
        e.lastSmallBlindSeat = veteran;
        e.lastBigBlindSeat = gone;
        e.seatedPlayers = [row(veteran)];
        e.dealtInUserIds = new Set([`u${veteran}`, `u${gone}`]);
        sit(e, [first]);
        // Admitted: heads-up against the remaining player they would be the big blind.
        expect(e.postBBToEnter(`u${first}`)).toEqual({ success: true });
        sit(e, [later]);
        if (second === 'posts') {
          expect(e.postBBToEnter(`u${later}`)).toMatchObject({ success: true, deferred: true });
        }
        const hands: Hand[] = [];
        for (let i = 0; i < 6; i++) hands.push((await hand(e))!);
        expect(hands[0].dealt, show(hands)).toEqual([veteran, first].sort((a, b) => a - b));
        expectHonestRotation(hands, true);
        expectHonestEntry(hands, first, 0, 1);
        expectHonestEntry(hands, later, 0, 4);
      });
});
