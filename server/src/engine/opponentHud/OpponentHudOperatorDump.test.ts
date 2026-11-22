/**
 * OPERATOR TOOL (owner 3:20 PM Nov 20; lane OPPONENT-HUD-4): scripts/opponent-hud-dump.ts prints what the Horses know
 * about any player (person or Horse, one path), from public history only. This test runs the real script on a
 * profile built from hands whose rows carry dealt cards, and checks what it prints.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyHudHand,
  emptyHudProfile,
  handRecordFromRow,
  type HudHandRecord,
} from './OpponentHudProfile.js';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SERVER = fileURLToPath(new URL('../../../', import.meta.url));

describe('operator tool: what the Horses know about a player', () => {
  it('prints his lifetime hands, every statistic with evidence, his session, recall and latest spots; never a card', () => {
    const p = emptyHudProfile(U(1), 'plo5');
    for (let i = 0; i < 6; i++) {
      const row = {
        id: `50000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        created_at: new Date(1_800_000_000_000 + i * 60_000).toISOString(),
        game_variant: 'plo5',
        tournament_id: null,
        big_blind: 2,
        button_seat: 2,
        players: [
          { seat: 1, userId: U(1), stack: 400, holeCards: ['As', 'Ks', 'Qs', 'Js', 'Ts'] },
          { seat: 2, userId: U(2), stack: 400, hole_cards: ['2c', '3c', '4c', '5c', '7d'] },
        ],
        actions: [
          { seat: 2, userId: U(2), stage: 'preflop', action: 'sb', amount: 1 },
          { seat: 1, userId: U(1), stage: 'preflop', action: 'bb', amount: 2 },
          { seat: 2, userId: U(2), stage: 'preflop', action: 'call', amount: 1 },
          { seat: 1, userId: U(1), stage: 'preflop', action: 'check', amount: 0 },
          { seat: 1, userId: U(1), stage: 'flop', action: 'check', amount: 0 },
          { seat: 2, userId: U(2), stage: 'flop', action: 'bet', amount: 2 },
          {
            seat: 1,
            userId: U(1),
            stage: 'flop',
            action: i % 2 ? 'call' : 'fold',
            amount: i % 2 ? 2 : 0,
          },
        ],
        community_cards: ['Ah', '7d', '2c'],
        showdown: [],
        winners: [{ userId: U(2), amount: 6 }],
      };
      expect(applyHudHand(p, handRecordFromRow(row) as HudHandRecord)).toBeNull();
    }
    const dir = mkdtempSync(join(tmpdir(), 'hud-dump-'));
    const file = join(dir, 'profiles.json');
    writeFileSync(file, JSON.stringify({ profiles: [p], summary: { priors: { plo5: {} } } }));
    const run = (user: string) =>
      execFileSync(
        process.execPath,
        [
          join(SERVER, 'node_modules/tsx/dist/cli.mjs'),
          'scripts/opponent-hud-dump.ts',
          user,
          'plo5',
          '--file',
          file,
        ],
        { cwd: SERVER, encoding: 'utf8', timeout: 60_000 }
      );
    const out = run(U(1));
    expect(out).toContain(`OPPONENT HUD plo5 ${U(1)}  lifetime hands 6`);
    expect(out).toMatch(/hands counted on the listed days[^\n]*: 6/);
    expect(out).toContain('current session (responses to a first wager): 6 responses, 3 folds');
    expect(out).toMatch(/f\.fb\.sm\.hu\s+0\.500\s+6/);
    expect(out).toMatch(/pf\.vpip/);
    // public information only: no dealt card of either player appears
    expect(out).not.toMatch(/\b(As|Ks|Qs|Js|Ts|2c|3c|4c|5c)\b/);
    expect(run(U(3))).toContain('the Horses read him at the population prior');
  }, 120_000);
});
