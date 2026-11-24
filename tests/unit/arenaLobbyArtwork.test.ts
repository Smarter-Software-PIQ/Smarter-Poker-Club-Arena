import { describe, expect, it } from 'vitest';
import { formatBuyIn, lobbyBuyInLabel } from '../../src/utils/buyIn';
import { MttEventHeader } from '../../src/components/tournament/details/MttEventHeader';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArenaLobbyTitle, lobbyArtwork } from '../../src/components/lobby/ArenaLobbyTitle';

describe('tournament title artwork', () => {
  it('uses the target ticket for a seat-first qualifier', () => {
    expect(lobbyArtwork({ tournament_type: 'SNG', satellite_target_id: 'parent' })).toBe(
      'satellite'
    );
  });
  it('distinguishes the three bounty formats even in turbo events', () => {
    const bounty = { is_turbo: true, is_bounty: true };
    expect(lobbyArtwork(bounty)).toBe('bounty');
    expect(lobbyArtwork({ ...bounty, is_pko: true })).toBe('pko');
    expect(lobbyArtwork({ ...bounty, is_mystery_bounty: true })).toBe('mystery');
  });
  it('reads stored contracts and format labels on legacy rows', () => {
    expect(lobbyArtwork({ format_contract: 'spin-v1', tournament_type: 'MTT' })).toBe('spin');
    expect(lobbyArtwork({ format_contract: 'seat-first-satellite-v1', is_turbo: true })).toBe(
      'satellite'
    );
    expect(lobbyArtwork({ tournament_type: 'MTT_FREEZEOUT' })).toBe('freezeout');
    expect(lobbyArtwork({ type: 'PKO', is_turbo: true })).toBe('pko');
    expect(lobbyArtwork({ variant: 'mystery_bounty', is_bounty: true })).toBe('mystery');
    expect(lobbyArtwork({ format_contract: 'sng-v1', blind_speed: 'turbo' })).toBe('sng');
  });
  it('uses explicit spin and sit-and-go formats', () => {
    expect(lobbyArtwork({}, 'spin')).toBe('spin');
    expect(lobbyArtwork({}, 'sng')).toBe('sng');
  });
});

describe('guarantee in the event title', () => {
  const title = (name: string, format: Parameters<typeof ArenaLobbyTitle>[0]['format']) =>
    renderToStaticMarkup(createElement(ArenaLobbyTitle, { name, format }));

  it('uses the stored guarantee for both standard and format-specific titles', () => {
    expect(title('Nightly 20K', { guaranteed_prize: 20000 })).toContain('20,000 Guaranteed');
    expect(
      title('Midnight Freezeout', { variant: 'freezeout', guaranteed_prize: 1500.5 })
    ).toContain('1,500.5 Guaranteed');
  });

  it('does not manufacture a guarantee from the name or a missing amount', () => {
    for (const amount of [undefined, null, 0, -5, NaN]) {
      expect(title('Nightly 20K', { guaranteed_prize: amount })).not.toContain(
        'event-title-guarantee'
      );
    }
  });
});

describe('lobby registration details', () => {
  it('retains denomination and exact fees for paid, fee-free and free events', () => {
    expect(lobbyBuyInLabel(formatBuyIn(31.5, 3.5), 'Chips')).toBe('35 Chips · 31.50 + 3.50');
    expect(lobbyBuyInLabel(formatBuyIn(10, 0), 'Diamonds')).toBe('10 Diamonds');
    expect(lobbyBuyInLabel(formatBuyIn(0, 0), 'Chips')).toBe(formatBuyIn(0, 0));
  });
  it('prints event terms in house title case', () => {
    const header = renderToStaticMarkup(
      createElement(MttEventHeader, {
        name: 'Nine-Seat Turbo',
        status: 'Registering',
        price: '35 Chips · 31.50 + 3.50',
        terms: '15,000 starting stack · 10 min levels · Late reg through Lv 10',
        onInvite: () => {},
      })
    );
    expect(header).toContain('15,000 Starting Stack · 10 Min Levels · Late Reg Through Lv 10');
  });
});
