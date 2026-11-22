import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { ToastProvider } from '../../../../src/components/common/Toast';
import { HeadsUpWaitingModal } from '../../../../src/components/table/HeadsUpWaitingModal';
import { TableLoadFailureOverlay } from '../../../../src/components/table/TableLoadFailureOverlay';
import LobbyTable from '../../../../src/components/lobby/LobbyTable';
import {
  cashEntry,
  tournamentEntry,
  type LobbyTableRow,
  type LobbyTournamentRow,
} from '../../../../src/components/lobby/lobbyEntries';
import InviteCodePage from '../../../../src/pages/InviteCodePage';
import InvitePage from '../../../../src/pages/InvitePage';
import { parseTableInviteParams } from '../../../../src/lib/mustMoveInviteRouting';
import { tableShareUrl } from '../../../../src/lib/share';

const TABLE_UUID = '11111111-2222-4333-8444-555555555555';
const CLUSTER_UUID = '33333333-4444-4555-8666-777777777777';

function HeadsUpDialogHarness() {
  const [open, setOpen] = useState(true);
  const [notice, setNotice] = useState('');
  const inviteUrl = tableShareUrl(TABLE_UUID, {
    origin: 'https://smarter.poker',
    inviteCode: 'ABC2345',
    inviteToken: 'hu_hold_99',
  });

  return (
    <div style={{ padding: 16 }}>
      <div data-testid="hu-notice">{notice}</div>
      <HeadsUpWaitingModal
        isOpen={open}
        initialStep="choice"
        tableName="NLH 1/2 Heads Up"
        inviteUrl={inviteUrl}
        onChooseSpecific={() => {}}
        onChooseAnyone={() => {}}
        onClose={() => setOpen(false)}
        onNotify={(_kind, msg) => setNotice(msg)}
      />
    </div>
  );
}

function MobileMttLobbyHarness() {
  const row: LobbyTournamentRow = {
    id: 'mtt-mobile-1',
    name: 'Nightly Deepstack Championship Guarantee',
    game_type: 'NLH',
    buy_in_amount: 50,
    buy_in_fee: 5,
    guaranteed_prize: 5000,
    start_time: new Date(Date.now() + 20 * 60_000).toISOString(),
    status: 'REGISTERING',
    current_players: 24,
    max_players: 200,
    tournament_type: 'MTT',
    format_contract: 'mtt-v1',
    starting_chips: 20000,
    late_reg_mins: 60,
    blind_structure: JSON.stringify([
      { level: 1, small_blind: 50, big_blind: 100, duration_minutes: 10 },
    ]),
  };
  const entries = useMemo(() => [tournamentEntry(row, 'mtt')], []);
  const ctx = useMemo(
    () => ({
      waitlistedIds: new Set<string>(),
      seatedIds: new Set<string>(),
      registeredIds: new Set<string>(),
      favoriteIds: new Set<string>(),
      inviteCode: 'ABC2345',
    }),
    []
  );

  return (
    <div style={{ padding: 8, width: '100%', boxSizing: 'border-box' }}>
      <LobbyTable
        entries={entries}
        category="MTT"
        selectedId={null}
        onSelect={() => {}}
        onActivate={() => {}}
        ctx={ctx}
      />
    </div>
  );
}

function TableUnavailableHarness() {
  const { tableId } = useParams();
  const location = useLocation();
  const parsed = parseTableInviteParams(tableId, location.search);
  const isMember = window.sessionStorage.getItem('fixture-joined-club') === '1';

  if (isMember) {
    return (
      <div data-testid="table-opened">
        Table Opened:{location.pathname}
        {location.search}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <TableLoadFailureOverlay
        tableLoadFailure="missing"
        exitDestination={() => '/clubs-list'}
        inviteCode={parsed.inviteCode}
        returnPath={parsed.returnPath}
      />
    </div>
  );
}

function ClubLandingProbe() {
  const location = useLocation();
  return (
    <div data-testid="club-landing">
      Club:{location.pathname}
      {location.search}
    </div>
  );
}

function LobbyCardsHarness() {
  const now = Date.now();
  const blinds = JSON.stringify([
    { level: 1, small_blind: 50, big_blind: 100, duration_minutes: 10 },
  ]);
  const spinEntries = useMemo(
    () => [
      tournamentEntry(
        {
          id: 'spin-plo4-100',
          name: '100 Chip Spin PLO4',
          game_type: 'PLO4',
          variant: 'spin',
          format_contract: 'spin-v1',
          buy_in_amount: 100,
          buy_in_fee: 0,
          guaranteed_prize: 0,
          start_time: new Date(now + 60_000).toISOString(),
          status: 'REGISTERING',
          current_players: 2,
          max_players: 3,
          starting_chips: 500,
          blind_structure: blinds,
        },
        'spin'
      ),
      tournamentEntry(
        {
          id: 'spin-nlh-5',
          name: '5 Chip Deep Stack Spin NLH',
          game_type: 'NLH',
          variant: 'spin',
          format_contract: 'spin-v1',
          buy_in_amount: 5,
          buy_in_fee: 0,
          guaranteed_prize: 0,
          start_time: new Date(now + 60_000).toISOString(),
          status: 'REGISTERING',
          current_players: 1,
          max_players: 3,
          starting_chips: 1000,
          blind_structure: blinds,
        },
        'spin'
      ),
      tournamentEntry(
        {
          id: 'spin-plo5-5',
          name: '5 Chip Spin PLO5',
          game_type: 'PLO5',
          variant: 'spin',
          format_contract: 'spin-v1',
          buy_in_amount: 5,
          buy_in_fee: 0,
          guaranteed_prize: 0,
          start_time: new Date(now + 60_000).toISOString(),
          status: 'REGISTERING',
          current_players: 0,
          max_players: 3,
          starting_chips: 500,
          blind_structure: blinds,
        },
        'spin'
      ),
      tournamentEntry(
        {
          id: 'spin-nlh-running',
          name: '25 Chip Spin NLH',
          game_type: 'NLH',
          variant: 'spin',
          format_contract: 'spin-v1',
          buy_in_amount: 25,
          buy_in_fee: 0,
          guaranteed_prize: 0,
          start_time: new Date(now - 120_000).toISOString(),
          started_at: new Date(now - 120_000).toISOString(),
          status: 'RUNNING',
          current_players: 3,
          max_players: 3,
          starting_chips: 500,
          blind_structure: blinds,
        },
        'spin'
      ),
    ],
    [now, blinds]
  );

  const sngEntries = useMemo(
    () => [
      {
        ...tournamentEntry(
          {
            id: 'sng-sat-nlh-9',
            name: 'Satellite Into Sunday 200 Deep Stack',
            game_type: 'NLH',
            variant: 'sng',
            tournament_type: 'SATELLITE',
            format_contract: 'seat-first-satellite-v1',
            is_satellite: true,
            satellite_target: 'Sunday 200 Deep Stack',
            buy_in_amount: 57,
            buy_in_fee: 0,
            guaranteed_prize: 0,
            start_time: new Date(now + 120_000).toISOString(),
            status: 'REGISTERING',
            current_players: 0,
            max_players: 9,
            starting_chips: 5000,
            blind_structure: blinds,
          },
          'sng'
        ),
        status: 'starting_soon' as const,
        statusLabel: 'Starting Soon',
      },
      {
        ...tournamentEntry(
          {
            id: 'sng-sat-plo5-6',
            name: 'Satellite Into Sunday Funday PLO5 Mystery',
            game_type: 'PLO5',
            variant: 'sng',
            tournament_type: 'SATELLITE',
            format_contract: 'seat-first-satellite-v1',
            is_satellite: true,
            satellite_target: 'Sunday Funday PLO5 Mystery',
            buy_in_amount: 23,
            buy_in_fee: 0,
            guaranteed_prize: 0,
            start_time: new Date(now + 120_000).toISOString(),
            status: 'REGISTERING',
            current_players: 0,
            max_players: 6,
            starting_chips: 5000,
            blind_structure: blinds,
          },
          'sng'
        ),
        status: 'starting_soon' as const,
        statusLabel: 'Starting Soon',
      },
      tournamentEntry(
        {
          id: 'sng-hu-nlh-50',
          name: '50 Chip Heads-Up NLH',
          game_type: 'NLH',
          variant: 'sng',
          format_contract: 'sng-v1',
          buy_in_amount: 50,
          buy_in_fee: 0,
          guaranteed_prize: 0,
          start_time: new Date(now + 60_000).toISOString(),
          status: 'REGISTERING',
          current_players: 1,
          max_players: 2,
          starting_chips: 1500,
          blind_structure: blinds,
        },
        'sng'
      ),
      tournamentEntry(
        {
          id: 'sng-hu-plo-25',
          name: '25 Chip Heads-Up PLO',
          game_type: 'PLO4',
          variant: 'sng',
          format_contract: 'sng-v1',
          buy_in_amount: 25,
          buy_in_fee: 0,
          guaranteed_prize: 0,
          start_time: new Date(now + 60_000).toISOString(),
          status: 'REGISTERING',
          current_players: 0,
          max_players: 2,
          starting_chips: 1500,
          blind_structure: blinds,
        },
        'sng'
      ),
    ],
    [now, blinds]
  );

  const mttEntries = useMemo(
    () => [
      tournamentEntry(
        {
          id: 'mtt-reg-1',
          name: 'Nightly Deepstack Championship Guarantee',
          game_type: 'NLH',
          buy_in_amount: 50,
          buy_in_fee: 5,
          guaranteed_prize: 5000,
          start_time: new Date(now + 20 * 60_000).toISOString(),
          status: 'REGISTERING',
          current_players: 24,
          max_players: 200,
          tournament_type: 'MTT',
          format_contract: 'mtt-v1',
          starting_chips: 20000,
          late_reg_mins: 60,
          blind_structure: blinds,
        },
        'mtt'
      ),
      tournamentEntry(
        {
          id: 'mtt-late-2',
          name: 'Sunday High Roller Bounty',
          game_type: 'PLO4',
          buy_in_amount: 100,
          buy_in_fee: 10,
          guaranteed_prize: 10000,
          start_time: new Date(now - 15 * 60_000).toISOString(),
          started_at: new Date(now - 15 * 60_000).toISOString(),
          status: 'RUNNING',
          current_players: 68,
          max_players: 500,
          tournament_type: 'MTT',
          format_contract: 'mtt-v1',
          starting_chips: 25000,
          late_reg_mins: 60,
          blind_structure: blinds,
        },
        'mtt'
      ),
    ],
    [now, blinds]
  );

  const cashEntries = useMemo(() => {
    const rows: LobbyTableRow[] = [
      {
        id: 'cash-nlh-12',
        name: 'NLH 1/2 Classic',
        game_variant: 'nlh',
        small_blind: 1,
        big_blind: 2,
        min_buy_in: 80,
        max_buy_in: 400,
        current_players: 4,
        max_players: 6,
        status: 'open',
        cluster_id: 'cluster-nlh-12',
        cluster_template: 'classic',
      },
      {
        id: 'cash-plo5-025',
        name: 'PLO5 0.25/0.50 Classic',
        game_variant: 'plo5',
        small_blind: 0.25,
        big_blind: 0.5,
        min_buy_in: 20,
        max_buy_in: 100,
        current_players: 3,
        max_players: 6,
        status: 'open',
        cluster_id: 'cluster-plo5-025',
        cluster_template: 'classic',
        big_blind_ante_enabled: true,
        maintain_percent_min: 50,
      },
    ];
    return rows.map((row) => cashEntry(row));
  }, []);

  const ctx = useMemo(
    () => ({
      waitlistedIds: new Set<string>(),
      seatedIds: new Set<string>(),
      registeredIds: new Set<string>(),
      favoriteIds: new Set<string>(),
      inviteCode: 'ABC2345',
    }),
    []
  );

  return (
    <main className="club-home" style={{ background: '#000', padding: '8px 0' }}>
      <section data-testid="fixture-section-spin" style={{ marginBottom: 16 }}>
        <LobbyTable
          entries={spinEntries}
          category="SPIN"
          selectedId={null}
          onSelect={() => {}}
          onActivate={() => {}}
          ctx={ctx}
        />
      </section>
      <section data-testid="fixture-section-sng" style={{ marginBottom: 16 }}>
        <LobbyTable
          entries={sngEntries}
          category="SNG"
          selectedId={null}
          onSelect={() => {}}
          onActivate={() => {}}
          ctx={ctx}
        />
      </section>
      <section data-testid="fixture-section-mtt" style={{ marginBottom: 16 }}>
        <LobbyTable
          entries={mttEntries}
          category="MTT"
          selectedId={null}
          onSelect={() => {}}
          onActivate={() => {}}
          ctx={ctx}
        />
      </section>
      <section data-testid="fixture-section-cash">
        <LobbyTable
          entries={cashEntries}
          category="HOLDEM"
          selectedId={null}
          onSelect={() => {}}
          onActivate={() => {}}
          ctx={ctx}
        />
      </section>
    </main>
  );
}

function FixtureApp() {
  return (
    <ToastProvider>
      <HashRouter>
        <Routes>
          <Route path="/hu-dialog" element={<HeadsUpDialogHarness />} />
          <Route path="/mobile-mtt" element={<MobileMttLobbyHarness />} />
          <Route path="/lobby-cards" element={<LobbyCardsHarness />} />
          <Route path="/i/:code" element={<InviteCodePage />} />
          <Route path="/invite/:clubId" element={<InvitePage />} />
          <Route path="/table/:tableId" element={<TableUnavailableHarness />} />
          <Route path="/clubs/:clubId" element={<ClubLandingProbe />} />
          <Route
            path="*"
            element={
              <div data-testid="fixture-home" data-cluster={CLUSTER_UUID}>
                Fixture Ready
              </div>
            }
          />
        </Routes>
      </HashRouter>
    </ToastProvider>
  );
}

createRoot(document.getElementById('root')!).render(<FixtureApp />);
