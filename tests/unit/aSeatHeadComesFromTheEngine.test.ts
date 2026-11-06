/**
 * THE HEAD ON THE FELT COMES FROM THE ENGINE FIRST (Dan 2026-11-05: "the
 * number on the screen above their head didn't update").
 *
 * The engine now carries each seat's ledger head on its table state
 * (server/src/engine/TheHeadRidesTheTableState.test.ts). The page must read
 * that value before its own bountyMap, which stays as the fallback for an
 * engine build that does not send it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapEngineSnapshot } from '../../src/utils/mapEngineSnapshot';
import {
  observeHead,
  seatBountyBadge,
  seatsNeedLedgerHeadPoll,
  type HeadObservation,
} from '../../src/utils/mysteryBountyTable';

function snapshot(players: Array<Record<string, unknown>>) {
  return {
    table_id: 't1',
    hand_number: 4,
    pot: 0,
    stage: 'preflop',
    current_player: null,
    dealer_seat: 1,
    max_seats: 6,
    players,
    community_cards: [],
    action_history: [],
    side_pots: [],
    winners: [],
    disconnect_states: {},
  };
}

describe('a seat head comes from the engine', () => {
  it('maps the engine head onto the seat and drops a malformed one', () => {
    const out = mapEngineSnapshot(
      snapshot([
        { seat: 1, user_id: 'a', username: 'A', stack: 100, cards: [], bounty: 5.38 },
        { seat: 2, user_id: 'b', username: 'B', stack: 100, cards: [], bounty: 'x' },
        { seat: 3, user_id: 'c', username: 'C', stack: 100, cards: [] },
      ]) as never,
      'a',
      6
    );
    expect(out.players[0]?.bounty).toBe(5.38);
    expect(out.players[1]?.bounty).toBeUndefined();
    expect(out.players[2]?.bounty).toBeUndefined();
  });

  it('the badge shows the engine head before the bountyMap', () => {
    const base = {
      isBountyTournament: true,
      mysteryChestsLive: false,
      playerId: 'a',
      bountyMap: { a: 2.75 },
    };
    expect(seatBountyBadge({ ...base, engineBounty: 5.38 }).value).toBe(5.38);
    expect(seatBountyBadge({ ...base, engineBounty: 0 }).value).toBe(0);
    expect(seatBountyBadge({ ...base, engineBounty: undefined }).value).toBe(2.75);
    expect(seatBountyBadge({ ...base, engineBounty: null }).value).toBe(2.75);
  });

  it('chests and chests-only events still hide the head', () => {
    const base = { isBountyTournament: true, playerId: 'a', bountyMap: {}, engineBounty: 3 };
    expect(seatBountyBadge({ ...base, mysteryChestsLive: true }).value).toBeUndefined();
    expect(
      seatBountyBadge({ ...base, mysteryChestsLive: false, chestsOnly: true }).value
    ).toBeUndefined();
    expect(
      seatBountyBadge({ ...base, isBountyTournament: false, mysteryChestsLive: false }).value
    ).toBeUndefined();
  });

  it('the fresher source wins: a map that changed after the engine head outranks it', () => {
    const base = {
      isBountyTournament: true,
      mysteryChestsLive: false,
      playerId: 'a',
      bountyMap: { a: 7.5 },
      engineBounty: 5,
    };
    // The engine's heads read failed after a knockout; the map moved later.
    expect(seatBountyBadge({ ...base, engineSeenAt: 100, mapSeenAt: 200 }).value).toBe(7.5);
    // The engine caught up (or moved first): it wins again, ties included.
    expect(seatBountyBadge({ ...base, engineSeenAt: 300, mapSeenAt: 200 }).value).toBe(5);
    expect(seatBountyBadge({ ...base, engineSeenAt: 200, mapSeenAt: 200 }).value).toBe(5);
    // A map with no head for the seat never hides the engine's.
    expect(
      seatBountyBadge({ ...base, bountyMap: {}, engineSeenAt: 100, mapSeenAt: 200 }).value
    ).toBe(5);
  });

  it('observes when each value was first seen, idempotently', () => {
    const seen = new Map<string, HeadObservation>();
    expect(observeHead(seen, 'a', 5, 100)).toBe(100);
    expect(observeHead(seen, 'a', 5, 900)).toBe(100);
    expect(observeHead(seen, 'a', 7.5, 1000)).toBe(1000);
    expect(observeHead(seen, 'a', 'x', 1100)).toBe(1100);
    expect(observeHead(seen, null, 5, 1200)).toBeUndefined();
  });

  it('the client polls the ledger only while a live seat lacks the engine head', () => {
    expect(
      seatsNeedLedgerHeadPoll([
        { id: 'a', bounty: 5 },
        { id: 'b', bounty: 0 },
      ])
    ).toBe(false);
    expect(seatsNeedLedgerHeadPoll([{ id: 'a', bounty: 5 }, { id: 'b' }])).toBe(true);
    expect(
      seatsNeedLedgerHeadPoll([
        { id: 'a', bounty: 5 },
        { id: 'b', status: 'eliminated' },
      ])
    ).toBe(false);
    expect(seatsNeedLedgerHeadPoll([null, undefined, { id: 'a', bounty: 2 }])).toBe(false);
    expect(seatsNeedLedgerHeadPoll([])).toBe(false);
  });

  it('the table page hands the seat engine head to the badge', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/TablePage.tsx'), 'utf8');
    expect(page).toMatch(/bountyMap: tableState\.bountyMap,\s*engineBounty: player\?\.bounty,/);
  });
});
