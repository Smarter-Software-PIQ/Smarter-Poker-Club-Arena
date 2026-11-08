/**
 * HEADS UP REMATCH - the card's vocabulary (Dan 2026-11-08). See
 * src/services/headsUpRematch.ts.
 *
 * The server decides; these pin that the client reads its answers without
 * inventing any, that a match is only a match with a table and a seat, and
 * that every line the card prints is popup copy (Title Case, no em dash) that
 * never says what kind of player the opponent is.
 */
import { describe, expect, it } from 'vitest';
import {
  isHeadsUpFormat,
  parseRematchAnswer,
  rematchFellThrough,
  rematchIsLive,
  rematchView,
  type RematchCardStatus,
} from '../../src/services/headsUpRematch';
import {
  seatFirstBuyInReasonIsKnown,
  seatFirstBuyInRefusalText,
} from '../../src/services/TournamentService';

const ALL: RematchCardStatus[] = [
  'none',
  'waiting_for_you',
  'waiting_for_opponent',
  'finding_table',
  'matched',
  'opponent_declined',
  'you_declined',
  'no_open_game',
  'entries_closed',
  'expired',
  'not_eligible',
  'join_refused',
];

describe('reading the server', () => {
  it('reads every answer the door gives', () => {
    expect(parseRematchAnswer({ status: 'waiting_for_you', seconds_left: 42 })).toEqual({
      status: 'waiting_for_you',
      secondsLeft: 42,
    });
    expect(
      parseRematchAnswer({ status: 'matched', table_id: 't-1', seat_number: 2, reserved_until: 'x' })
    ).toEqual({ status: 'matched', tableId: 't-1', seatNumber: 2 });
    expect(parseRematchAnswer({ status: 'entries_closed', reason: 'platform_frozen' })).toEqual({
      status: 'entries_closed',
      reason: 'platform_frozen',
    });
  });

  it('a match without a table and a seat is not a match', () => {
    expect(parseRematchAnswer({ status: 'matched' })).toBeNull();
    expect(parseRematchAnswer({ status: 'matched', table_id: 't-1' })).toBeNull();
    expect(parseRematchAnswer({ status: 'matched', table_id: 't-1', seat_number: 0 })).toBeNull();
  });

  it('an unreadable answer is null, never a state the card acts on', () => {
    for (const raw of [null, undefined, 'matched', 7, {}, { status: 'won' }, { status: 1 }]) {
      expect(parseRematchAnswer(raw)).toBeNull();
    }
  });

  it('a heads-up result is a two-seat Sit & Go, nothing else', () => {
    expect(isHeadsUpFormat({ format_contract: 'sng-v1', max_players: 2 })).toBe(true);
    expect(isHeadsUpFormat({ format_contract: 'sng-v1', max_players: 6 })).toBe(false);
    expect(isHeadsUpFormat({ format_contract: 'spin-v1', max_players: 3 })).toBe(false);
    expect(isHeadsUpFormat({ format_contract: 'mtt-v2', max_players: 2 })).toBe(false);
  });
});

describe('the card state machine', () => {
  it('polls only while an answer can still change', () => {
    const live = ALL.filter((s) => rematchIsLive(s));
    expect(live.sort()).toEqual(['finding_table', 'none', 'waiting_for_opponent', 'waiting_for_you']);
  });

  it('every final state other than a match falls back to the ordinary Play Again', () => {
    for (const s of ALL) {
      if (rematchIsLive(s) || s === 'matched' || s === 'not_eligible') {
        expect(rematchFellThrough(s), s).toBe(false);
      } else {
        expect(rematchFellThrough(s), s).toBe(true);
        expect(rematchView(s, null, false).primaryLabel).toBe('Find A New Game');
      }
    }
  });

  it('the asked player sees the question and both answers', () => {
    const v = rematchView('waiting_for_you', 37, false);
    expect(v.line).toBe('Your Opponent Wants To Play Again 37s');
    expect(v.primaryLabel).toBe('Play Again');
    expect(v.secondaryLabel).toBe('No Thanks');
    expect(v.primaryBusy).toBe(false);
  });

  it('the asking player sees a countdown, and a second tap does nothing', () => {
    const v = rematchView('waiting_for_opponent', 12, false);
    expect(v.line).toBe('Waiting For Your Opponent 12s');
    expect(v.primaryBusy).toBe(true);
    expect(v.secondaryLabel).toBeNull();
    expect(rematchView('waiting_for_opponent', 0, false).line).toBe('Waiting For Your Opponent');
  });

  it('says why a rematch did not happen', () => {
    expect(rematchView('opponent_declined', null, false).line).toBe('Your Opponent Left');
    expect(rematchView('no_open_game', null, false).line).toBe('No Rematch Table Is Open Right Now');
    expect(rematchView('expired', null, false).line).toBe('The Rematch Offer Has Ended');
  });

  it('joining wins over whatever the last poll said', () => {
    const v = rematchView('waiting_for_you', 20, true);
    expect(v.line).toBe('Starting Your Rematch');
    expect(v.primaryBusy).toBe(true);
  });

  it('an unasked card keeps the ordinary Play Again and prints nothing', () => {
    for (const s of [null, 'none', 'not_eligible'] as const) {
      const v = rematchView(s, 60, false);
      expect(v.line).toBeNull();
      expect(v.primaryLabel).toBe('Play Again');
      expect(v.secondaryLabel).toBeNull();
    }
  });

  it('every line is popup copy: Title Case, no em dash, no word about the opponent kind', () => {
    for (const s of ALL) {
      for (const joining of [false, true]) {
        const v = rematchView(s, 9, joining);
        for (const text of [v.line, v.primaryLabel, v.secondaryLabel]) {
          if (!text) continue;
          expect(text).not.toContain('—');
          expect(text).not.toMatch(/horse|bot|house|computer|\bai\b/i);
          for (const word of text.replace(/\d+s\b/g, '').split(/\s+/).filter(Boolean)) {
            expect(word[0], `${s}: "${text}"`).toBe(word[0].toUpperCase());
          }
        }
      }
    }
  });
});

describe('a reserved seat is refused by name', () => {
  it('maps seat_reserved to its own sentence and counts it as known', () => {
    expect(seatFirstBuyInReasonIsKnown('seat_reserved')).toBe(true);
    expect(seatFirstBuyInRefusalText('seat_reserved')).toBe('That Seat Is Reserved For A Rematch');
    // seat_taken keeps its own sentence.
    expect(seatFirstBuyInRefusalText('seat_taken')).toBe('That Seat Was Just Taken');
  });
});
