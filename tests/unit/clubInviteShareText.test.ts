/**
 * The copied invitation names what each figure measures (Dan 2026-11-17).
 *
 * The figure lines come from fn_club_share_figures (see
 * clubInviteFiguresNameTheirScope.pg.test.ts); the client only places them,
 * and leaves a line out when the figure was not available.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inviteShareText, parseInviteFigures } from '../../src/services/ClubInviteService';

const ROOT = resolve(__dirname, '../..');

describe('copied club invitation', () => {
  it('carries the two disclosed Kings Club totals above the measured union line', () => {
    const figures = parseInviteFigures({
      members: 152,
      players_playing: 314,
      members_line: '1,652 KINGS CLUB Member Display Total (+1,500 Configured)',
      club_active_display_line: '146 KINGS CLUB Active Display Total (+145 Configured)',
      activity_line: '314 Players Across Midway Union Now · Includes Horses',
    });
    expect(inviteShareText('KingFish', 'KINGS CLUB', 25450, figures)).toBe(
      [
        'KingFish Invited You To Join KINGS CLUB On Smarter.Poker!',
        'Club ID: 25450',
        '1,652 KINGS CLUB Member Display Total (+1,500 Configured)',
        '146 KINGS CLUB Active Display Total (+145 Configured)',
        '314 Players Across Midway Union Now · Includes Horses',
      ].join('\n')
    );
  });

  it('a club with no union carries its own club-scoped line', () => {
    const figures = parseInviteFigures({
      members_line: '9 Members In Solo Room',
      activity_line: '2 Playing In Solo Room Now',
    });
    expect(inviteShareText('Ana', 'Solo Room', 1, figures).split('\n').slice(2)).toEqual([
      '9 Members In Solo Room',
      '2 Playing In Solo Room Now',
    ]);
  });

  it('leaves out an unavailable figure instead of printing a zero', () => {
    const figures = parseInviteFigures({
      members_line: '152 Members In KINGS CLUB',
      activity_line: null,
    });
    const text = inviteShareText('KingFish', 'KINGS CLUB', 25450, figures);
    expect(text).not.toMatch(/Playing/);
    expect(text).not.toMatch(/\b0\b/);
    expect(parseInviteFigures(null)).toBeNull();
    expect(parseInviteFigures({ members_line: '', activity_line: 5 })).toBeNull();
    expect(inviteShareText('KingFish', 'KINGS CLUB', 25450, null)).toBe(
      'KingFish Invited You To Join KINGS CLUB On Smarter.Poker!\nClub ID: 25450'
    );
  });

  it('the share sheet sends the figures the link came with', () => {
    const sheet = readFileSync(resolve(ROOT, 'src/components/club/ShareInviteSheet.tsx'), 'utf8');
    expect(sheet).toContain(
      'inviteShareText(inviterAlias, clubName, clubNumber, link?.figures ?? null)'
    );
  });

  it('the card consumes the display totals and discloses each addition', () => {
    const card = readFileSync(resolve(ROOT, 'src/components/club/ClubCardPanel.tsx'), 'utf8');
    const home = readFileSync(resolve(ROOT, 'src/pages/HomePage.tsx'), 'utf8');
    expect(home).toContain("rpc('fn_kings_club_display_totals')");
    expect(card).toContain('kingsDisplayTotals?.member_total');
    expect(card).toContain('kingsDisplayTotals?.active_total');
    expect(card).toContain('MEMBER DISPLAY TOTAL');
    expect(card).toContain('ACTIVE DISPLAY TOTAL');
    expect(card).toContain('member_addition.toLocaleString()} CONFIGURED');
    expect(card).toContain('active_addition.toLocaleString()} CONFIGURED');
  });
});
