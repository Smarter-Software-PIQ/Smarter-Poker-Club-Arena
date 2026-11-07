/**
 * SHARED HAND LINKS TRAVEL WELL (2026-11-06), follow-ups to #9738/#9749:
 *  - Link on a phone opens the share sheet (one tap to Messages); elsewhere it
 *    copies; dismissing the sheet copies nothing.
 *  - Link and Share carry the sender's Share & Invite code as `&i=`, beside the
 *    payload, so the replay can offer a signed-out viewer Create Account
 *    through the sender's referral door (`/i/<CODE>`).
 *  - The replay offers that only to signed-out viewers.
 *  - An old archive link to someone else's hand offers a ready request for a
 *    Share link, and names nobody.
 *  - The sender's code comes from the table's club, else their own club.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const session = vi.hoisted(() => ({ signedIn: false }));
vi.mock('@/lib/authUtils', async (orig) => ({
  ...(await orig<typeof import('@/lib/authUtils')>()),
  hasLocalSession: () => session.signedIn,
}));
vi.mock('@/services/SoundService', () => ({
  soundService: new Proxy({}, { get: () => vi.fn() }),
  haptic: new Proxy({}, { get: () => vi.fn() }),
}));
vi.mock('@/hooks/useAuthUser', () => ({ useAuthUser: () => ({ user: null }) }));

const db = vi.hoisted(() => ({
  tableClub: 'host-club' as string | null,
  ownClub: 'own-club' as string | null,
  member: new Set<string>(['host-club', 'own-club']),
  rpc: vi.fn(),
}));
vi.mock('@/lib/supabase', () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    for (const k of ['select', 'eq', 'in', 'order', 'limit']) q[k] = vi.fn(self);
    q.maybeSingle = vi.fn(async () => ({
      data:
        table === 'tables'
          ? db.tableClub && { club_id: db.tableClub }
          : db.ownClub && { club_id: db.ownClub },
      error: null,
    }));
    return q;
  };
  return {
    supabase: {
      from: vi.fn((t: string) => chain(t)),
      rpc: db.rpc,
    },
  };
});

import { handShareLink } from '@/lib/handHistoryLive';
import { normalizeInviteCode } from '@/lib/inviteCode';
import { normalizeInviteCode as fromService } from '@/services/ClubInviteService';
import { resolveSenderInviteCode } from '@/hooks/useSenderInviteCode';
import { encodeHand } from '@/components/table/ShareHand';
import { shareableFromModel } from '@/lib/shareHandModel';
import { buildReplay, replayInputFromRow } from '@/utils/handReplay';
import { SHARE_LINK_REQUEST } from '@/pages/HandHistoryPage';

const src = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

const SENDER = 'sender-uuid';
const ROW = {
  id: 'hand-uuid',
  hand_number: 56019216,
  game_variant: 'nlh',
  small_blind: 0.25,
  big_blind: 0.5,
  pot_size: 0.75,
  button_seat: 2,
  started_at: '2026-11-06T19:56:52.000Z',
  community_cards: [],
  players: [
    { userId: SENDER, username: 'Mongo', seat: 1, stack: 160, cards: [] },
    { userId: 'v', username: 'Vegas_Owen', seat: 2, stack: 54, cards: [] },
  ],
  actions: [
    { seat: 1, userId: SENDER, action: 'sb', amount: 0.25, stage: 'preflop' },
    { seat: 2, userId: 'v', action: 'bb', amount: 0.5, stage: 'preflop' },
    { seat: 1, userId: SENDER, action: 'fold', amount: 0, stage: 'preflop' },
  ],
  winners: [{ userId: 'v', amount: 0.75, potIndex: 0 }],
  hole_cards: null,
  showdown: null,
};
const encoded = () =>
  encodeHand(
    shareableFromModel(buildReplay(replayInputFromRow(ROW as never, {})), {
      id: ROW.id,
      tableName: 'NLH',
      heroUserId: SENDER,
    })
  );

afterEach(() => {
  cleanup();
  session.signedIn = false;
});

describe('the invite code rides beside the hand', () => {
  it('appends a valid code as i=, and drops anything else', () => {
    expect(handShareLink('v4~x', 'https://smarter.poker', 'abc2def')).toBe(
      'https://smarter.poker/hub/club-arena/replay?h=v4~x&i=ABC2DEF'
    );
    expect(handShareLink('v4~x', 'https://smarter.poker', 'BAD')).toBe(
      'https://smarter.poker/hub/club-arena/replay?h=v4~x'
    );
    expect(handShareLink('v4~x', 'https://smarter.poker', null)).toBe(
      'https://smarter.poker/hub/club-arena/replay?h=v4~x'
    );
  });

  it('has one code rule: the service re-exports the pure one', () => {
    expect(fromService).toBe(normalizeInviteCode);
    expect(normalizeInviteCode('O0I1ABC')).toBeNull();
  });

  it('the Share sheet carries it too, and its codec file loads no client', () => {
    const share = src('src/components/table/ShareHand.tsx');
    expect(share).toContain("`${baseUrl}?h=${encoded}${invite ? `&i=${invite}` : ''}`");
    expect(share).not.toMatch(/from '\.\.\/\.\.\/lib\/supabase'|ClubInviteService/);
    expect(src('src/pages/HandHistoryPage.tsx')).toContain('inviteCode={shareInvite}');
    expect(src('src/components/table/TableModalsLayer.tsx')).toContain('inviteCode={shareInvite}');
  });
});

describe("the sender's code", () => {
  beforeEach(() => {
    db.tableClub = 'host-club';
    db.ownClub = 'own-club';
    db.member = new Set(['host-club', 'own-club']);
    db.rpc.mockReset();
    db.rpc.mockImplementation(async (_fn: string, args: { p_club_id: string }) =>
      db.member.has(args.p_club_id)
        ? {
            data: { success: true, code: args.p_club_id === 'host-club' ? 'HSTAAAA' : 'WNBBBBB' },
            error: null,
          }
        : { data: { success: false, error: 'Only club members can invite players.' }, error: null }
    );
  });

  it("is the table's club code when the sender belongs to it", async () => {
    expect(await resolveSenderInviteCode('t1', SENDER)).toBe('HSTAAAA');
  });

  it("falls back to the sender's own club on a union table they are not a member of", async () => {
    db.member.delete('host-club');
    expect(await resolveSenderInviteCode('t1', SENDER)).toBe('WNBBBBB');
  });

  it('is null with no club, and never asks for a signed-out sender', async () => {
    db.member.clear();
    expect(await resolveSenderInviteCode('t1', SENDER)).toBeNull();
    db.rpc.mockClear();
    expect(await resolveSenderInviteCode('t1', null)).toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe('the replay offers the sender’s door to a signed-out viewer', () => {
  const open = async (query: string) => {
    const { default: Page } = await import('@/pages/share/SharedHandReplayPage');
    render(
      <MemoryRouter initialEntries={[`/replay?${query}`]}>
        <Page />
      </MemoryRouter>
    );
    await screen.findByText('Hand #56019216');
  };

  it('Create Account goes through /i/<CODE>, Sign In returns to the replay', async () => {
    await open(`h=${encoded()}&i=HSTAAAA`);
    expect(screen.getByText('Mongo Invited You')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create Account' }).getAttribute('href')).toBe(
      '/i/HSTAAAA'
    );
    expect(screen.getByRole('link', { name: 'Sign In' }).getAttribute('href')).toMatch(
      /^\/auth\/login\?redirect=/
    );
  });

  it('without a code it is plain signup that returns to the replay', async () => {
    await open(`h=${encoded()}`);
    expect(screen.getByRole('link', { name: 'Create Account' }).getAttribute('href')).toMatch(
      /^\/auth\/signup\?redirect=/
    );
  });

  it('a signed-in viewer sees no join panel', async () => {
    session.signedIn = true;
    await open(`h=${encoded()}&i=HSTAAAA`);
    expect(screen.queryByRole('link', { name: 'Create Account' })).toBeNull();
  });
});

describe('Link sends from a phone in one tap', () => {
  const setPhone = (phone: boolean) =>
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({ matches: phone && q === '(pointer: coarse)' }),
    });

  it('the modal shares on a coarse pointer and copies otherwise', () => {
    const modal = src('src/components/table/HandDetailModal.tsx');
    expect(modal).toContain("window.matchMedia('(pointer: coarse)').matches");
    expect(modal).toContain('await navigator.share({');
    expect(modal).toContain(
      "if ((error as { name?: string } | null)?.name === 'AbortError') return false;"
    );
    expect(modal).toContain('void sendLink(hand, link).then((sent) => {');
    expect(modal).toContain('useSenderInviteCode(hand?.tableId, heroId, isOpen)');
    setPhone(false);
  });
});

describe('an old link to someone else’s hand', () => {
  it('offers a ready request that names nobody', () => {
    const page = src('src/pages/HandHistoryPage.tsx');
    expect(page).toContain('Ask For A Share Link');
    expect(page).toContain('void askForShareLink()');
    expect(SHARE_LINK_REQUEST).toMatch(/Share button/);
    expect(SHARE_LINK_REQUEST).not.toMatch(/—/);
  });
});
