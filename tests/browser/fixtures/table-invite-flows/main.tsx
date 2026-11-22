import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { ToastProvider } from '../../../../src/components/common/Toast';
import { HeadsUpWaitingModal } from '../../../../src/components/table/HeadsUpWaitingModal';
import { TableLoadFailureOverlay } from '../../../../src/components/table/TableLoadFailureOverlay';
import LobbyTable from '../../../../src/components/lobby/LobbyTable';
import {
  tournamentEntry,
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

function FixtureApp() {
  return (
    <ToastProvider>
      <HashRouter>
        <Routes>
          <Route path="/hu-dialog" element={<HeadsUpDialogHarness />} />
          <Route path="/mobile-mtt" element={<MobileMttLobbyHarness />} />
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
