/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EVERY PROJECTED PLACE SHOWS ITS GUARANTEED MINIMUM - LAW (2026-11-07)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * While registration is open on a guaranteed event, each projected place
 * shows the minimum the house underwrites: the ladder priced on places plus
 * the house share still due (max(0, GTD - (places + bounties + rake)), less
 * anything already posted). On 2026-11-07 RewardsTab did this and three other
 * surfaces priced the same place on the places-only ladder, so one event read
 * 1,196 and "Guaranteed 1,856" on Rewards and plain 1,196 everywhere else.
 *
 * The cure is one hook (useTournamentPrizeFunding, the only caller of
 * fn_ca_tournament_prize_funding in the client) and one helper
 * (pendingHouseShare). This law pins that every surface which projects a
 * place uses both, and that none re-implements the RPC read or the
 * arithmetic on its own.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pendingHouseShare } from '../src/utils/tournamentPrizeFunding';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SURFACES = [
  'src/components/lobby/GameLobbyPanel.tsx',
  'src/components/tournament/TournamentInfoPanel.tsx',
  'src/pages/TournamentPage.tsx',
  'src/components/tournament/details/RewardsTab.tsx',
];
const HOOK = 'src/hooks/useTournamentPrizeFunding.ts';

describe('every projected place shows its guaranteed minimum', () => {
  it.each(SURFACES)('%s reads funding through the shared hook', (file) => {
    const src = code(read(file));
    expect(src).toMatch(
      /import \{[^}]*useTournamentPrizeFunding[^}]*\} from ['"][^'"]*hooks\/useTournamentPrizeFunding['"]/
    );
    expect(src).toMatch(/useTournamentPrizeFunding\(/);
    expect(src).toMatch(/pendingHouseShare\(/);
    // The floor is priced by the one ladder rule, on places + house share.
    expect(src).toMatch(/effectivePlaceLadderPool\(\s*[^;]*[pP]endingHouse/);
    expect(src).toMatch(/Guaranteed\s*\{/);
  });

  it.each(SURFACES)('%s does not call the funding RPC on its own', (file) => {
    expect(code(read(file))).not.toContain('fn_ca_tournament_prize_funding');
  });

  it('the hook is the only client caller of fn_ca_tournament_prize_funding', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          if (code(fs.readFileSync(full, 'utf8')).includes('fn_ca_tournament_prize_funding')) {
            hits.push(path.relative(process.cwd(), full));
          }
        }
      }
    };
    walk(path.join(process.cwd(), 'src'));
    expect(hits).toEqual([HOOK]);
  });

  it('the hook keeps the abort, deadline, realtime refresh and key invalidation', () => {
    const src = code(read(HOOK));
    expect(src).toContain('runWithRequestDeadline');
    expect(src).toContain('subscribeTournamentStandings');
    expect(src).toContain('AbortController');
    expect(src).toMatch(/funding\?\.key === fundingKey \? funding : null/);
    // No fetch without a guarantee.
    expect(src).toMatch(/!\(Number\(guaranteedPrize\) > 0\)\) return/);
  });

  it('the pending house share is one rule: house_due first, else required minus posted, else overlay', () => {
    // The owner example: 46 x 40 against 2,500 owes 660. A Free Buy that
    // already posted 155 of a 250 requirement still adds only 95.
    expect(pendingHouseShare({ houseDue: 660, houseRequired: 660, housePosted: 0, overlay: 660 })).toBe(660);
    expect(pendingHouseShare({ houseDue: null, houseRequired: 250, housePosted: 155, overlay: 250 })).toBe(95);
    expect(pendingHouseShare({ houseDue: null, houseRequired: null, housePosted: null, overlay: 40 })).toBe(40);
    expect(pendingHouseShare(null)).toBe(0);
  });
});
