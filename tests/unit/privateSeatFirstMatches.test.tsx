// @vitest-environment happy-dom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import {
  extractOfferedPrivateTemplates,
  offeredGamesFor,
  offeredStacksFor,
  offeredStakesFor,
  resolveOfferedTemplate,
  type OfferedBoardRow,
} from '../../src/lib/privateSeatFirstMatch';
import { CreatePrivateMatchModal } from '../../src/components/lobby/CreatePrivateMatchModal';
import { PrivateMatchTopBar } from '../../src/components/lobby/PrivateMatchTopBar';
import { PrivateGameInviteModal } from '../../src/components/table/PrivateGameInviteModal';

const rpcMock = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: rpcMock.rpc,
  },
}));

const OFFERED_BOARDS: OfferedBoardRow[] = [
  {
    id: 'hu-nlh-10-deep',
    name: '10 Chip Heads-Up NLH',
    game_type: 'NLH',
    variant: 'sng',
    tournament_type: 'SNG',
    format_contract: 'sng-v1',
    buy_in_amount: 9.5,
    buy_in_fee: 0.5,
    starting_chips: 1000,
    max_players: 2,
    status: 'REGISTERING',
  },
  {
    id: 'hu-nlh-10-turbo',
    name: '10 Chip Heads-Up NLH Turbo',
    game_type: 'NLH',
    variant: 'sng',
    tournament_type: 'SNG',
    format_contract: 'sng-v1',
    buy_in_amount: 9.5,
    buy_in_fee: 0.5,
    starting_chips: 300,
    max_players: 2,
    status: 'REGISTERING',
  },
  {
    id: 'hu-plo-25-deep',
    name: '25 Chip Heads-Up PLO',
    game_type: 'PLO4',
    variant: 'sng',
    tournament_type: 'SNG',
    format_contract: 'sng-v1',
    buy_in_amount: 23.75,
    buy_in_fee: 1.25,
    starting_chips: 1000,
    max_players: 2,
    status: 'REGISTERING',
  },
  {
    // Satellite must be excluded from offered private Heads-Up templates.
    id: 'hu-sat-50',
    name: 'Satellite Into Sunday 200',
    game_type: 'NLH',
    variant: 'sng',
    tournament_type: 'SATELLITE',
    format_contract: 'seat-first-satellite-v1',
    is_satellite: true,
    buy_in_amount: 50,
    buy_in_fee: 0,
    starting_chips: 1500,
    max_players: 2,
    status: 'REGISTERING',
  },
  {
    // Cancelled board must NEVER be selectable.
    id: 'hu-cancelled-500',
    name: '500 Chip Heads-Up NLH',
    game_type: 'NLH',
    variant: 'sng',
    tournament_type: 'SNG',
    format_contract: 'sng-v1',
    buy_in_amount: 475,
    buy_in_fee: 25,
    starting_chips: 1000,
    max_players: 2,
    status: 'CANCELLED',
  },
  {
    id: 'spin-nlh-5-turbo',
    name: '5 Chip Spin NLH',
    game_type: 'NLH',
    variant: 'spin',
    tournament_type: 'SPIN',
    format_contract: 'spin-v1',
    buy_in_amount: 5,
    buy_in_fee: 0,
    starting_chips: 300,
    max_players: 3,
    status: 'REGISTERING',
  },
  {
    id: 'spin-plo-25-deep',
    name: '25 Chip Spin PLO',
    game_type: 'PLO4',
    variant: 'spin',
    tournament_type: 'SPIN',
    format_contract: 'spin-v1',
    buy_in_amount: 25,
    buy_in_fee: 0,
    starting_chips: 1000,
    max_players: 3,
    status: 'REGISTERING',
  },
];

describe('Player-created Private Heads-Up & Private Spin matches (offered boards only)', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('extractOfferedPrivateTemplates exposes ONLY currently offered public boards and excludes satellites, cancelled, and existing private matches', () => {
    const hu = extractOfferedPrivateTemplates(
      OFFERED_BOARDS,
      'heads_up',
      new Set(['hu-plo-25-deep'])
    );
    expect(hu.map((t) => t.id)).toEqual(['hu-nlh-10-turbo', 'hu-nlh-10-deep']);
    expect(offeredGamesFor(hu)).toEqual([{ gameType: 'nlh', gameLabel: 'NLH' }]);
    expect(offeredStakesFor(hu, 'nlh')).toEqual([10]);
    expect(offeredStacksFor(hu, 'nlh', 10)).toEqual([300, 1000]);
    expect(resolveOfferedTemplate(hu, 'nlh', 500, 1000)).toBeNull();

    const spins = extractOfferedPrivateTemplates(OFFERED_BOARDS, 'spin');
    expect(spins.map((t) => t.id)).toEqual(['spin-nlh-5-turbo', 'spin-plo-25-deep']);
    expect(offeredGamesFor(spins)).toEqual([
      { gameType: 'nlh', gameLabel: 'NLH' },
      { gameType: 'plo4', gameLabel: 'PLO' },
    ]);
  });

  it('CreatePrivateMatchModal cascades ONLY offered Games, Stakes, and Starting Chips and submits the matched offered template ID', async () => {
    const hu = extractOfferedPrivateTemplates(OFFERED_BOARDS, 'heads_up');
    const onCreated = vi.fn();
    rpcMock.rpc.mockResolvedValue({
      data: {
        ok: true,
        created: true,
        format: 'heads_up',
        permanent_private: true,
        tournament_id: 'priv-hu-1',
        table_id: 'tbl-hu-1',
        invite_token: 'tok_abcdefghijklmnop',
        live: true,
        exclusive: true,
        seats_held: 1,
        held_open: 1,
      },
      error: null,
    });

    render(
      <CreatePrivateMatchModal
        isOpen
        format="heads_up"
        templates={hu}
        onCreated={onCreated}
        onClose={() => {}}
      />
    );

    const gameGroup = document.querySelector('[data-testid="private-game-choices"]') as HTMLElement;
    const stakeGroup = document.querySelector(
      '[data-testid="private-stake-choices"]'
    ) as HTMLElement;
    const stackGroup = document.querySelector(
      '[data-testid="private-stack-choices"]'
    ) as HTMLElement;

    // Initial selection is NLH -> only stake 10 offered, stacks 300 & 1,000 offered.
    expect(
      within(gameGroup)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['NLH', 'PLO']);
    expect(
      within(stakeGroup)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['10']);
    expect(within(stackGroup).getAllByRole('button').length).toBe(2);

    // Switching to PLO restricts stakes strictly to PLO's offered stake (25) and stack (1,000).
    fireEvent.click(within(gameGroup).getByRole('button', { name: 'PLO' }));
    await waitFor(() => {
      expect(
        within(stakeGroup)
          .getAllByRole('button')
          .map((b) => b.textContent)
      ).toEqual(['25']);
    });
    expect(within(stackGroup).getAllByRole('button').length).toBe(1);

    fireEvent.click(within(document.body).getByRole('button', { name: /Create & Buy In/ }));
    await waitFor(() => {
      expect(rpcMock.rpc).toHaveBeenCalledWith('fn_create_private_seat_first_match', {
        p_source_tournament_id: 'hu-plo-25-deep',
      });
    });
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        tournamentId: 'priv-hu-1',
        tableId: 'tbl-hu-1',
        permanentPrivate: true,
      })
    );
  });

  it('PrivateMatchTopBar renders at the top with Create, Share Link, and Unregister & Close controls', () => {
    const onOpenCreate = vi.fn();
    const onShareLink = vi.fn();
    const onCloseMatch = vi.fn();

    render(
      <PrivateMatchTopBar
        format="heads_up"
        canCreate
        activeMatches={[
          {
            info: {
              tournamentId: 'priv-hu-1',
              tableId: 'tbl-hu-1',
              format: 'heads_up',
              isCreator: true,
              inviteToken: 'tok_abcdefghijklmnop',
              sourceTournamentId: 'hu-nlh-10-deep',
              status: 'open',
            },
            name: '10 Chip Heads-Up NLH',
            seatsLabel: '1/2 Seated',
          },
        ]}
        closingId={null}
        onOpenCreate={onOpenCreate}
        onOpenMatch={() => {}}
        onShareLink={onShareLink}
        onCloseMatch={onCloseMatch}
      />
    );

    fireEvent.click(document.querySelector('[data-testid="create-private-hu-btn"]') as HTMLElement);
    expect(onOpenCreate).toHaveBeenCalledTimes(1);

    fireEvent.click(
      document.querySelector('[data-testid="active-private-share-btn"]') as HTMLElement
    );
    expect(onShareLink).toHaveBeenCalledTimes(1);

    fireEvent.click(
      document.querySelector('[data-testid="active-private-close-btn"]') as HTMLElement
    );
    expect(onCloseMatch).toHaveBeenCalledWith('priv-hu-1');
  });

  it('PrivateGameInviteModal shows Private Only and Unregister & Close (never Cancel Hold or timer) for permanent private matches', () => {
    const onCancel = vi.fn();
    render(
      <PrivateGameInviteModal
        isOpen
        step="held"
        formatLabel="Heads Up Sit N Go"
        tableName="10 Chip Heads-Up NLH"
        costLabel="10"
        maxHoldable={1}
        alreadySeated
        hold={{
          tournamentId: 'priv-hu-1',
          tableId: 'tbl-hu-1',
          inviteToken: 'tok_abcdefghijklmnop',
          isCreator: true,
          live: true,
          outcome: 'holding',
          exclusive: true,
          permanentPrivate: true,
          seatsHeld: 1,
          heldOpen: 1,
          expiresAtMs: Date.now() + 600_000,
          inviterName: null,
          tokenValid: false,
          admitted: false,
        }}
        inviteUrl="https://smarter.poker/g/tbl-hu-1?invite=tok_abcdefghijklmnop"
        onStart={() => {}}
        onCancelHold={onCancel}
        onTakeSeat={() => {}}
        onClose={() => {}}
      />
    );

    expect(document.body.textContent).toContain('Private Only');
    expect(document.body.textContent).not.toContain('Cancel Hold');
    const closeBtn = within(document.body).getByRole('button', { name: 'Unregister & Close' });
    fireEvent.click(closeBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('new CSS files obey Club Arena touch-first zero :hover law and 44px tap targets', () => {
    for (const rel of [
      '../../src/components/lobby/CreatePrivateMatchModal.css',
      '../../src/components/lobby/PrivateMatchTopBar.css',
    ]) {
      const css = readFileSync(resolve(__dirname, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css).not.toMatch(/:hover\b/);
      expect(css).toContain('min-height: 44px');
    }
  });
});
