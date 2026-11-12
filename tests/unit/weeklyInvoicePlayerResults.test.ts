import { describe, expect, it } from 'vitest';
import { parseUnionStatementBoard } from '../../src/utils/unionStatementBoard';
const board = () => ({
  union_id: 'union-a',
  union_name: 'Midway Union',
  period_start: '2026-09-07',
  period_end: '2026-09-14',
  totals: {
    clubs: 1,
    issued: 1,
    missing: 0,
    delivered: 1,
    paid: 0,
    clubs_owe: 120.25,
    union_owes: 0,
    net: 120.25,
    collected: 0,
    outstanding: 120.25,
    rake_generated: 200,
    eco_amount: 0,
  },
  clubs: [
    {
      club_id: 'club-a',
      club_name: 'Shark Club',
      club_code: null,
      club_slug: 'shark-club',
      invoice_id: 'invoice-a',
      snapshot_complete: true,
      status: 'generated',
      issued_at: '2026-09-14T09:00:00Z',
      due_at: '2026-09-21T09:00:00Z',
      amount: 120.25,
      direction: 'club owes union',
      message_sent: true,
      overdue: false,
      paid_total: 0,
      outstanding: 120.25,
      rake_generated: 200,
      rakeback_due: 180,
      union_fee_kept: 20,
      players_won: 0,
      eco_amount: 0,
      presettled: 0,
    },
  ],
  history: [
    {
      period_start: '2026-09-07',
      period_end: '2026-09-14',
      clubs: 1,
      total_amount: 120.25,
      rake_generated: 200,
      eco_amount: 0,
      paid: 0,
      delivered: 1,
    },
  ],
  generated_at: '2026-10-03T12:00:00Z',
});

const facts = () => ({
  version: 1,
  sign_convention: 'positive_club_owes_union',
  cash_net_loss: 350,
  tournament_net_loss: -50,
  total_net_loss: 300,
  rakeback_credit: 180,
  eco_charge: 0,
  weekly_net_due_to_union: 120,
});
function value() {
  const v: any = board();
  v.clubs[0].players_won = -300;
  v.clubs[0].weekly_player_results = facts();
  return v;
}
describe('original weekly invoice player results', () => {
  it('separates the full weekly net from the actual unpaid invoice balance', () => {
    const result = parseUnionStatementBoard(value(), 'union-a', '2026-09-14');
    expect(result.clubs[0].weekly_player_results?.weekly_net_due_to_union).toBe(120);
    expect(result.clubs[0].outstanding).toBe(120.25);
  });
  it('keeps historical activity splits unavailable', () => {
    expect(
      parseUnionStatementBoard(board(), 'union-a', '2026-09-14').clubs[0].weekly_player_results
    ).toBeNull();
  });
  it.each(['total_net_loss', 'rakeback_credit', 'eco_charge', 'weekly_net_due_to_union'])(
    'refuses an inconsistent %s rather than displaying a false bill',
    (field) => {
      const v = value();
      v.clubs[0].weekly_player_results[field] += 0.01;
      expect(() => parseUnionStatementBoard(v, 'union-a', '2026-09-14')).toThrow(
        'do not reconcile'
      );
    }
  );
  it('retains the winning-player sign and independent ECO charge', () => {
    const v = value();
    v.clubs[0].players_won = 300;
    v.clubs[0].eco_amount = -12;
    v.totals.eco_amount = -12;
    Object.assign(v.clubs[0].weekly_player_results, {
      cash_net_loss: -350,
      tournament_net_loss: 50,
      total_net_loss: -300,
      eco_charge: 12,
      weekly_net_due_to_union: -468,
    });
    expect(
      parseUnionStatementBoard(v, 'union-a', '2026-09-14').clubs[0].weekly_player_results
        ?.weekly_net_due_to_union
    ).toBe(-468);
  });
});
