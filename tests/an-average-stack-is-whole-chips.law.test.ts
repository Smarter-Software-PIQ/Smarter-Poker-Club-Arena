/**
 * AN AVERAGE STACK IS WHOLE CHIPS (Dan 2026-11-14, binding).
 *
 * Verbatim: "AVG STACK SHOULDN'T USE DECIMALS, THATS THE ONLY NUMBER THAT
 * SHOULDN'T. CHIP STACK COUNTS AND 'AVERAGES' USE WHOLE NUMBERS EVERYWHERE."
 * It was reported off a Ranking tab reading "7,694.8051948052 / 9 BB".
 *
 * Every average stack is truncated to whole chips where it is computed and
 * again where it is shown, so an average another component supplies cannot
 * carry decimals either. Tournament stack figures (stacks, chips in play, the
 * gap to the leader) print through stackChips. Money keeps its cents: this
 * rule is the one exception to "exact figures always".
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stackChips } from '../src/components/tournament/details/types';
import { lobbyTableChips } from '../src/services/cashGameLobby';

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.spec\./.test(name)) out.push(path);
  }
  return out;
}

describe('an average stack is whole chips', () => {
  it('stack figures print whole chips, truncated, never rounded up', () => {
    expect(stackChips(7694.8051948052)).toBe('7,694');
    expect(stackChips(1999.99)).toBe('1,999');
    expect(stackChips(235000)).toBe('235,000');
    expect(stackChips(22.9)).toBe('22');
    expect(stackChips(null)).toBe('0');
  });

  it('a cash lobby average is whole while its total keeps the cents', () => {
    const seat = (n: number, stack: number) => ({
      seat_number: n,
      user_id: `u${n}`,
      alias: null,
      stack,
      is_sitting_out: false,
      joined_game_at: null,
    });
    expect(lobbyTableChips({ seats: [seat(1, 30), seat(2, 12.5)] })).toEqual({
      total: 42.5,
      average: 21,
      players: 2,
    });
  });

  it('no source computes an average stack by division without truncating it', () => {
    const division = /(avg|average)[A-Za-z]*\s*[:=][^;=\n]*[^/\n]\/[^/*\n]/i;
    const offenders: string[] = [];
    for (const file of sources(join(ROOT, 'src'))) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!/stack|average\s*:/i.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
          if (division.test(line) && !/Math\.trunc/.test(line))
            offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('every average stack is truncated where it is shown', () => {
    expect(read('src/components/tournament/details/RankingTab.tsx')).toContain(
      "{isRegistering && !totalChips ? '-' : stackChips(avgStack)}"
    );
    const tables = read('src/components/tournament/details/TablesTab.tsx');
    expect(tables).toContain('{stackChips(fieldAvg)}');
    expect(tables).toContain("{hasStacks ? stackChips(avgStack) : '-'}");
    expect(tables).toContain('avgStack: hasStacks ? Math.trunc(total / stacks.length) : 0,');
    expect(read('src/components/tournament/details/DetailOverviewTab.tsx')).toContain(
      'value: stackChips(field.avgStack),'
    );
    expect(read('src/components/tournament/TournamentHUD.tsx')).toContain(
      'averageStack !== undefined ? Math.trunc(averageStack)'
    );
    expect(read('src/components/table/TournamentBreakScreen.tsx')).toContain(
      'const averageStack = Math.trunc('
    );
    expect(read('src/components/table/MustMoveLobbyModal.tsx')).toContain(
      '{formatAverageStack(lobbyTableChips(t).average)}'
    );
    expect(read('src/components/tournament/TournamentClock.tsx')).toContain(
      'Math.trunc(totalChips / playersRemaining)'
    );
    expect(read('src/components/tournament/TournamentInfoPanel.tsx')).toMatch(
      /avg: stacks\.length \? Math\.trunc\(/
    );
  });
});
