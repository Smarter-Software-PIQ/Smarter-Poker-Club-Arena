import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  appendHeadsUpInviteToken,
  fromHeadsUpWaitModeDb,
  headsUpWaitModeErrorText,
  isHeadsUpHoldActive,
  normalizeHeadsUpInviteToken,
  parseHeadsUpHoldExpiresAtMs,
  parseHeadsUpInviteToken,
  toHeadsUpWaitModeDb,
} from '../../src/utils/headsUpWaitMode';
import {
  seatFirstBuyInReasonIsKnown,
  seatFirstBuyInRefusalText,
} from '../../src/services/TournamentService';

const ROOT = resolve(__dirname, '../..');
const TABLE_PAGE = readFileSync(resolve(ROOT, 'src/pages/TablePage.tsx'), 'utf8');

describe('headsUpWaitMode pure client helpers', () => {
  const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  it('maps between UI wait modes and DB wait_mode values', () => {
    expect(toHeadsUpWaitModeDb('specific')).toBe('specific_player');
    expect(toHeadsUpWaitModeDb('anyone')).toBe('play_anyone');
    expect(fromHeadsUpWaitModeDb('specific_player')).toBe('specific');
    expect(fromHeadsUpWaitModeDb('play_anyone')).toBe('anyone');
    expect(fromHeadsUpWaitModeDb('invalid')).toBeNull();
  });

  it('validates and extracts ?invite=<TOKEN> from URL search params', () => {
    expect(normalizeHeadsUpInviteToken(`  ${TOKEN}  `)).toBe(TOKEN);
    expect(normalizeHeadsUpInviteToken('short')).toBeNull();
    expect(normalizeHeadsUpInviteToken('bad token with spaces!!')).toBeNull();
    expect(parseHeadsUpInviteToken(`?i=CLUB99&invite=${TOKEN}`)).toBe(TOKEN);
    expect(parseHeadsUpInviteToken('?buyin=1')).toBeNull();
    expect(parseHeadsUpInviteToken('')).toBeNull();
  });

  it('appends ?invite=<TOKEN> cleanly to bare URLs and URLs that already have query params', () => {
    expect(
      appendHeadsUpInviteToken('https://smarter.poker/hub/club-arena/table/tbl-1', TOKEN)
    ).toBe(`https://smarter.poker/hub/club-arena/table/tbl-1?invite=${TOKEN}`);

    expect(
      appendHeadsUpInviteToken('https://smarter.poker/hub/club-arena/table/tbl-1?i=ABC123', TOKEN)
    ).toBe(`https://smarter.poker/hub/club-arena/table/tbl-1?i=ABC123&invite=${TOKEN}`);

    expect(appendHeadsUpInviteToken('https://smarter.poker/hub/club-arena/table/tbl-1', null)).toBe(
      'https://smarter.poker/hub/club-arena/table/tbl-1'
    );
  });

  it('parses hold expiration timestamps and evaluates active holds cleanly', () => {
    const futureIso = '2026-11-22T03:05:00.000Z';
    const futureMs = Date.parse(futureIso);
    expect(parseHeadsUpHoldExpiresAtMs(futureIso)).toBe(futureMs);
    expect(parseHeadsUpHoldExpiresAtMs('')).toBeNull();
    expect(isHeadsUpHoldActive(futureMs, futureMs - 1_000)).toBe(true);
    expect(isHeadsUpHoldActive(futureMs, futureMs + 1_000)).toBe(false);
    expect(isHeadsUpHoldActive(null, futureMs)).toBe(false);
  });

  it('maps seat-2 invite reservation and wait-mode refusals to Title Case player copy', () => {
    expect(seatFirstBuyInReasonIsKnown('heads_up_invite_required')).toBe(true);
    expect(seatFirstBuyInRefusalText('heads_up_invite_required')).toBe(
      'This Seat Is Reserved For An Invited Player'
    );
    expect(headsUpWaitModeErrorText('opponent_already_seated')).toBe(
      'An Opponent Has Already Taken The Other Seat'
    );
    expect(headsUpWaitModeErrorText('game_already_started')).toBe('This Game Has Already Started');
    expect(headsUpWaitModeErrorText('not_seated')).toBe('Take A Seat First To Set Waiting Mode');
    expect(headsUpWaitModeErrorText('unknown')).toBe(
      'Could Not Update Waiting Mode, Please Try Again'
    );
  });
});

describe('TablePage Heads-Up wait-mode persistence, hydration, and invite gate wiring', () => {
  it('persists wait mode via fn_set_heads_up_wait_mode and hydrates from heads_up_wait_holds on reload', () => {
    expect(TABLE_PAGE).toContain("supabase.rpc('fn_set_heads_up_wait_mode'");
    expect(TABLE_PAGE).toContain("from('heads_up_wait_holds')");
    expect(TABLE_PAGE).toContain('.maybeSingle()');
    expect(TABLE_PAGE).toContain('appendHeadsUpInviteToken(');
    expect(TABLE_PAGE).toContain('tableShareUrl(tableId, { inviteCode: senderInviteCode })');
    expect(TABLE_PAGE).toContain('headsUpInviteToken');
    expect(TABLE_PAGE).toContain('inviteToken: headsUpInviteToken');
    expect(TABLE_PAGE).toContain('busy={headsUpModeSaving}');
    expect(TABLE_PAGE).toContain('errorMessage={headsUpModeError}');
  });

  it('verifies ?invite=<TOKEN> through fn_check_heads_up_seat_invite before calling fn_take_seat_and_buy_in', () => {
    const checkIdx = TABLE_PAGE.indexOf(
      "supabase.rpc(\n            'fn_check_heads_up_seat_invite'"
    );
    const buyInIdx = TABLE_PAGE.indexOf("supabase.rpc('fn_take_seat_and_buy_in'");
    expect(checkIdx).toBeGreaterThan(-1);
    expect(buyInIdx).toBeGreaterThan(checkIdx);
    expect(TABLE_PAGE).toContain('p_invite_token: headsUpInviteParam');
  });
});
