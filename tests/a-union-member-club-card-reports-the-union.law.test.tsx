import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup } from '@testing-library/react';
import { ClubCardPanel } from '@/components/club/ClubCardPanel';
import { resetLobbyFigureCacheForTests } from '@/lib/lobbyFigureCache';
import { clubCardActiveSource, storedCardActiveSource } from '@/lib/clubCardActiveSource';
import { SHARK_CLUB_ID } from '@/lib/constants';

/**
 * Dan, 2026-11-26: "THE KINGS CLUB 'ACTIVE' NUMBER SHOULD DISPLAY HOW MANY
 * PLAYERS ARE ACTIVE INSIDE THE MIDWAY UNION, NOT JUST INSIDE THE CLUB. ONCE A
 * CLUB 'JOINS THE UNION' THERE CLUB DATA SHOULD REPORT WHATS 'LIVE IN THE
 * UNION' AT THAT MOMENT. IT SHOULD NO LONGER DISPLAY THERE CLUB DATA BY
 * DEFAULT. THEY CAN CHANGE IT IN THE CLUB SETTINGS IF THEY WANT TO DISPLAY
 * THERE REAL TIME CLUB DATA, OVER UNION DATA."
 */
const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('a union member club card reports the union by default', () => {
  beforeEach(() => {
    resetLobbyFigureCacheForTests();
    cleanup();
  });

  it('the rule: in a union means union, unless the club chose club', () => {
    expect(clubCardActiveSource({ union_id: 'u', settings: {} })).toBe('union');
    expect(clubCardActiveSource({ union_id: 'u', settings: null })).toBe('union');
    expect(clubCardActiveSource({ union_id: 'u', settings: { card_active_source: 'union' } })).toBe(
      'union'
    );
    expect(clubCardActiveSource({ union_id: 'u', settings: { card_active_source: 'club' } })).toBe(
      'club'
    );
    expect(clubCardActiveSource({ union_id: null, settings: {} })).toBe('club');
    expect(storedCardActiveSource({ card_active_source: 'nonsense' })).toBeNull();
  });

  it('a member club card prints the union total and names the union', () => {
    render(
      <ClubCardPanel
        clubName="HARBOR"
        totalMembers={146}
        clubLevel={19}
        activePlayers={601}
        activeCash={222}
        activeEvents={243}
        clubId={25453}
        splitFloorLabel="MIDWAY UNION"
        floorPlaying={601}
        activeSource="union"
      />
    );
    expect(
      document.querySelector('.club-card-stat--active .club-card-stat-value')?.textContent
    ).toBe('601');
    expect(document.querySelector('.club-card-stat-split-floor')?.textContent).toBe(
      'LIVE ACROSS THE MIDWAY UNION'
    );
  });

  it('Kings Club prints its union total and names the union', () => {
    render(
      <ClubCardPanel
        clubName="KINGS CLUB"
        totalMembers={173}
        clubLevel={20}
        activePlayers={3}
        clubId={SHARK_CLUB_ID}
        kingsDisplayTotals={{
          member_total: 1673,
          active_total: 601,
          member_addition: 1500,
          active_addition: 0,
          active_source: 'union',
          active_union_name: 'Midway Union',
        }}
      />
    );
    expect(
      document.querySelector('.club-card-stat--active .club-card-stat-value')?.textContent
    ).toBe('601');
    expect(document.querySelector('.club-card-stat-split-floor')?.textContent).toBe(
      'LIVE ACROSS THE MIDWAY UNION'
    );
  });

  it('the home page makes the union floor the ACTIVE total unless the club chose club', () => {
    const src = read('src/pages/HomePage.tsx');
    expect(src).toMatch(/'id, union_id, settings, member_count/);
    expect(src).toMatch(/clubCardActiveSource\(row\) !== 'union'/);
    expect(src).toMatch(/activePlayers: unionPlaying, activeSource: 'union'/);
  });

  it('the server applies the same default to Kings Club and offers a settings door', () => {
    const dir = resolve(root, 'supabase/migrations');
    const sql = read(
      'supabase/migrations/20261126190606_club_card_active_shows_union_floor_by_default.sql'
    );
    expect(dir).toBeTruthy();
    expect(sql).toMatch(/COALESCE\(c\.settings->>'card_active_source', 'union'\) <> 'club'/);
    expect(sql).toMatch(/fn_batch_union_floor_players\(ARRAY\[v_union\]\)/);
    expect(sql).toMatch(
      /FUNCTION public\.fn_set_club_card_active_source\(p_club_id uuid, p_source text\)/
    );
    expect(sql).toMatch(/fn_can_manage_club_message\(p_club_id, v_uid\)/);
  });

  it('club settings offers the switch to a union member club', () => {
    const src = read('src/pages/ClubSettingsPage.tsx');
    expect(src).toMatch(/Show Club Data Instead Of Union Data/);
    expect(src).toMatch(/fn_set_club_card_active_source/);
  });
});
