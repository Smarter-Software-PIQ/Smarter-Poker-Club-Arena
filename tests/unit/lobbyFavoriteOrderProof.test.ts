import { describe, expect, it } from 'vitest';
import { sameUnchangedLobbyOrder } from '../e2e/support/lobbyFavoriteOrderProof';

const READ_AT = Date.parse('2026-11-15T04:31:00Z');
const SCHEDULED = Date.parse('2026-11-15T20:00:00Z');
const RUNNING = Date.parse('2026-11-15T01:30:00Z');

const row = (id: string, players: number, start = SCHEDULED, name = id) => ({
  id,
  start,
  sortKey: JSON.stringify([name, '40', players, new Date(start).toISOString(), false]),
});

describe('favorite order causality on a live catalog', () => {
  const before = [row('bounty', 2), row('freezeout', 0), row('chosen', 0)];
  const live = [row('freezeout', 4), row('bounty', 2), row('chosen', 0)];

  it('accepts the captured equal-price player tiebreak change, which stale ID order rejects', () => {
    expect(live.map((r) => r.id)).not.toEqual(before.map((r) => r.id));
    expect(sameUnchangedLobbyOrder(live, before, 'chosen', READ_AT)).toBe(true);
  });

  it('still refuses favorite promotion even alongside that live update', () => {
    expect(sameUnchangedLobbyOrder([live[2], live[0], live[1]], before, 'chosen', READ_AT)).toBe(
      false
    );
  });

  it('refuses missing, changed or unopposed selected rows instead of claiming order proof', () => {
    expect(sameUnchangedLobbyOrder(live.slice(0, 2), before, 'chosen', READ_AT)).toBe(false);
    expect(sameUnchangedLobbyOrder([row('chosen', 1), live[1]], before, 'chosen', READ_AT)).toBe(
      false
    );
    expect(sameUnchangedLobbyOrder([live[2]], before, 'chosen', READ_AT)).toBe(false);
  });

  it('permits disappeared occurrences while retaining the selected row and a stable peer', () => {
    expect(sameUnchangedLobbyOrder([live[1], live[2]], before, 'chosen', READ_AT)).toBe(true);
  });
});

describe('only tournaments not yet started are comparison peers', () => {
  // Run 43668583397 (webkit-footer): two running MTTs swapped on a bust
  // (current_players) while their rendered Entries stayed byte-identical.
  const superStack = row('superStack', 93, RUNNING, 'Saturday Night Super Stack');
  const mystery = row('mystery', 108, Date.parse('2026-11-15T02:00:00Z'), 'Saturday Mystery');
  const peer = row('peer', 3);
  const chosen = row('chosen', 0);
  const before = [superStack, mystery, peer, chosen];
  const after = [mystery, superStack, peer, chosen];

  it('ignores running peers that reorder under unchanged rendered keys', () => {
    expect(sameUnchangedLobbyOrder(after, before, 'chosen', READ_AT)).toBe(true);
  });

  it('the same swap among tournaments not yet started is still refused', () => {
    const s = row('superStack', 93, SCHEDULED + 60_000, 'Saturday Night Super Stack');
    const m = row('mystery', 108, SCHEDULED + 60_000, 'Saturday Mystery');
    expect(
      sameUnchangedLobbyOrder([m, s, peer, chosen], [s, m, peer, chosen], 'chosen', READ_AT)
    ).toBe(false);
  });

  it('still refuses favorite promotion over a not-yet-started peer', () => {
    expect(
      sameUnchangedLobbyOrder([mystery, superStack, chosen, peer], before, 'chosen', READ_AT)
    ).toBe(false);
  });

  it('leaves out a peer that started between the reference read and this read', () => {
    const starting = row('starting', 5, READ_AT - 1);
    // Ordered ahead of chosen before its start, behind it now: not a comparison peer.
    expect(
      sameUnchangedLobbyOrder([peer, chosen, starting], [starting, peer, chosen], 'chosen', READ_AT)
    ).toBe(true);
    // A start exactly at the read moment has begun: excluded too.
    const atRead = row('atRead', 5, READ_AT);
    expect(
      sameUnchangedLobbyOrder([peer, chosen, atRead], [atRead, peer, chosen], 'chosen', READ_AT)
    ).toBe(true);
  });

  it('refuses when no not-yet-started peer remains beside the chosen row', () => {
    expect(
      sameUnchangedLobbyOrder(
        [mystery, superStack, chosen],
        [superStack, mystery, chosen],
        'chosen',
        READ_AT
      )
    ).toBe(false);
  });

  it('refuses when the chosen row itself has started or has no readable start', () => {
    const startedChosen = row('chosen', 0, RUNNING);
    expect(
      sameUnchangedLobbyOrder([peer, startedChosen], [peer, startedChosen], 'chosen', READ_AT)
    ).toBe(false);
    const unreadable = { id: 'chosen', start: Number.NaN, sortKey: chosen.sortKey };
    expect(sameUnchangedLobbyOrder([peer, unreadable], [peer, unreadable], 'chosen', READ_AT)).toBe(
      false
    );
  });

  it('a peer with no readable start time is never a comparison peer', () => {
    const unreadable = { id: 'unreadable', start: Number.NaN, sortKey: '["unreadable"]' };
    expect(
      sameUnchangedLobbyOrder(
        [unreadable, peer, chosen],
        [peer, chosen, unreadable],
        'chosen',
        READ_AT
      )
    ).toBe(true);
    expect(
      sameUnchangedLobbyOrder([chosen, unreadable], [unreadable, chosen], 'chosen', READ_AT)
    ).toBe(false);
  });

  it('refuses every peer when the read moment is unreadable', () => {
    expect(sameUnchangedLobbyOrder([peer, chosen], [peer, chosen], 'chosen', Number.NaN)).toBe(
      false
    );
  });
});

describe('the selected run takes registrations while the journey runs', () => {
  // Runs 43771208157 and 43781951342: the starred Midnight Free Buy went
  // 330 -> 331, 349 -> 350 and 352 -> 353 with every row in place.
  const higher = row('higher', 355);
  const lower = row('lower', 275);
  const before = [higher, row('chosen', 349), lower];

  it('accepts a selected run whose own entry count moved while it kept its place', () => {
    expect(
      sameUnchangedLobbyOrder([higher, row('chosen', 350), lower], before, 'chosen', READ_AT)
    ).toBe(true);
  });

  it('still refuses promotion, or a one-place jump, alongside that registration', () => {
    expect(
      sameUnchangedLobbyOrder([row('chosen', 350), higher, lower], before, 'chosen', READ_AT)
    ).toBe(false);
    const near = row('near', 360);
    expect(
      sameUnchangedLobbyOrder(
        [row('chosen', 350), near, lower],
        [near, row('chosen', 349), lower],
        'chosen',
        READ_AT
      )
    ).toBe(false);
  });

  it('does not compare a same-price peer the moved count can legitimately pass', () => {
    const tied = row('tied', 350, SCHEDULED, 'aaa');
    expect(
      sameUnchangedLobbyOrder(
        [row('chosen', 351), tied, lower],
        [tied, row('chosen', 349), lower],
        'chosen',
        READ_AT
      )
    ).toBe(true);
  });

  it('reads a thousands separator in a moved count and refuses a count that is not a number', () => {
    const big = (id: string, entries: string) => {
      const base = row(id, 0);
      const [name, price, , start, pin] = JSON.parse(base.sortKey);
      return { ...base, sortKey: JSON.stringify([name, price, entries, start, pin]) };
    };
    const top = big('top', '1,200');
    const bottom = big('bottom', '900');
    const seen = [top, big('chosen', '1,000'), bottom];
    expect(
      sameUnchangedLobbyOrder([top, big('chosen', '1,001'), bottom], seen, 'chosen', READ_AT)
    ).toBe(true);
    for (const unreadable of ['', '...', 'n/a']) {
      expect(
        sameUnchangedLobbyOrder([top, big('chosen', unreadable), bottom], seen, 'chosen', READ_AT)
      ).toBe(false);
    }
  });

  it('refuses a selected run whose name, price, start or pin changed', () => {
    const chosen = row('chosen', 349);
    const [name, price, players, start, pin] = JSON.parse(chosen.sortKey);
    for (const changed of [
      [`${name} (renamed)`, price, players, start, pin],
      [name, '50', players, start, pin],
      [name, price, players, new Date(SCHEDULED + 60_000).toISOString(), pin],
      [name, price, players, start, true],
    ]) {
      expect(
        sameUnchangedLobbyOrder(
          [higher, { ...chosen, sortKey: JSON.stringify(changed) }, lower],
          before,
          'chosen',
          READ_AT
        )
      ).toBe(false);
    }
  });
});
