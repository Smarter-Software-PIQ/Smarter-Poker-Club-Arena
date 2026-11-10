/**
 * HEADS UP REMATCH - the host, end to end against a mocked database
 * (Dan 2026-11-08: "IF BOTH PLAYERS AGREE, THE MATCH STARTS AGAIN. THEY BOTH
 * 'BUY BACK IN'").
 *
 * Pins the behaviour, not the source: a heads-up card asks, shows the
 * opponent's question, and on a match only opens the table - the database
 * bought BOTH seats in the transaction that recorded the second Yes, so the
 * card never calls a seat purchase itself, however many answers say matched.
 * A refusal is said in words with nothing bought, and closing the card is a
 * No.
 */
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  state: [] as unknown[],
  respond: [] as unknown[],
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  format: { format_contract: 'sng-v1', max_players: 2 } as Record<string, unknown> | null,
}));

vi.mock('../../src/lib/authUtils', () => ({
  readLocalSession: () => ({ userId: 'u-hero' }),
}));

vi.mock('../../src/utils/errorReporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/utils/errorReporter')>()),
  reportError: vi.fn(),
  captureClientError: vi.fn(),
}));

vi.mock('../../src/lib/supabase', () => {
  const thenable = (value: unknown) => {
    const p: any = Promise.resolve(value);
    p.abortSignal = () => p;
    return p;
  };
  const from = (table: string) => {
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      abortSignal: () => builder,
      maybeSingle: async () =>
        table === 'tournaments' ? { data: db.format, error: null } : { data: null, error: null },
    };
    return builder;
  };
  const rpc = (fn: string, args: Record<string, unknown>) => {
    db.calls.push({ fn, args });
    if (fn === 'ca_heads_up_rematch_state') {
      const next = db.state.length > 1 ? db.state.shift() : db.state[0];
      return thenable({ data: next ?? { status: 'none' }, error: null });
    }
    if (fn === 'ca_heads_up_rematch_respond') {
      return thenable({ data: db.respond.shift() ?? { status: 'none' }, error: null });
    }
    return thenable({ data: null, error: null });
  };
  return { supabase: { from, rpc } };
});

import TournamentRankingHost from '../../src/components/tournament/TournamentRankingHost';
import { ToastProvider } from '../../src/components/common/Toast';
import {
  clearSessionSummary,
  peekSessionSummary,
  publishSessionSummary,
} from '../../src/services/pendingSessionSummary';

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

const renderHost = () =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/']}>
        <TournamentRankingHost />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );

const flush = async (ms = 0) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
};

let sequence = 0;
const publish = async () => {
  sequence += 1;
  await act(async () => {
    publishSessionSummary({
      duration: 120,
      handsPlayed: 30,
      handsWon: 15,
      totalRebuys: 0,
      profitLoss: 0,
      biggestPot: 0,
      peakStack: 0,
      tableName: 'Heads Up',
      tournament: {
        userId: 'u-hero',
        tournamentId: 'src-1',
        finishSequence: String(sequence),
        name: 'Heads Up',
        finishPlace: 2,
        entrants: 2,
        prize: 0,
        bountyWinnings: 0,
        knockouts: 0,
        rebuys: 0,
        addOns: 0,
      },
    });
  });
  await screen.findByRole('dialog', { name: /tournament ranking/i });
  await flush(20);
};

const rpcCalls = (fn: string) => db.calls.filter((c) => c.fn === fn);

describe('heads up rematch, from the card', { timeout: 20_000 }, () => {
  beforeAll(async () => {
    await import('../../src/components/tournament/TournamentRankingCard');
  });

  beforeEach(() => {
    db.state = [{ status: 'none', seconds_left: 170 }];
    db.respond = [];
    db.calls = [];
    db.format = { format_contract: 'sng-v1', max_players: 2 };
    clearSessionSummary();
  });

  afterEach(async () => {
    await act(async () => clearSessionSummary());
  });

  it('the asked player sees the question, says yes, and lands on the table without buying anything itself', async () => {
    db.state = [{ status: 'waiting_for_you', seconds_left: 50 }];
    renderHost();
    await publish();
    expect(screen.getByRole('status').textContent).toContain('Your Opponent Wants To Play Again');
    expect(screen.getByText('No Thanks')).toBeTruthy();

    db.respond = [
      { status: 'matched', table_id: 'tbl-9', seat_number: 2, cost: 20, asset: 'chips' },
    ];
    db.state = [{ status: 'matched', table_id: 'tbl-9', seat_number: 2, cost: 20, asset: 'chips' }];
    fireEvent.click(screen.getByText('Play Again'));
    fireEvent.click(screen.getByText('Play Again'));
    await flush();
    await flush(1600);
    await flush(1600);

    expect(rpcCalls('ca_heads_up_rematch_respond')[0].args).toEqual({
      p_source_tournament_id: 'src-1',
      p_accept: true,
    });
    expect(rpcCalls('ca_heads_up_rematch_respond')).toHaveLength(1);
    // The seats were bought by the database, together. The card buys nothing.
    expect(rpcCalls('fn_take_seat_and_buy_in')).toHaveLength(0);
    expect(screen.getByTestId('where').textContent).toBe('/table/tbl-9');
    expect(peekSessionSummary()).toBeNull();
  });

  it('the asking player waits with a countdown, then the match lands from the poll', async () => {
    renderHost();
    await publish();
    db.respond = [{ status: 'waiting_for_opponent', seconds_left: 59 }];
    db.state = [{ status: 'waiting_for_opponent', seconds_left: 57 }];
    fireEvent.click(screen.getByText('Play Again'));
    await flush();
    expect(screen.getByRole('status').textContent).toContain('Waiting For Your Opponent 59s');

    db.state = [{ status: 'matched', table_id: 'tbl-3', seat_number: 1 }];
    await flush(1600);
    await flush(1600);
    expect(rpcCalls('fn_take_seat_and_buy_in')).toHaveLength(0);
    expect(screen.getByTestId('where').textContent).toBe('/table/tbl-3');
  });

  it('a refused buy-back-in is said in words and leaves the ordinary Play Again', async () => {
    db.state = [{ status: 'buy_in_refused', reason: 'insufficient_balance' }];
    renderHost();
    await publish();
    await flush(1600);
    expect(screen.getByRole('status').textContent).toContain('Your Rematch Could Not Start');
    expect(screen.getAllByText('Not Enough Chips For This Buy In').length).toBeGreaterThan(0);
    expect(screen.getByText('Find A New Game')).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe('/');
    expect(rpcCalls('fn_take_seat_and_buy_in')).toHaveLength(0);
  });

  it('the opponent who could not pay is told only that the rematch could not start', async () => {
    db.state = [{ status: 'buy_in_refused' }];
    renderHost();
    await publish();
    await flush(1600);
    expect(screen.getByRole('status').textContent).toContain('Your Rematch Could Not Start');
    expect(screen.queryByText('Not Enough Chips For This Buy In')).toBeNull();
    expect(screen.getByText('Find A New Game')).toBeTruthy();
  });

  it('the opponent leaving is said, and the polling stops', async () => {
    db.state = [{ status: 'opponent_declined' }];
    renderHost();
    await publish();
    expect(screen.getByRole('status').textContent).toContain('Your Opponent Left');
    const polls = rpcCalls('ca_heads_up_rematch_state').length;
    await flush(1600);
    await flush(1600);
    expect(rpcCalls('ca_heads_up_rematch_state').length).toBe(polls);
  });

  it('closing the card is a No', async () => {
    db.state = [{ status: 'waiting_for_you', seconds_left: 40 }];
    renderHost();
    await publish();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    await flush();
    expect(rpcCalls('ca_heads_up_rematch_respond').map((c) => c.args.p_accept)).toEqual([false]);
    expect(peekSessionSummary()).toBeNull();
  });

  it('a result that is not heads-up never asks', async () => {
    db.format = { format_contract: 'spin-v1', max_players: 3 };
    renderHost();
    await publish();
    await flush(1600);
    expect(rpcCalls('ca_heads_up_rematch_state')).toHaveLength(0);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
  });
});
