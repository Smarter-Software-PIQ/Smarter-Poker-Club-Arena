import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rpcMock = vi.hoisted(() => vi.fn());
const reportErrorMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

vi.mock('../../src/utils/errorReporter', () => ({
  reportError: reportErrorMock,
}));

import {
  MIDWAY_MTT_SERVER_UPDATE_POPUP_MESSAGE,
  readTournamentStartHoldStatus,
  resetTournamentStartHoldCacheForTests,
  useTournamentStartHold,
} from '../../src/hooks/useTournamentStartHold';
import { MidwayMttServerUpdateModal } from '../../src/components/tournament/MidwayMttServerUpdateModal';
import { registerReasonText } from '../../src/services/TournamentService';

const ROOT = resolve(__dirname, '../..');
const read = (relPath: string) => readFileSync(resolve(ROOT, relPath), 'utf8');

describe('Midway Union MTT server-update popup & +3h 30m schedule shift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTournamentStartHoldCacheForTests();
  });

  it('defines the exact owner-requested popup message', () => {
    expect(MIDWAY_MTT_SERVER_UPDATE_POPUP_MESSAGE).toBe(
      "MIDWAY UNION MTT'S ARE ON A SERVER UPDATE, THEY WILL BE BACK ONLINE AND RUNNING AT 6PM CST. ALL GAMES ARE FROZE UNTIL THE FINAL SERVER UPDATE IS COMPLETED."
    );
    expect(registerReasonText('operator_floor_parked')).toBe(
      MIDWAY_MTT_SERVER_UPDATE_POPUP_MESSAGE
    );
  });

  it('renders MidwayMttServerUpdateModal with the exact message when open and closes on Understood', () => {
    const onClose = vi.fn();
    render(<MidwayMttServerUpdateModal isOpen={true} onClose={onClose} />);

    expect(screen.getByTestId('midway-mtt-update-modal-message')).toHaveTextContent(
      MIDWAY_MTT_SERVER_UPDATE_POPUP_MESSAGE
    );
    expect(screen.getByText('Server Update Notice')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('midway-mtt-update-modal-ack'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render MidwayMttServerUpdateModal when isOpen is false', () => {
    render(<MidwayMttServerUpdateModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('midway-mtt-update-modal-message')).not.toBeInTheDocument();
  });

  it('reads hold status from fn_get_tournament_start_hold_status and caches within TTL', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        blocked: true,
        reason: 'Owner hold until 6PM CST',
        requested_at: '2026-11-02T20:28:18.698Z',
        popup_message: MIDWAY_MTT_SERVER_UPDATE_POPUP_MESSAGE,
      },
      error: null,
    });

    const { result } = renderHook(() => useTournamentStartHold());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.blocked).toBe(true);
    expect(result.current.popupMessage).toBe(MIDWAY_MTT_SERVER_UPDATE_POPUP_MESSAGE);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('fn_get_tournament_start_hold_status');

    // Second call uses in-memory TTL cache without a duplicate RPC round-trip
    const second = await readTournamentStartHoldStatus();
    expect(second.blocked).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);

    // Force refresh re-queries the RPC
    rpcMock.mockResolvedValueOnce({
      data: {
        blocked: false,
        reason: 'Released at 6PM CST',
        requested_at: '2026-11-03T00:00:00.000Z',
        popup_message: null,
      },
      error: null,
    });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.blocked).toBe(false);
    expect(result.current.popupMessage).toBeNull();
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it('wires MidwayMttServerUpdateModal into ClubHomePage, TournamentLobbyPage, TournamentDetails, and useTournamentRegistration', () => {
    const clubHome = read('src/pages/ClubHomePage.tsx');
    const lobbyPage = read('src/pages/tournament/TournamentLobbyPage.tsx');
    const detailsPage = read('src/pages/tournament/TournamentDetails.tsx');
    const regHook = read('src/hooks/useTournamentRegistration.ts');

    for (const [name, src] of [
      ['ClubHomePage.tsx', clubHome],
      ['TournamentLobbyPage.tsx', lobbyPage],
      ['TournamentDetails.tsx', detailsPage],
    ] as const) {
      expect(src, `${name} must use useTournamentStartHold`).toContain('useTournamentStartHold');
      expect(src, `${name} must render MidwayMttServerUpdateModal`).toContain(
        '<MidwayMttServerUpdateModal'
      );
    }

    expect(regHook).toContain('readTournamentStartHoldStatus');
    expect(regHook).toContain('MIDWAY_MTT_SERVER_UPDATE_POPUP_MESSAGE');
  });

  it('declares the migration with fn_get_tournament_start_hold_status, seat-acquisition hold guard, and all 18 shifted Midway Union MTTs', () => {
    const migration = read(
      'supabase/migrations/20261102204000_midway_mtt_server_update_hold_and_schedule_shift.sql'
    );

    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.fn_get_tournament_start_hold_status()'
    );
    expect(migration).toContain(
      "MIDWAY UNION MTT''S ARE ON A SERVER UPDATE, THEY WILL BE BACK ONLINE AND RUNNING AT 6PM CST. ALL GAMES ARE FROZE UNTIL THE FINAL SERVER UPDATE IS COMPLETED."
    );
    expect(migration).toContain('public.fn_ca_new_tournament_starts_blocked()');
    expect(migration).toContain('public.fn_ca_launch_tournament_has_started(');
    expect(migration).toContain(
      "set_config('app.owner_tournament_start_shift', 'fe763bed-7adb-4146-824b-b547e2779b83', true)"
    );

    const expectedIds = [
      '37ad7860-3743-46e6-9a39-6701aa1b648a',
      '6b504816-aec0-49f9-8c5c-89baacc37f3b',
      'bc8150f7-e744-465a-a3bf-8a6e6804e2a1',
      '0d73ad93-ae1e-4ddd-9926-94833e26b006',
      'fb2d3bb5-f092-4b9a-80dd-517b9ec04ee9',
      '0778af66-7924-44dd-b537-56af19adf1ad',
      '31ac3b30-0b30-4d52-af51-b6d9313821c8',
      '5c0f2270-9494-496f-8d89-2c03f6964dd1',
      '92b3acdb-eddd-4162-b8ee-58ea18b90abd',
      'c6a0efb2-c668-48fd-a954-7c56e389a9fe',
      '2932d8c3-eb6a-4c0a-a6fe-db075255f5c4',
      '90603e12-b9e1-46a0-aa48-8f1880b9a77d',
      '83815033-02a7-4e25-adde-cad5992ec8bb',
      'e24f2f82-c8e6-4141-8ff2-93f082947c02',
      '0ed2aeb4-7c86-4544-aa37-1f6445acccd2',
      '13c60a03-75a9-4301-a17f-b7e7ff69ba6d',
      '6c38d6e5-1558-4504-8375-002fb6cf586c',
      '96019aab-25ed-4b13-8228-0f4852659299',
    ];
    for (const id of expectedIds) {
      expect(migration).toContain(id);
    }
  });
});
