// @vitest-environment happy-dom
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A PLAYER IS ONLY EVER SHOWN THEIR OWN RESULT (Dan 2026-11-09)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan, with a screenshot of a finished heads-up match: "in heads up, the loser
 * received a Champion and prize 38 even though they lost."
 *
 * The cause was in `announceSpectatorChampion` (TablePage.tsx). That function
 * was written for a SPECTATOR - it reads the committed `position = 1` row and
 * announces who won - and it is also the path a PARTICIPANT takes once the
 * tournament commits, with their own finish passed in as `participant`. Both
 * set the same winner state: the champion's name, the champion's prize, and NO
 * position. `TournamentWinnerOverlay` defaults `position` to 1, so the player
 * who had just lost was shown "Champion! / 1st Place / <the winner> /
 * Prize: <the winner's prize>".
 *
 * Two halves, pinned separately because either can be reintroduced alone:
 *
 *   1. the OVERLAY must not print a champion's face for a finish that is not
 *      first, and must print the figures it is given rather than a default;
 *   2. the CALL SITE must choose the announcement from the viewer's own
 *      result, and must not celebrate an unpaid loss at all.
 *
 * The second half reads source rather than rendering it, for the reason the
 * HUD-slot law gives: `LiveTablePage` is a 30,000-line component behind a
 * realtime subscription, and the branch that matters is three awaits inside a
 * closure. What can be asserted about it honestly is that the branch exists,
 * that it reads the participant's own numbers, and that the champion's name
 * cannot reach a paid finish.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import TournamentWinnerOverlay from '../src/components/table/TournamentWinnerOverlay';
import { CHIP_UNIT_CENTS } from '../server/src/tournament/tournamentUnit';

afterEach(cleanup);

const base = {
  isWinner: true,
  unitCents: CHIP_UNIT_CENTS,
  tournamentName: 'NLH Heads-Up 20',
  onDismiss: vi.fn(),
};

describe('the overlay never calls a runner-up the champion', () => {
  it('prints the paid-finish face, their own place and their own prize', () => {
    render(<TournamentWinnerOverlay {...base} prize={12} position={2} />);
    expect(screen.getByText(/Paid Finish/i)).toBeTruthy();
    expect(screen.getByText(/Second Place/i)).toBeTruthy();
    expect(screen.queryByText(/^Champion!?$/i)).toBeNull();
    expect(screen.queryByText(/1st Place/i)).toBeNull();
  });

  it('never prints the champion name beside a finish that is not first', () => {
    // The screenshot's exact shape: the winner's name carried into the card a
    // losing player is looking at.
    render(<TournamentWinnerOverlay {...base} prize={0} position={2} championName="Danny" />);
    expect(screen.queryByText('Danny')).toBeNull();
  });

  it('still celebrates an actual champion', () => {
    render(<TournamentWinnerOverlay {...base} prize={38} position={1} championName="Danny" />);
    expect(screen.getByText(/Champion/i)).toBeTruthy();
    expect(screen.getByText(/1st Place/i)).toBeTruthy();
    expect(screen.getByText('Danny')).toBeTruthy();
  });
});

describe('the table announces the viewer own result, not the champion row', () => {
  const TABLE_PAGE = readFileSync(resolve(process.cwd(), 'src/pages/TablePage.tsx'), 'utf8');

  it('derives the finish and the prize from the participant, not from the champion', () => {
    expect(TABLE_PAGE).toMatch(
      /const myFinish = participant \? Number\(participant\.position\) : null;/
    );
    expect(TABLE_PAGE).toMatch(
      /const myPrize = participant \? Number\(participant\.prize\) \|\| 0 : 0;/
    );
    // A participant's announced prize is theirs. The champion's `prize` is
    // only ever announced to somebody with no result of their own.
    expect(TABLE_PAGE).toMatch(/else if \(participant\) announcedPrize = myPrize;/);
  });

  it('does not celebrate a losing participant who was paid nothing', () => {
    expect(TABLE_PAGE).toMatch(/const iCashed = myFinish != null && myFinish > 1 && myPrize > 0;/);
    expect(TABLE_PAGE).toMatch(
      /const celebrates = !participant \|\| !!qualifiers \|\| iWon \|\| iCashed;/
    );
    // ...and they are not held in front of somebody else's trophy for the
    // champion dwell on their way out.
    expect(TABLE_PAGE).toMatch(/celebrates \? TOURNAMENT_CHAMPION_DISPLAY_MS : 2500/);
  });

  it('keeps the champion name off a paid finish at the call site too', () => {
    expect(TABLE_PAGE).toMatch(
      /championName:\s*\n?\s*qualifiers \|\| iCashed \? undefined : champion\?\.username \|\| 'Champion',/
    );
  });
});
