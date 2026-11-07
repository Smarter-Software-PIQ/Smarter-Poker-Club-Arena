/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  NO PROJECTED PAYOUTS - LAW (Dan, 2026-11-07)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan, verbatim: "NEVER EVER USE 'PROJECTED PAYOUTS' ANYWHERE AND EVER. YOU
 * ONLY USE ACTUAL REAL TIME TOTALS!"
 *
 * A tournament place is priced only on the actual prize pool as it stands
 * (tournaments.prize_pool through effectivePlaceLadderPool / placePrize), or
 * on the recorded prize once paid. No surface adds the house's pending
 * overlay share to a place, prints a "Projected" column, a "Guaranteed N"
 * per-place floor, or a projected mystery bounty ladder. The live totals stay:
 * Total Prize Pool, Bounty Pool, the advertised Guarantee and the current
 * Overlay.
 *
 * Two halves:
 *   (a) every user-visible string literal, template literal and JSX text under
 *       src/ (comments and identifiers are not text a player reads, so the
 *       TypeScript AST is walked rather than the raw file) refuses the
 *       projected-payout wording;
 *   (b) the owner's worked example renders on the lobby panel and on Rewards
 *       with first place at 598 (50% of the actual 1,196 places pool) and
 *       never the 1,856 / 928 guaranteed-floor figures.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const BANNED =
  /\bProjected\b|\bProjection\b|Guaranteed Amounts|Guaranteed Figures|Estimates From The Current Prize Pool/;

function userVisibleText(file: string, source: string): string[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      out.push(node.text);
    } else if (ts.isJsxText(node)) {
      out.push(node.getText(sf));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      sourceFiles(full, acc);
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.(test|spec)\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      acc.push(full);
    }
  }
  return acc;
}

describe('no projected payouts: the words', () => {
  it('no user-visible text under src/ speaks of a projected payout', () => {
    const hits: string[] = [];
    for (const file of sourceFiles(path.join(process.cwd(), 'src'))) {
      const text = userVisibleText(file, fs.readFileSync(file, 'utf8'));
      for (const t of text) {
        if (BANNED.test(t)) hits.push(`${path.relative(process.cwd(), file)}: ${t.trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the scan sees string, template and JSX text but not comments or identifiers', () => {
    const sample = [
      '// Projected in a comment',
      '/* Projection in a block */',
      'const clubProjectedRakeback = 1;',
      "const a = 'Projected';",
      'const b = `${a} Projection`;',
      'const c = <th>Projected</th>;',
    ].join('\n');
    const text = userVisibleText('sample.tsx', sample).filter((t) => BANNED.test(t));
    expect(text.map((t) => t.trim())).toEqual(['Projected', 'Projection', 'Projected']);
  });
});

/* ── (b) the owner's worked example, rendered ───────────────────────────── */

const state = vi.hoisted(() => ({ rpcCalls: [] as string[] }));
const getTournament = vi.fn();
vi.mock('../src/services/TournamentService', () => ({
  tournamentService: { getTournament: (...args: unknown[]) => getTournament(...args) },
}));
vi.mock('../src/services/TableService', () => ({
  tableService: { getAveragePot: vi.fn(async () => null) },
}));
vi.mock('../src/services/WaitlistService', () => ({
  waitlistService: { getTableWaitlist: vi.fn(async () => []) },
}));
vi.mock('../src/services/tournamentStandingsUpdates', () => ({
  subscribeTournamentStandings: () => () => {},
}));
vi.mock('../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => {
          const result = Promise.resolve({ data: [], count: 46, error: null });
          return { is: () => result, then: result.then.bind(result) };
        },
      }),
    }),
    rpc: vi.fn((name: string, args: { p_tournament_id: string }) => {
      state.rpcCalls.push(name);
      return {
        abortSignal: () =>
          Promise.resolve({
            data: {
              tournament_id: args.p_tournament_id,
              collected: 1656,
              overlay: 660,
              gross_coverage: 1840,
              house_required: 660,
              house_posted: 0,
              house_due: 660,
            },
            error: null,
          }),
      };
    }),
  },
}));
import GameLobbyPanel from '../src/components/lobby/GameLobbyPanel';
import { tournamentEntry, type LobbyTournamentRow } from '../src/components/lobby/lobbyEntries';
import RewardsTab from '../src/components/tournament/details/RewardsTab';
import type { TournamentTabProps } from '../src/components/tournament/details/types';

afterEach(() => {
  cleanup();
  getTournament.mockReset();
  state.rpcCalls = [];
});

const STRUCTURE = [
  { place: 1, percentage: 50 },
  { place: 2, percentage: 30 },
  { place: 3, percentage: 20 },
];

/** 46 entries x (26 places + 10 bounty + 4 rake) against a 2,500 guarantee. */
const WORKED = {
  id: 'gtd-2500',
  format_contract: 'mtt-v2',
  name: '40 Chip Bounty Freezeout 2.5K',
  status: 'REGISTERING',
  start_time: '2099-11-07T01:00:00Z',
  variant: 'nlh',
  game_type: 'NLH',
  current_players: 46,
  max_players: null,
  buy_in_amount: 36,
  buy_in_fee: 4,
  is_bounty: true,
  bounty_amount: 10,
  prize_pool: 1196,
  bounty_pool: 460,
  total_rake: 184,
  guaranteed_prize: 2500,
  prize_pool_finalized: false,
  starting_chips: 10000,
  payout_structure: JSON.stringify(STRUCTURE),
};

function expectNoFloor(text: string) {
  expect(text).not.toContain('1,856');
  expect(text).not.toContain('928');
  expect(text).not.toMatch(/Guaranteed 9/);
  expect(text).not.toMatch(BANNED);
}

describe('no projected payouts: the worked example', () => {
  it('the lobby panel prices first place on the actual pool: 598, never 928', async () => {
    const raw = { ...WORKED } as unknown as LobbyTournamentRow;
    getTournament.mockResolvedValue(raw);
    const { container } = render(
      <MemoryRouter>
        <GameLobbyPanel
          entry={tournamentEntry(raw, 'mtt')}
          clubId="club"
          currentUserId="viewer"
          waitlisted={false}
          seated={false}
          registered={false}
          busy={false}
          onClose={vi.fn()}
          onJoinTable={vi.fn()}
          onWaitlistToggle={vi.fn()}
          onRegister={vi.fn()}
          onUnregister={vi.fn()}
          onSpinJoin={vi.fn()}
        />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Payouts' }));
    await waitFor(() => expect(screen.getByText('598')).toBeTruthy());
    expect(screen.getByRole('columnheader', { name: 'Prize' })).toBeTruthy();
    expect(screen.getByText('598').closest('tr')?.textContent).toContain('50%');
    expectNoFloor(container.textContent ?? '');
    // The lobby panel never reads the house's pending share at all.
    expect(state.rpcCalls).toEqual([]);
  });

  it('Rewards prices first place on the actual pool and keeps the live overlay beside the guarantee', async () => {
    const props = {
      tournament: { ...WORKED },
      entries: Array.from({ length: 46 }, (_, i) => ({
        id: `p${i}`,
        user_id: `u${i}`,
        username: `Player ${i}`,
        status: 'registered',
        chips: 10000,
      })),
      tables: [],
      blindLevels: [],
      currentUserId: 'viewer',
      isRegistered: false,
    } as unknown as TournamentTabProps;
    const { container } = render(<RewardsTab {...props} />);
    await waitFor(() => expect(container.textContent).toContain('660 Overlay'));
    expect(container.querySelector('.rw-prize')?.textContent).toBe('598');
    expectNoFloor(container.textContent ?? '');
  });
});
