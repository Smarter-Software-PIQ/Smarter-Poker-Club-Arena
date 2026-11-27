/**
 * Dan, 2026-11-27: "INSURE THINGS AREN'T CUT OFF ON THE BOTTOM." The rendered
 * proof is tests/e2e/css/club-members-containment.spec.ts, which draws every
 * card at the pitch rosterCardPitchFor returns and fails if any line leaves
 * the card. This pins the wiring that proof depends on.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ROSTER_CARD_PITCH_DEFAULT,
  ROSTER_CARD_PITCH_TIERS,
  rosterCardPitchFor,
} from '../../src/lib/rosterCardPitch';

const root = resolve(__dirname, '../..');
const PAGE = readFileSync(resolve(root, 'src/pages/ClubMembersPage.tsx'), 'utf8');
const SPEC = readFileSync(resolve(root, 'tests/e2e/css/club-members-containment.spec.ts'), 'utf8');
const CSS = readFileSync(resolve(root, 'src/components/lobby/ArenaWorkspace.css'), 'utf8');

describe('a player card is never cut off', () => {
  it('sizes every card from the viewport pitch the containment spec renders', () => {
    expect(PAGE).toMatch(/const rowHeight = useRosterCardPitch\(\);/);
    expect(PAGE).toMatch(/'--member-row-pitch': `\$\{rowHeight\}px`/);
    expect(SPEC).toContain('--member-row-pitch:${rosterCardPitchFor(width)}px');
    // The spec checks the seated table line and the online status too: the
    // table name is the line that ran off the bottom of the card.
    expect(SPEC).toMatch(/\.member-online, \.member-seated,/);
  });

  it('gives the status line the full card width', () => {
    expect(CSS).toMatch(/\.club-members-page \.member-subline \{\s*grid-area: 3 \/ 1 \/ 4 \/ 3;/);
  });

  it('only ever grows the card on a narrower screen', () => {
    const widths = [320, 340, 341, 360, 361, 400, 401, 480, 481, 768, 1440];
    for (let i = 1; i < widths.length; i += 1) {
      const narrower = rosterCardPitchFor(widths[i - 1]);
      const wider = rosterCardPitchFor(widths[i]);
      if (widths[i] > 480) continue;
      expect(narrower).toBeGreaterThanOrEqual(wider);
    }
    expect(rosterCardPitchFor(Number.NaN)).toBe(ROSTER_CARD_PITCH_DEFAULT);
    expect(ROSTER_CARD_PITCH_TIERS.map((t) => t.maxWidth)).toEqual(
      [...ROSTER_CARD_PITCH_TIERS.map((t) => t.maxWidth)].sort((a, b) => a - b)
    );
  });
});
