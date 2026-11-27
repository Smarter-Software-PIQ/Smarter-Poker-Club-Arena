/**
 * THE STATS PAGE SAYS WHAT IT MEASURED (Stats contract truth, 2026-09-20).
 *
 * Render tests for the tab chunks, each pinned to one demonstrated defect:
 *
 *   - a rate over an empty sample printed a confident zero (BB/100 with no
 *     cash hands, Showdown Win % with no showdowns, ITM % with no entries,
 *     ROI with no buy-ins, Aggression Factor with no hands);
 *   - one grid mixed cash-only money with counts over every hand and did not
 *     say which was which;
 *   - Notable Hands is all-time on a range-scoped page and did not say so;
 *   - the Rake tab rendered a failed read as an empty ledger.
 *
 * Since 2026-11-27 the grids carry no per-box mode tag: the page reads the
 * separated RPC, which counts only the selected game mode, and the Cash Games /
 * Tournaments switch states it once. The SQL scanner below still pins the
 * legacy ca_player_stats_full split it documented.
 */
import { Suspense, type ReactNode } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── Panels the tabs lazy-load. Stubbed: these tests are about the grids. ──
vi.mock('../../src/components/stats/NemesisPanel', () => ({ default: () => null }));
vi.mock('../../src/components/stats/BenchmarkPanel', () => ({ default: () => null }));
vi.mock('../../src/components/stats/StatsShareCard', () => ({ default: () => null }));
vi.mock('../../src/components/stats/EVLuckChart', () => ({ default: () => null }));
vi.mock('../../src/components/stats/StatsCharts', () => ({ default: () => null }));
vi.mock('../../src/components/stats/BankrollTracker', () => ({ default: () => null }));
vi.mock('../../src/components/stats/SessionHistory', () => ({ default: () => null }));
vi.mock('../../src/components/stats/AdvancedStatsSummary', () => ({ default: () => null }));
vi.mock('../../src/components/stats/LeakPanel', () => ({ default: () => null }));
vi.mock('../../src/components/agent/DownlineRakePanel', () => ({
  default: ({ liveRevision, viewerId }: { liveRevision?: number; viewerId?: string }) => (
    <div data-live-revision={liveRevision} data-viewer-id={viewerId}>
      Downline Panel Rendered
    </div>
  ),
}));

import OverviewTab from '../../src/pages/stats/OverviewTab';
import PerformanceTab from '../../src/pages/stats/PerformanceTab';
import TournamentsTab from '../../src/pages/stats/TournamentsTab';
import AnalysisTab from '../../src/pages/stats/AnalysisTab';
import RakeTab from '../../src/pages/stats/RakeTab';
import { NOT_YET_MEASURED, ratioOrUnmeasured } from '../../src/pages/stats/format';
import type { OverallStats, TournamentSummary } from '../../src/pages/stats/types';
import type { PlayerRakeStats } from '../../src/services/StatsFactsService';

afterEach(() => cleanup());

// ── Fixtures ────────────────────────────────────────────────────────────────

const OVERALL: OverallStats = {
  total_hands: 20_000,
  cash_hands: 18_000,
  tourney_hands: 2_000,
  tournaments_with_hands: 12,
  hands_won: 4_200,
  hands_lost: 15_800,
  vpip: 0.41,
  pfr: 0.09,
  three_bet_percent: 0.04,
  fold_to_three_bet: 0.81,
  cbet_flop: 0.91,
  aggression_factor: 0.7,
  showdowns_total: 1_200,
  showdowns_won: 430,
  wtsd: 0.06,
  total_profit: -9_000,
  total_winnings: 40_000,
  total_invested: 49_000,
  biggest_pot_won: 2_500,
  biggest_hand_loss: -1_800,
  bb_per_100: -22.5,
  hours_played: 61.5,
  hand_cap: 25_000,
  hands_capped: false,
};

/** A player whose only record is tournament play: no cash hands, no showdowns. */
const TOURNAMENT_ONLY: OverallStats = {
  ...OVERALL,
  total_hands: 0,
  cash_hands: 0,
  tourney_hands: 0,
  hands_won: 0,
  hands_lost: 0,
  vpip: 0,
  pfr: 0,
  aggression_factor: 0,
  showdowns_total: 0,
  showdowns_won: 0,
  wtsd: 0,
  total_profit: 0,
  total_winnings: 0,
  total_invested: 0,
  biggest_pot_won: 0,
  biggest_hand_loss: 0,
  bb_per_100: 0,
  hours_played: 0,
};

const TOURN: TournamentSummary = {
  entries: 11,
  cashes: 4,
  wins: 1,
  best_finish: 1,
  itm_percent: 0.3636,
  total_buyins: 1_100,
  total_winnings: 2_300,
  total_prizes: 2_000,
  total_bounty_winnings: 300,
  total_bounties: 3,
  net_profit: 1_200,
  roi: 1.0909,
};

/** The page's own derivation, so a tab test cannot drift from it. */
const showdownRate = (o: OverallStats) =>
  ratioOrUnmeasured(
    (o.showdowns_won / o.showdowns_total) * 100,
    o.showdowns_total,
    (v) => `${v.toFixed(1)}%`
  );

function overview(overall: OverallStats) {
  return (
    <Suspense fallback={null}>
      <OverviewTab
        overall={overall}
        full={null}
        rangeKey="all"
        rangeLabel="All"
        showdownWinRate={showdownRate(overall)}
        handsWonPct={overall.total_hands > 0 ? (overall.hands_won / overall.total_hands) * 100 : 0}
        isOwnProfile={false}
        panelResetKey="k"
        targetUserId="user-1"
        windowDays={null}
        user={null}
        shareStyle={null}
        printing={false}
        printDossier={() => {}}
        openHandEvidence={() => {}}
      />
    </Suspense>
  );
}

function performance(overall: OverallStats) {
  return (
    <Suspense fallback={null}>
      <PerformanceTab
        overall={overall}
        showdownWinRate={showdownRate(overall)}
        isOwnProfile={false}
        panelResetKey="k"
        targetUserId="user-1"
        windowDays={null}
        printing={false}
      />
    </Suspense>
  );
}

interface Row {
  label: string;
  /** Every caption under the label (sample evidence; never a mode tag). */
  tags: string[];
  value: string;
}

/** Every StatRow in the container: its label, its captions, and its value. */
function rows(container: HTMLElement): Row[] {
  return [...container.querySelectorAll('.stat-row')].map((row) => {
    const labelEl = row.querySelector('.row-label') as HTMLElement;
    const label = labelEl.querySelector('.stat-label-text')?.textContent?.trim() ?? '';
    return {
      label,
      tags: [...labelEl.querySelectorAll('.hero-stat-sub')].map((el) => el.textContent ?? ''),
      value: row.querySelector('.row-value')?.textContent ?? '',
    };
  });
}

function row(container: HTMLElement, label: string): Row {
  const found = rows(container).filter((r) => r.label === label);
  expect(found, `rows labelled ${label}`).toHaveLength(1);
  return found[0];
}

async function mounted(ui: ReactNode): Promise<HTMLElement> {
  const { container } = render(<>{ui}</>);
  await screen.findAllByText('VPIP', undefined, { timeout: 4_000 }).catch(() => undefined);
  return container;
}

// ── The SQL, read from the migration that defines it ───────────────────────

const MIGRATIONS = resolve(__dirname, '../../supabase/migrations');
const CREATES_FULL = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.ca_player_stats_full\s*\(/i;

/* The newest migration that CARRIES the body. A later migration may edit the
   function by asserted substitution against the live catalogue, and then its
   text holds the header line as a fragment but not the body (2026-09-29:
   20260920065728 added p_asset that way); the scanner must skip it. */
function latestStatsFullSql(): { file: string; body: string } {
  let latest: { file: string; body: string } | null = null;
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const at = sql.search(CREATES_FULL);
    if (at >= 0 && sql.includes('totals AS (', at)) latest = { file, body: sql.slice(at) };
  }
  if (!latest) throw new Error('no migration creates public.ca_player_stats_full');
  return latest;
}

type Population = 'Cash' | 'All Games' | 'Tournament' | 'Mixed';

/**
 * payload key -> which hands it counts, derived from the `totals` CTE (where
 * each aggregate carries or lacks `FILTER (WHERE is_cash)`) and the `overall`
 * object built from it.
 */
function overallPopulations(body: string): Map<string, Population> {
  const totalsAt = body.indexOf('totals AS (');
  const totals = body.slice(totalsAt, body.indexOf('FROM scored', totalsAt));
  const aliasPop = new Map<string, 'Cash' | 'All Games' | 'Tournament'>();
  for (const m of totals.matchAll(/^\s*(.+?)\s+AS\s+([a-z_][a-z0-9_]*),?\s*$/gim)) {
    const expr = m[1];
    aliasPop.set(
      m[2],
      /FILTER\s*\(\s*WHERE\s+NOT\s+is_cash\b/i.test(expr)
        ? 'Tournament'
        : /FILTER\s*\(\s*WHERE\s+is_cash\b/i.test(expr)
          ? 'Cash'
          : 'All Games'
    );
  }

  const open = "'overall', (SELECT jsonb_build_object(";
  const objAt = body.indexOf(open);
  const obj = body.slice(objAt + open.length, body.indexOf(') FROM totals)', objAt));
  const out = new Map<string, Population>();
  for (const m of obj.matchAll(/'([a-z0-9_]+)',\s*([\s\S]*?)(?=,\s*\n\s*'[a-z0-9_]+',|$)/g)) {
    const pops = new Set(
      [...m[2].matchAll(/\b[a-z_][a-z0-9_]*\b/g)]
        .map((t) => aliasPop.get(t[0]))
        .filter((p): p is 'Cash' | 'All Games' | 'Tournament' => !!p)
    );
    if (pops.size === 1) out.set(m[1], [...pops][0]);
    else if (pops.size > 1) out.set(m[1], 'Mixed');
  }
  return out;
}

/**
 * The UI's own mapping from a row label to the payload field(s) it prints.
 * Every row in the Overview and Performance grids must be listed here, so a
 * new row cannot be added without deciding what it counts.
 */
const LABEL_TO_KEYS: Record<string, string[]> = {
  VPIP: ['vpip'],
  PFR: ['pfr'],
  '3-Bet %': ['three_bet_percent'],
  'Fold To 3-Bet': ['fold_to_three_bet'],
  'C-Bet Flop': ['cbet_flop'],
  WTSD: ['wtsd'],
  'Aggression Factor': ['aggression_factor'],
  'Showdown Win %': ['showdowns_won', 'showdowns_total'],
  'Hours Played': ['hours_played'],
  'BB/100 Hands': ['bb_per_100'],
  Profit: ['total_profit'],
  'Total Won': ['total_winnings'],
  'Total Invested': ['total_invested'],
  'Biggest Pot Won': ['biggest_pot_won'],
  'Biggest Hand Loss': ['biggest_hand_loss'],
  'Hands Won': ['hands_won'],
  'Hands Lost': ['hands_lost'],
  Hands: ['cash_hands'],
};

describe('the SQL scanner is reading the real definition', () => {
  // Full migration scan measured over 40s on the shared external SSD.
  // Preserve every input and assertion with finite harness headroom.
  it('finds the totals aggregates and the overall payload, and splits them the known way', () => {
    const { file, body } = latestStatsFullSql();
    const pops = overallPopulations(body);
    expect(file).toMatch(/\.sql$/);
    expect(pops.size).toBeGreaterThan(20);
    // Anchors: if these ever flip, every tag below must be re-decided.
    expect(pops.get('bb_per_100')).toBe('Cash');
    expect(pops.get('total_profit')).toBe('Cash');
    expect(pops.get('vpip')).toBe('All Games');
    expect(pops.get('tourney_hands')).toBe('Tournament');
  }, 90_000);
});

/* MODE-SCOPED READOUTS (Dan, 2026-11-27): "IT DOESN'T NEED TO SAY CASH INSIDE
   EACH BOX, AS CASH GAMES IS ALREADY SELECTED AT THE TOP." The 2026-09-20 tags
   existed because ca_player_stats_full mixed two populations in one payload.
   The page now reads ca_player_stats_overview_separated, which filters every
   hand by the selected game mode, so the switch is the one scope statement and
   a per-box tag would only repeat it. These tests pin both halves: the SQL
   still separates the modes, and no box repeats the mode. */
const LATEST_SEPARATED = (() => {
  const CREATES =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.ca_player_stats_overview_separated_by_club\s*\(/i;
  let latest: string | null = null;
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const at = sql.search(CREATES);
    if (at >= 0) latest = sql.slice(at);
  }
  if (!latest) throw new Error('no migration creates ca_player_stats_overview_separated_by_club');
  return latest;
})();

describe('the game-mode switch is the only scope statement (Dan, 2026-11-27)', () => {
  it('the separated stats RPC counts only the selected mode', () => {
    expect(LATEST_SEPARATED).toMatch(
      /\(fact\.tournament_id IS NULL\)\s*=\s*\(p_game_mode\s*=\s*'cash'\)/
    );
  });

  it.each([
    ['Overview', () => overview(OVERALL)],
    ['Performance', () => performance(OVERALL)],
  ])('no %s box repeats the mode', async (_name, ui) => {
    const container = await mounted(ui());
    const all = rows(container);
    expect(all.length).toBeGreaterThanOrEqual(7);
    for (const r of all) {
      expect(LABEL_TO_KEYS[r.label], `${r.label} is mapped to payload keys`).toBeDefined();
      expect(r.label, `label of ${r.label}`).not.toMatch(/\b(Cash|Tournament)\b/);
      for (const tag of r.tags) {
        expect(tag, `tag on ${r.label}`).not.toMatch(/^(Cash|All Games|Tournament)$/);
      }
    }
  });

  it('says what the 100 in BB/100 counts', async () => {
    const perf = await mounted(performance(OVERALL));
    expect(row(perf, 'BB/100 Hands').value).toBe('-22.5');
    expect(rows(perf).some((r) => r.label === 'BB/100')).toBe(false);
  });
});

describe('a rate over an empty sample says so (defect 3)', () => {
  it('Overview: every zero-sample tendency reads Not Yet Measured', async () => {
    const c = await mounted(overview(TOURNAMENT_ONLY));
    expect(row(c, 'VPIP').value).toBe(NOT_YET_MEASURED);
    expect(row(c, 'PFR').value).toBe(NOT_YET_MEASURED);
    expect(row(c, 'BB/100 Hands').value).toBe(NOT_YET_MEASURED);
    expect(row(c, 'Showdown Win %').value).toBe(NOT_YET_MEASURED);
    expect(row(c, 'Aggression Factor').value).toBe(NOT_YET_MEASURED);
    // The showdown rate arrives display-ready: no "%" is appended to the words.
    expect(c.textContent).not.toContain(`${NOT_YET_MEASURED}%`);
  });

  it('Overview: measured rates still print their numbers', async () => {
    const c = await mounted(overview(OVERALL));
    expect(row(c, 'BB/100 Hands').value).toBe('-22.5');
    expect(row(c, 'Showdown Win %').value).toBe('35.8%');
    expect(row(c, 'Aggression Factor').value).toBe('0.7');
  });

  it('Performance: every zero-sample tendency is unmeasured and a measured zero stays zero', async () => {
    const empty = await mounted(performance(TOURNAMENT_ONLY));
    expect(row(empty, 'VPIP').value).toBe(NOT_YET_MEASURED);
    expect(row(empty, 'PFR').value).toBe(NOT_YET_MEASURED);
    expect(row(empty, 'BB/100 Hands').value).toBe(NOT_YET_MEASURED);
    expect(row(empty, 'Showdown Win %').value).toBe(NOT_YET_MEASURED);
    expect(row(empty, 'Aggression Factor').value).toBe(NOT_YET_MEASURED);
    cleanup();
    const brokeEven = await mounted(performance({ ...OVERALL, vpip: 0, pfr: 0, bb_per_100: 0 }));
    expect(row(brokeEven, 'VPIP').value).toBe('0.0%');
    expect(row(brokeEven, 'PFR').value).toBe('0.0%');
    expect(row(brokeEven, 'BB/100 Hands').value).toBe('0.0');
  });

  it('Tournaments: ITM % with no entries and ROI with no buy-ins read Not Yet Measured', async () => {
    const { container: none } = render(
      <TournamentsTab
        tourn={{ ...TOURN, entries: 0, cashes: 0, itm_percent: 0, total_buyins: 0, roi: 0 }}
        overall={OVERALL}
        full={null}
      />
    );
    expect(row(none, 'ITM %').value).toBe(NOT_YET_MEASURED);
    expect(row(none, 'ROI').value).toBe(NOT_YET_MEASURED);
    cleanup();

    // Freerolls only: entries are real, so ITM is measured, but nothing was
    // invested, so there is no return to state.
    const { container: freerolls } = render(
      <TournamentsTab
        tourn={{ ...TOURN, total_buyins: 0, net_profit: 2_300, roi: 0 }}
        overall={OVERALL}
        full={null}
      />
    );
    expect(row(freerolls, 'ITM %').value).toBe('36.4%');
    expect(row(freerolls, 'ROI').value).toBe(NOT_YET_MEASURED);
    cleanup();

    const { container: real } = render(
      <TournamentsTab tourn={TOURN} overall={OVERALL} full={null} />
    );
    expect(row(real, 'ROI').value).toBe('109.1%');
  });
});

describe('Notable Hands names its window (defect 6)', () => {
  it('the section header says All Time', async () => {
    render(
      <Suspense fallback={null}>
        <AnalysisTab
          overall={OVERALL}
          full={null}
          panelResetKey="k"
          targetUserId="user-1"
          rangeKey="7d"
          rangeLabel="7 Days"
          printing={false}
          advancedInitialData={{} as never}
          sessionRows={[]}
          exportContext={{} as never}
          handMode="biggest_won"
          setHandMode={() => {}}
          hands={[]}
          handsLoading={false}
          handsError={false}
          setHandsReload={() => {}}
          openHandEvidence={() => {}}
        />
      </Suspense>
    );
    const heading = await screen.findByRole('heading', { name: 'Notable Hands' });
    const header = heading.closest('.stats-section-header') as HTMLElement;
    expect(header).not.toBeNull();
    expect(within(header).getByText('All Time')).toBeInTheDocument();
  });
});

describe('the Rake tab tells a failed read from an empty ledger (defects 1 and 2)', () => {
  const EMPTY_RAKE: PlayerRakeStats = {
    hands: 0,
    raked_hands: 0,
    rake_paid: 0,
    rake_per_100: 0,
    rake_in_bb: 0,
    bb_per_100: 0,
    avg_rake_per_raked_hand: 0,
    first_hand_at: null,
    last_hand_at: null,
    days: 30,
  };
  const base = {
    rakeLoading: false,
    rakeStats: null as PlayerRakeStats | null,
    rakeError: false,
    onRetryRake: () => {},
    agentRoles: [] as never[] | null,
    agentRolesError: false,
    onRetryAgentRoles: () => {},
    isOwnProfile: true,
    panelResetKey: 'k',
  };

  it('forwards the parent record revision through the lazy downline boundary', async () => {
    const agentRoles = [
      {
        club_id: 'club-1',
        club_name: 'Club',
        role: 'agent' as const,
        agent_id: 'agent-1',
        is_overseer: false,
      },
    ];
    const view = render(
      <RakeTab {...base} agentRoles={agentRoles} liveRevision={0} viewerId="viewer-a" />
    );
    expect(await screen.findByText('Downline Panel Rendered')).toHaveAttribute(
      'data-live-revision',
      '0'
    );
    view.rerender(
      <RakeTab {...base} agentRoles={agentRoles} liveRevision={3} viewerId="viewer-b" />
    );
    expect(screen.getByText('Downline Panel Rendered')).toHaveAttribute('data-live-revision', '3');
    expect(screen.getByText('Downline Panel Rendered')).toHaveAttribute(
      'data-viewer-id',
      'viewer-b'
    );
  });

  it('a successful read of nothing is the designed empty ledger', () => {
    render(<RakeTab {...base} rakeStats={EMPTY_RAKE} />);
    expect(screen.getByText('Rake Ledger Empty')).toBeInTheDocument();
    expect(screen.queryByText('Readout Unavailable')).not.toBeInTheDocument();
  });

  it('a failed rake read is Readout Unavailable, never the empty ledger, and retries', () => {
    const onRetryRake = vi.fn();
    render(<RakeTab {...base} rakeError onRetryRake={onRetryRake} />);
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Readout Unavailable')).toBeInTheDocument();
    expect(within(alert).getByText("Couldn't Load Your Rake")).toBeInTheDocument();
    expect(screen.queryByText('Rake Ledger Empty')).not.toBeInTheDocument();
    expect(screen.queryByText('No Rake In This Window')).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole('button', { name: 'Try Again' }));
    expect(onRetryRake).toHaveBeenCalledTimes(1);
  });

  it('a failed roles read keeps the Downline section, as unavailable, and retries', () => {
    const onRetryAgentRoles = vi.fn();
    render(
      <RakeTab
        {...base}
        rakeStats={EMPTY_RAKE}
        agentRoles={null}
        agentRolesError
        onRetryAgentRoles={onRetryAgentRoles}
      />
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Readout Unavailable')).toBeInTheDocument();
    expect(within(alert).getByText("Couldn't Load Your Downline Rake")).toBeInTheDocument();
    // An unknown roles list is not "no downline": the empty ledger is not claimed.
    expect(screen.queryByText('Rake Ledger Empty')).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole('button', { name: 'Try Again' }));
    expect(onRetryAgentRoles).toHaveBeenCalledTimes(1);
  });

  it('both reads failing show both readouts, each with its own retry', () => {
    render(<RakeTab {...base} rakeError agentRoles={null} agentRolesError />);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Try Again' })).toHaveLength(2);
    expect(screen.queryByText('Rake Ledger Empty')).not.toBeInTheDocument();
  });
});
