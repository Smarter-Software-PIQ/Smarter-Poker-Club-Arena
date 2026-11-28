/**
 * TABLE CONFIG PAGE IS PINNED BEFORE ITS FRAME MOVES
 * (#SmarterDesign batch G1, 2026-11-28)
 *
 * TableConfigPage (`/clubs/:clubId/create-table/:gameType` and embedded inside
 * GameManagementPage) replaces its remaining SpadeConsole wrapper with the
 * arena workspace chrome case (and adds the chrome mast on its standalone
 * route). No printed figure, word, data hook, named region or control state
 * may change.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  templates: [
    {
      id: 'tpl-1',
      name: 'Friday Turbo MTT',
      game_type: 'nlh',
      game_mode: 'mtt',
      config: { gameMode: 'mtt', name: 'Friday Turbo MTT', buyInAmount: 50, buyInFee: 5 },
      club_id: 'club-uuid-1',
      is_deleted: false,
      created_at: '2026-11-20T00:00:00Z',
    },
  ],
}));

vi.mock('../../src/lib/supabase', () => {
  const chain = (data: unknown) => {
    const q: Record<string, unknown> = {
      then: (ok: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data, error: null }).then(ok),
    };
    for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'abortSignal', 'maybeSingle']) {
      q[m] = () => q;
    }
    return q;
  };
  return {
    supabase: {
      from: (table: string) => (table === 'table_templates' ? chain(mocks.templates) : chain([])),
      rpc: vi.fn(async () => ({ data: null, error: null })),
    },
    getAuthUser: vi.fn(async () => ({ id: 'owner-1' })),
  };
});
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: { emit: vi.fn(), subscribe: () => () => {} },
}));
vi.mock('../../src/stores/useUserStore', () => ({
  useUserStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'owner-1' } }),
}));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => mocks.toast,
}));
vi.mock('../../src/utils/clubIdResolver', () => ({
  resolveClubUUID: async () => 'club-uuid-1',
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/services/GameAccessService', () => ({
  fetchGameCreationAccess: async () => ({ allowed: true, unionId: null, reason: 'ok' }),
}));
vi.mock('../../src/hooks/usePlatformCapability', () => ({
  usePlatformCapability: () => false,
}));
vi.mock('../../src/components/cash/CashGameCreateFlow', () => ({
  default: ({ initialVariant }: { initialVariant?: string }) => (
    <div data-testid="cash-game-create-flow-stub">Cash Flow ({initialVariant})</div>
  ),
}));
vi.mock('../../src/components/tournament/MttCreationStructurePreview', () => ({
  MttCreationStructurePreview: () => <div data-testid="mtt-structure-preview-stub">Preview</div>,
}));

import TableConfigPage from '../../src/pages/TableConfigPage';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

function pin(container: HTMLElement) {
  return surfacePin(container.firstElementChild as HTMLElement);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-28T18:00:00Z'));
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Table Config prints the same labels, options and controls', () => {
  it('standalone Regular tab', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/clubs/kings-club/create-table/nlh']}>
        <Routes>
          <Route
            path="/clubs/:clubId/create-table/:gameType"
            element={<TableConfigPage accessPrevalidated />}
          />
        </Routes>
      </MemoryRouter>
    );
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|MTT|aria-pressed=false",
          "button|button|Regular|aria-pressed=true",
          "button|button|SNG|aria-pressed=false",
        ],
        "money": {
          "figures": [],
          "hooks": [
            "data-testid=cash-game-create-flow-stub",
          ],
        },
        "regions": [
          "div|group|Game Format",
        ],
        "text": "NLH Setup | Creator | Cash Flow ( | nlh | )",
      }
    `);
  });

  it('standalone SNG tab', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/clubs/kings-club/create-table/nlh']}>
        <Routes>
          <Route
            path="/clubs/:clubId/create-table/:gameType"
            element={<TableConfigPage accessPrevalidated />}
          />
        </Routes>
      </MemoryRouter>
    );
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'SNG' }));
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Help: Action Time|aria-expanded=false",
          "button|button|Help: All-In Or Fold|aria-expanded=false",
          "button|button|Help: Authorized To Register|aria-expanded=false",
          "button|button|Help: Ban Chat|aria-expanded=false",
          "button|button|Help: Big Blind Ante|aria-expanded=false",
          "button|button|Help: Blinds Up|aria-expanded=false",
          "button|button|Help: Buy-In|aria-expanded=false",
          "button|button|Help: Custom Buy-In|aria-expanded=false",
          "button|button|Help: Featured Tournament|aria-expanded=false",
          "button|button|Help: Fee|aria-expanded=false",
          "button|button|Help: Hide Club Name|aria-expanded=false",
          "button|button|Help: Label As NEW|aria-expanded=false",
          "button|button|Help: Payout Structure|aria-expanded=false",
          "button|button|Help: Players|aria-expanded=false",
          "button|button|Help: Private Game|aria-expanded=false",
          "button|button|Help: Starting Chips|aria-expanded=false",
          "button|button|Help: Synchronized Breaks|aria-expanded=false",
          "button|button|Help: Table Size|aria-expanded=false",
          "button|button|Help: VIP Only|aria-expanded=false",
          "button|button|MTT|aria-pressed=false",
          "button|button|Regular|aria-pressed=false",
          "button|button|SNG|aria-pressed=true",
          "button||Save As Template|",
          "button||Save|",
          "button||Start|",
          "input|checkbox|All-In Or Fold|unchecked,value=on",
          "input|checkbox|Authorized To Register|unchecked,value=on",
          "input|checkbox|Ban Chat|unchecked,value=on",
          "input|checkbox|Big Blind Ante|unchecked,value=on",
          "input|checkbox|Custom Buy-In|unchecked,value=on",
          "input|checkbox|Featured Tournament|unchecked,value=on",
          "input|checkbox|Hide Club Name|unchecked,value=on",
          "input|checkbox|Label As NEW|unchecked,value=on",
          "input|checkbox|Private Game|unchecked,value=on",
          "input|checkbox|Synchronized Breaks|checked,value=on",
          "input|checkbox|VIP Only|unchecked,value=on",
          "input|radio||checked,value=on",
          "input|radio||unchecked,value=on",
          "input|radio||unchecked,value=on",
          "input|radio||unchecked,value=on",
          "input|range|Action Time|value=15",
          "input|range|Blinds Up|value=10",
          "input|range|Buy-In|value=100",
          "input|range|Starting Chips|value=1000",
          "input|range|Table Size|value=9",
          "input|text|Table Name|value=NLH 0.05/0.10",
          "select||-- Start Fresh --Friday Turbo MTT|value=",
          "select||2 Players (Heads-Up)3 Players (Spins)9 Players (Single Table)18 Players (2 Tables)27 Players (3 Tables)36 Players (4 Tables)45 Players (5 Tables)54 Players (6 Tables)63 Players (7 Tables)72 Players (8 Tables)81 Players (9 Tables)90 Players (10 Tables)99 Players (11 Tables)|value=",
          "select||Top 10% Of FieldTop 12.5% Of FieldTop 15% Of Field (Standard)Winner Take All|value=",
          "textarea|||value=",
        ],
        "money": {
          "figures": [
            "2 Players (Heads-Up)",
            "3 Players (Spins)",
            "9 Players (Single Table)",
            "18 Players (2 Tables)",
            "27 Players (3 Tables)",
            "36 Players (4 Tables)",
            "45 Players (5 Tables)",
            "54 Players (6 Tables)",
            "63 Players (7 Tables)",
            "72 Players (8 Tables)",
            "81 Players (9 Tables)",
            "90 Players (10 Tables)",
            "99 Players (11 Tables)",
            "9 seats",
            "15 sec",
            "5% Of Buy-In",
            "100",
            "Top 10% Of Field",
            "Top 12.5% Of Field",
            "Top 15% Of Field (Standard)",
            "1000",
            "10 min",
          ],
          "hooks": [
            "data-testid=mtt-structure-preview-stub",
          ],
        },
        "regions": [
          "div|group|Game Format",
          "input||Table Name",
          "button||Help: Players",
          "button||Help: Private Game",
          "input|switch|Private Game",
          "button||Help: VIP Only",
          "input|switch|VIP Only",
          "button||Help: Ban Chat",
          "input|switch|Ban Chat",
          "button||Help: All-In Or Fold",
          "input|switch|All-In Or Fold",
          "button||Help: Label As NEW",
          "input|switch|Label As NEW",
          "button||Help: Featured Tournament",
          "input|switch|Featured Tournament",
          "button||Help: Hide Club Name",
          "input|switch|Hide Club Name",
          "button||Help: Table Size",
          "input||Table Size",
          "button||Help: Action Time",
          "input||Action Time",
          "button||Help: Fee",
          "button||Help: Custom Buy-In",
          "input|switch|Custom Buy-In",
          "button||Help: Buy-In",
          "input||Buy-In",
          "div|radiogroup|",
          "button||Help: Payout Structure",
          "button||Help: Starting Chips",
          "input||Starting Chips",
          "button||Help: Blinds Up",
          "input||Blinds Up",
          "button||Help: Big Blind Ante",
          "input|switch|Big Blind Ante",
          "button||Help: Authorized To Register",
          "input|switch|Authorized To Register",
          "button||Help: Synchronized Breaks",
          "input|switch|Synchronized Breaks",
        ],
        "text": "NLH Setup | Creator | Load Template: | -- Start Fresh -- | Friday Turbo MTT | Players | 2 Players (Heads-Up) | 3 Players (Spins) | 9 Players (Single Table) | 18 Players (2 Tables) | 27 Players (3 Tables) | 36 Players (4 Tables) | 45 Players (5 Tables) | 54 Players (6 Tables) | 63 Players (7 Tables) | 72 Players (8 Tables) | 81 Players (9 Tables) | 90 Players (10 Tables) | 99 Players (11 Tables) | Private Game | Off | VIP Only | Off | Short Description | Ban Chat | Off | All-In Or Fold | Off | Label As NEW | Off | Featured Tournament | Off | Hide Club Name | Off | Table Size | : | 9 seats | Action Time | : | 15 sec | Fee | 5% Of Buy-In | Custom Buy-In | Off | Buy-In | : | 100 | Blind Structure | Slow | Standard | Turbo | HyperTurbo | Payout Structure | Top 10% Of Field | Top 12.5% Of Field | Top 15% Of Field (Standard) | Winner Take All | Starting Chips | : | 1000 | Blinds Up | : | 10 min | Preview | Big Blind Ante | Off | Authorized To Register | Off | Synchronized Breaks | On",
      }
    `);
  });

  it('standalone MTT tab', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/clubs/kings-club/create-table/nlh']}>
        <Routes>
          <Route
            path="/clubs/:clubId/create-table/:gameType"
            element={<TableConfigPage accessPrevalidated />}
          />
        </Routes>
      </MemoryRouter>
    );
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'MTT' }));
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Help: Accelerated MTT|aria-expanded=false",
          "button|button|Help: Action Time|aria-expanded=false",
          "button|button|Help: Add-On|aria-expanded=false",
          "button|button|Help: All-In Or Fold|aria-expanded=false",
          "button|button|Help: Authorized To Register|aria-expanded=false",
          "button|button|Help: Ban Chat|aria-expanded=false",
          "button|button|Help: Big Blind Ante|aria-expanded=false",
          "button|button|Help: Blinds Up|aria-expanded=false",
          "button|button|Help: Bubble Protection|aria-expanded=false",
          "button|button|Help: Buy-In|aria-expanded=false",
          "button|button|Help: Custom Add-On|aria-expanded=false",
          "button|button|Help: Custom Buy-In|aria-expanded=false",
          "button|button|Help: Custom Rebuy/Re-Entry Cost|aria-expanded=false",
          "button|button|Help: Early Bird Registration|aria-expanded=false",
          "button|button|Help: Entry Rules|aria-expanded=false",
          "button|button|Help: Featured Tournament|aria-expanded=false",
          "button|button|Help: Fee|aria-expanded=false",
          "button|button|Help: Final Table Deal|aria-expanded=false",
          "button|button|Help: GTD Prize Pool|aria-expanded=false",
          "button|button|Help: Hide Club Name|aria-expanded=false",
          "button|button|Help: Label As NEW|aria-expanded=false",
          "button|button|Help: Late Registration|aria-expanded=false",
          "button|button|Help: Minimum Players To Start|aria-expanded=false",
          "button|button|Help: Multi-Day MTT|aria-expanded=false",
          "button|button|Help: Next Step (Satellite)|aria-expanded=false",
          "button|button|Help: Number Of Rebuys|aria-expanded=false",
          "button|button|Help: Payout Structure|aria-expanded=false",
          "button|button|Help: Private Game|aria-expanded=false",
          "button|button|Help: Prize Style|aria-expanded=false",
          "button|button|Help: Repeat|aria-expanded=false",
          "button|button|Help: Restart The Tournament|aria-expanded=false",
          "button|button|Help: Save The Start Time|aria-expanded=false",
          "button|button|Help: Start Date|aria-expanded=false",
          "button|button|Help: Start Time|aria-expanded=false",
          "button|button|Help: Starting Chips|aria-expanded=false",
          "button|button|Help: Synchronized Breaks|aria-expanded=false",
          "button|button|Help: Table Size|aria-expanded=false",
          "button|button|Help: VIP Only|aria-expanded=false",
          "button|button|MTT|aria-pressed=true",
          "button|button|Regular|aria-pressed=false",
          "button|button|SNG|aria-pressed=false",
          "button||Save As Template|",
          "button||Save|",
          "button||Start|",
          "input|checkbox|Accelerated MTT|unchecked,value=on",
          "input|checkbox|Add-On|checked,value=on",
          "input|checkbox|All-In Or Fold|unchecked,value=on",
          "input|checkbox|Authorized To Register|unchecked,value=on",
          "input|checkbox|Ban Chat|disabled,checked,value=on",
          "input|checkbox|Big Blind Ante|unchecked,value=on",
          "input|checkbox|Bubble Protection|unchecked,value=on",
          "input|checkbox|Custom Add-On|unchecked,value=on",
          "input|checkbox|Custom Buy-In|unchecked,value=on",
          "input|checkbox|Custom Rebuy/Re-Entry Cost|unchecked,value=on",
          "input|checkbox|Early Bird Registration|unchecked,value=on",
          "input|checkbox|Featured Tournament|unchecked,value=on",
          "input|checkbox|Final Table Deal|unchecked,value=on",
          "input|checkbox|GTD Prize Pool|unchecked,value=on",
          "input|checkbox|Hide Club Name|unchecked,value=on",
          "input|checkbox|Label As NEW|unchecked,value=on",
          "input|checkbox|Next Step (Satellite)|unchecked,value=on",
          "input|checkbox|Private Game|unchecked,value=on",
          "input|checkbox|Restart The Tournament|unchecked,value=on",
          "input|checkbox|Save The Start Time|unchecked,value=on",
          "input|checkbox|Synchronized Breaks|checked,value=on",
          "input|checkbox|VIP Only|unchecked,value=on",
          "input|number|Minimum Players To Start|value=3",
          "input|radio||checked,value=on",
          "input|radio||unchecked,value=on",
          "input|radio||unchecked,value=on",
          "input|radio||unchecked,value=on",
          "input|range|Action Time|value=15",
          "input|range|Blinds Up|value=10",
          "input|range|Buy-In|value=100",
          "input|range|Late Registration|value=6",
          "input|range|Number Of Rebuys|value=3",
          "input|range|Starting Chips|value=1000",
          "input|range|Table Size|value=9",
          "input|text|Table Name|value=NLH 0.05/0.10",
          "select||-- Start Fresh --Friday Turbo MTT|value=",
          "select||Custom SetupRegular · 150 BB · 10 MinDeep Stack · 300 BB · 15 MinTurbo · 100 BB · 5 MinHyper Turbo · 50 BB · 5 Min|value=",
          "select||Does Not RepeatDailyWeeklyMonthly|value=",
          "select||FreezeoutRebuyRe-Entry|value=",
          "select||No DateSat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>Mon, <date>Tue, <date>Wed, <date>Thu, <date>Fri, <date>Sat, <date>Sun, <date>|value=",
          "select||No Time12:00 AM12:15 AM12:30 AM12:45 AM1:00 AM1:15 AM1:30 AM1:45 AM2:00 AM2:15 AM2:30 AM2:45 AM3:00 AM3:15 AM3:30 AM3:45 AM4:00 AM4:15 AM4:30 AM4:45 AM5:00 AM5:15 AM5:30 AM5:45 AM6:00 AM6:15 AM6:30 AM6:45 AM7:00 AM7:15 AM7:30 AM7:45 AM8:00 AM8:15 AM8:30 AM8:45 AM9:00 AM9:15 AM9:30 AM9:45 AM10:00 AM10:15 AM10:30 AM10:45 AM11:00 AM11:15 AM11:30 AM11:45 AM12:00 PM12:15 PM12:30 PM12:45 PM1:00 PM1:15 PM1:30 PM1:45 PM2:00 PM2:15 PM2:30 PM2:45 PM3:00 PM3:15 PM3:30 PM3:45 PM4:00 PM4:15 PM4:30 PM4:45 PM5:00 PM5:15 PM5:30 PM5:45 PM6:00 PM6:15 PM6:30 PM6:45 PM7:00 PM7:15 PM7:30 PM7:45 PM8:00 PM8:15 PM8:30 PM8:45 PM9:00 PM9:15 PM9:30 PM9:45 PM10:00 PM10:15 PM10:30 PM10:45 PM11:00 PM11:15 PM11:30 PM11:45 PM|value=",
          "select||RegularBountyProgressive BountyMystery Bounty|value=",
          "select||Top 15% Of Field (Standard)|value=",
          "textarea|||value=",
        ],
        "money": {
          "figures": [
            "9 seats",
            "15 sec",
            "10% Of Buy-In",
            "100",
            "150",
            "10",
            "300",
            "15",
            "100",
            "5",
            "50",
            "5",
            "Top 15% Of Field (Standard)",
            "1000",
            "10 min",
            "3",
            "6 level",
          ],
          "hooks": [
            "data-testid=mtt-structure-preview-stub",
          ],
        },
        "regions": [
          "div|group|Game Format",
          "input||Table Name",
          "button||Help: Private Game",
          "input|switch|Private Game",
          "button||Help: VIP Only",
          "input|switch|VIP Only",
          "button||Help: Ban Chat",
          "input|switch|Ban Chat",
          "button||Help: All-In Or Fold",
          "input|switch|All-In Or Fold",
          "button||Help: Label As NEW",
          "input|switch|Label As NEW",
          "button||Help: Featured Tournament",
          "input|switch|Featured Tournament",
          "button||Help: Hide Club Name",
          "input|switch|Hide Club Name",
          "button||Help: Table Size",
          "input||Table Size",
          "button||Help: Action Time",
          "input||Action Time",
          "button||Help: Fee",
          "button||Help: Custom Buy-In",
          "input|switch|Custom Buy-In",
          "button||Help: Buy-In",
          "input||Buy-In",
          "div|radiogroup|",
          "button||Help: Payout Structure",
          "button||Help: Starting Chips",
          "input||Starting Chips",
          "button||Help: Blinds Up",
          "input||Blinds Up",
          "button||Help: Big Blind Ante",
          "input|switch|Big Blind Ante",
          "button||Help: Authorized To Register",
          "input|switch|Authorized To Register",
          "button||Help: Synchronized Breaks",
          "input|switch|Synchronized Breaks",
          "button||Help: Accelerated MTT",
          "input|switch|Accelerated MTT",
          "button||Help: Entry Rules",
          "button||Help: Number Of Rebuys",
          "input||Number Of Rebuys",
          "button||Help: Custom Rebuy/Re-Entry Cost",
          "input|switch|Custom Rebuy/Re-Entry Cost",
          "button||Help: Add-On",
          "input|switch|Add-On",
          "button||Help: Custom Add-On",
          "input|switch|Custom Add-On",
          "button||Help: Prize Style",
          "button||Help: GTD Prize Pool",
          "input|switch|GTD Prize Pool",
          "button||Help: Final Table Deal",
          "input|switch|Final Table Deal",
          "button||Help: Bubble Protection",
          "input|switch|Bubble Protection",
          "button||Help: Late Registration",
          "input||Late Registration",
          "button||Help: Early Bird Registration",
          "input|switch|Early Bird Registration",
          "button||Help: Next Step (Satellite)",
          "input|switch|Next Step (Satellite)",
          "button||Help: Multi-Day MTT",
          "button||Help: Minimum Players To Start",
          "input||Minimum Players To Start",
          "button||Help: Start Date",
          "button||Help: Start Time",
          "button||Help: Save The Start Time",
          "input|switch|Save The Start Time",
          "button||Help: Restart The Tournament",
          "input|switch|Restart The Tournament",
          "button||Help: Repeat",
        ],
        "text": "NLH Setup | Creator | Load Template: | -- Start Fresh -- | Friday Turbo MTT | Private Game | Off | VIP Only | Off | Short Description | Ban Chat | On | All-In Or Fold | Off | Label As NEW | Off | Featured Tournament | Off | Hide Club Name | Off | Table Size | : | 9 seats | Action Time | : | 15 sec | Fee | 10% Of Buy-In | Custom Buy-In | Off | Buy-In | : | 100 | Setup Preset | Custom Setup | Regular | · | 150 | BB · | 10 | Min | Deep Stack | · | 300 | BB · | 15 | Min | Turbo | · | 100 | BB · | 5 | Min | Hyper Turbo | · | 50 | BB · | 5 | Min | Blind Structure | Slow | Standard | Turbo | HyperTurbo | Payout Structure | Top 15% Of Field (Standard) | Starting Chips | : | 1000 | Blinds Up | : | 10 min | Preview | Big Blind Ante | Off | Authorized To Register | Off | Synchronized Breaks | On | Accelerated MTT | Off | Entry Rules | Freezeout | Rebuy | Re-Entry | Number Of Rebuys | : | 3 | Custom Rebuy/Re-Entry Cost | Off | Add-On | On | Custom Add-On | Off | Prize Style | Regular | Bounty | Progressive Bounty | Mystery Bounty | GTD Prize Pool | Off | Final Table Deal | Off | Bubble Protection | Off | Late Registration | : | 6 level | Early Bird Registration | Off | Next Step (Satellite) | Off | Multi-Day MTT | NOT AVAILABLE YET | Minimum Players To Start | Start Date | No Date | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Mon, <date> | Tue, <date> | Wed, <date> | Thu, <date> | Fri, <date> | Sat, <date> | Sun, <date> | Start Time | No Time | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | <time> | Save The Start Time | Off | Restart The Tournament | Off | Repeat | Does Not Repeat | Daily | Weekly | Monthly",
      }
    `);
  });

  it('embedded inside Table Management', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/clubs/kings-club/table-management?create=table&game=nlh']}>
        <TableConfigPage
          clubIdOverride="kings-club"
          gameTypeOverride="nlh"
          embedded
          accessPrevalidated
        />
      </MemoryRouter>
    );
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|MTT|aria-pressed=false",
          "button|button|Regular|aria-pressed=true",
          "button|button|SNG|aria-pressed=false",
        ],
        "money": {
          "figures": [],
          "hooks": [
            "data-testid=cash-game-create-flow-stub",
          ],
        },
        "regions": [
          "div|group|Game Format",
        ],
        "text": "NLH Setup | Creator | Cash Flow ( | nlh | )",
      }
    `);
  });
});
