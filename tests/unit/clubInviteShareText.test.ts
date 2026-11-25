/**
 * The copied invitation names what each figure measures (Dan 2026-11-17).
 *
 * The figure lines come from fn_club_share_figures (see
 * clubInviteFiguresNameTheirScope.pg.test.ts); the client only places them,
 * and leaves a line out when the figure was not available.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClubCardPanel } from '../../src/components/club/ClubCardPanel';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inviteShareText, parseInviteFigures } from '../../src/services/ClubInviteService';

const ROOT = resolve(__dirname, '../..');

describe('copied club invitation', () => {
  it('formats the referral copy cleanly with only headline and member/active counts', () => {
    const figures = parseInviteFigures({
      members: 165,
      players_playing: 162,
      members_line: '1,665 KINGS CLUB Member Display Total (+1,500 Configured)',
      club_active_display_line: '145 KINGS CLUB Active Display Total (+145 Configured)',
      activity_line: '162 Players Across Midway Union Now · Includes Horses',
    });
    expect(inviteShareText('KingFish', 'KINGS CLUB', 25450, figures)).toBe(
      'KingFish Invited You To Join KINGS CLUB On Smarter.Poker! Currently 1665 Members 145 Active'
    );
  });

  it('a club with no union formats its own member and active counts cleanly', () => {
    const figures = parseInviteFigures({
      members_line: '9 Members In Solo Room',
      activity_line: '2 Playing In Solo Room Now',
    });
    expect(inviteShareText('Ana', 'Solo Room', 1, figures)).toBe(
      'Ana Invited You To Join Solo Room On Smarter.Poker! Currently 9 Members 2 Active'
    );
  });

  it('leaves out an unavailable figure instead of printing a zero', () => {
    const figures = parseInviteFigures({
      members_line: '152 Members In KINGS CLUB',
      activity_line: null,
    });
    const text = inviteShareText('KingFish', 'KINGS CLUB', 25450, figures);
    expect(text).toBe(
      'KingFish Invited You To Join KINGS CLUB On Smarter.Poker! Currently 152 Members'
    );
    expect(text).not.toMatch(/Active|Club ID|Configured|Includes Horses/);
    expect(text).not.toMatch(/\b0\b/);
    expect(parseInviteFigures(null)).toBeNull();
    expect(parseInviteFigures({ members_line: '', activity_line: 5 })).toBeNull();
    expect(inviteShareText('KingFish', 'KINGS CLUB', 25450, null)).toBe(
      'KingFish Invited You To Join KINGS CLUB On Smarter.Poker!'
    );
  });

  it('the share sheet sends the figures the link came with', () => {
    const sheet = readFileSync(resolve(ROOT, 'src/components/club/ShareInviteSheet.tsx'), 'utf8');
    expect(sheet).toContain(
      'inviteShareText(inviterAlias, clubName, clubNumber, link?.figures ?? null)'
    );
  });

  it('the Kings Club card uses the adjusted totals and shows only the three stats', () => {
    const home = readFileSync(resolve(ROOT, 'src/pages/HomePage.tsx'), 'utf8');
    expect(home).toContain('readKingsClubDisplayTotals()');
    const join = readFileSync(resolve(ROOT, 'src/services/ClubJoinService.ts'), 'utf8');
    expect(join).toContain('readKingsClubDisplayTotals()');
    const props = {
      totalMembers: 152,
      clubLevel: 19,
      activePlayers: 2,
      activeCash: 144,
      activeEvents: 432,
      splitFloorLabel: 'MIDWAY UNION',
      floorPlaying: 505,
    };
    const kings = renderToStaticMarkup(
      createElement(ClubCardPanel, {
        ...props,
        clubName: 'KINGS CLUB',
        clubId: 25450,
        kingsDisplayTotals: {
          member_total: 1652,
          active_total: 147,
          member_addition: 1500,
          active_addition: 145,
        },
      })
    );
    for (const label of ['MEMBERS', 'LEVEL', 'ACTIVE']) expect(kings).toContain('>' + label + '<');
    for (const value of ['1,652', '19', '147']) expect(kings).toContain('>' + value + '<');
    expect(kings).not.toMatch(/CONFIGURED|MIDWAY UNION|INCLUDES HORSES|144 CASH|432 EVENTS/);

    const other = renderToStaticMarkup(
      createElement(ClubCardPanel, { ...props, clubName: 'OTHER CLUB', clubId: 12 })
    );
    expect(other).toContain('505 PLAYERS ACTIVE ACROSS THE MIDWAY UNION');
    expect(other).not.toContain('INCLUDES HORSES');
    expect(other).toContain('144 CASH');
    expect(other).toContain('432 EVENTS');
  });
});
