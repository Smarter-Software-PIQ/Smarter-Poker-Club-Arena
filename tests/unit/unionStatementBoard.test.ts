import { unionEcoSettingsPatch } from '../../src/utils/unionEco';
import { describe, expect, it } from 'vitest';
import {
  chicagoInstantLabel,
  parseUnionStatementBoard,
  unionStatementAmountDue,
  unionStatementPayLine,
  unionStatementWeekLabel,
} from '../../src/utils/unionStatementBoard';
import weekEndingNov9 from '../fixtures/union-invoice-week-2026-11-02/board.json';

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

describe('parseUnionStatementBoard', () => {
  it('accepts a fully reconciled board bound to the requested union and period', () => {
    expect(parseUnionStatementBoard(board(), 'union-a', '2026-09-14')).toMatchObject({
      union_id: 'union-a',
      totals: { net: 120.25, outstanding: 120.25 },
      clubs: [{ invoice_id: 'invoice-a', snapshot_complete: true }],
    });
  });

  it('keeps explicitly unavailable legacy payment details unknown while retaining invoice amounts', () => {
    const value: any = board();
    value.clubs[0].status = 'paid';
    value.clubs[0].payment_details_available = false;
    value.clubs[0].paid_total = null;
    value.clubs[0].outstanding = null;
    value.totals.paid = 1;
    value.totals.payment_details_available = false;
    value.totals.collected = null;
    value.totals.outstanding = null;
    expect(parseUnionStatementBoard(value, 'union-a', '2026-09-14')).toMatchObject({
      totals: { collected: null, outstanding: null, net: 120.25 },
      clubs: [
        {
          status: 'paid',
          amount: 120.25,
          paid_total: null,
          outstanding: null,
          payment_details_available: false,
        },
      ],
    });
    value.totals.outstanding = 0;
    expect(() => parseUnionStatementBoard(value, 'union-a', '2026-09-14')).toThrow(/availability/);
  });

  it('continues to refuse a paid modern invoice whose explicit payment detail contradicts its balance', () => {
    const value: any = board();
    value.clubs[0].status = 'paid';
    value.clubs[0].payment_details_available = true;
    value.totals.paid = 1;
    expect(() => parseUnionStatementBoard(value, 'union-a', '2026-09-14')).toThrow(
      'Paid statement still has an outstanding balance'
    );
  });

  it('binds a current absolute invoice amount to its persisted union-owes direction', () => {
    const value = board();
    value.clubs[0].direction = 'union owes club';

    expect(parseUnionStatementBoard(value, 'union-a', '2026-09-14')).toMatchObject({
      clubs: [{ amount: -120.25, direction: 'union owes club' }],
      totals: { clubs_owe: 0, union_owes: 120.25, net: -120.25 },
    });
  });

  it('accepts a future signed board projection when its direction and totals reconcile', () => {
    const value = board();
    value.clubs[0].amount = -120.25;
    value.clubs[0].direction = 'union owes club';
    value.totals.clubs_owe = 0;
    value.totals.union_owes = 120.25;
    value.totals.net = -120.25;

    expect(parseUnionStatementBoard(value, 'union-a', '2026-09-14')).toMatchObject({
      clubs: [{ amount: -120.25 }],
      totals: { clubs_owe: 0, union_owes: 120.25, net: -120.25 },
    });
  });

  it('rejects a nonzero square statement rather than inventing its direction', () => {
    const value = board();
    value.clubs[0].direction = 'square';

    expect(() => parseUnionStatementBoard(value, 'union-a', '2026-09-14')).toThrow(
      /square statement carries a nonzero amount/i
    );
  });

  it('rejects signed totals that match neither the current nor normalized projection', () => {
    const value = board();
    value.clubs[0].direction = 'union owes club';
    value.totals.net = 10;

    expect(() => parseUnionStatementBoard(value, 'union-a', '2026-09-14')).toThrow(
      /signed totals do not reconcile/i
    );
  });

  it('rejects a signed amount that contradicts a club-owes direction', () => {
    const value = board();
    value.clubs[0].amount = -120.25;
    value.totals.clubs_owe = 0;
    value.totals.union_owes = 120.25;
    value.totals.net = -120.25;

    expect(() => parseUnionStatementBoard(value, 'union-a', '2026-09-14')).toThrow(
      /contradicts its club-owes direction/i
    );
  });

  it('accepts the exact missing-statement row emitted for a current club with no invoice', () => {
    const value = board() as any;
    value.period_start = null;
    value.totals = {
      clubs: 1,
      issued: 0,
      missing: 1,
      delivered: 0,
      paid: 0,
      clubs_owe: 0,
      union_owes: 0,
      net: 0,
      collected: 0,
      outstanding: 0,
      rake_generated: 0,
      eco_amount: 0,
    };
    value.clubs[0] = {
      ...value.clubs[0],
      invoice_id: null,
      snapshot_complete: false,
      status: 'missing',
      issued_at: null,
      due_at: null,
      amount: 0,
      direction: null,
      message_sent: false,
      overdue: false,
      paid_total: 0,
      outstanding: 0,
      rake_generated: 0,
      rakeback_due: 0,
      union_fee_kept: 0,
      players_won: 0,
      eco_amount: 0,
      presettled: 0,
    };

    expect(parseUnionStatementBoard(value, 'union-a', '2026-09-14')).toMatchObject({
      period_start: null,
      totals: { issued: 0, missing: 1 },
      clubs: [{ status: 'missing', invoice_id: null, snapshot_complete: false }],
    });
  });

  it.each(['open', 'awaiting_payment', 'partial'])(
    'rejects SQL-impossible %s statement status',
    (status) => {
      const value = board();
      value.clubs[0].status = status;
      expect(() => parseUnionStatementBoard(value, 'union-a', '2026-09-14')).toThrow(
        /status is invalid/
      );
    }
  );

  it.each([
    ['another union', (value: ReturnType<typeof board>) => (value.union_id = 'union-b')],
    ['another period', (value: ReturnType<typeof board>) => (value.period_end = '2026-09-15')],
    [
      'an incomplete snapshot',
      (value: ReturnType<typeof board>) => (value.clubs[0].snapshot_complete = false),
    ],
    [
      'an unknown status',
      (value: ReturnType<typeof board>) => (value.clubs[0].status = 'invented'),
    ],
    [
      'a malformed amount',
      (value: ReturnType<typeof board>) => (value.clubs[0].amount = Number.NaN),
    ],
    ['an unreconciled row', (value: ReturnType<typeof board>) => (value.clubs[0].outstanding = 1)],
    ['an unreconciled total', (value: ReturnType<typeof board>) => (value.totals.net = 999)],
  ])('rejects %s', (_label, mutate) => {
    const value = board();
    mutate(value);
    expect(() => parseUnionStatementBoard(value, 'union-a', '2026-09-14')).toThrow(/statement/i);
  });

  it('rejects duplicate invoice identities before any mutation can use them', () => {
    const value = board();
    value.clubs.push({ ...value.clubs[0], club_id: 'club-b' });
    value.totals = {
      ...value.totals,
      clubs: 2,
      issued: 2,
      delivered: 2,
      clubs_owe: 240.5,
      net: 240.5,
      outstanding: 240.5,
      rake_generated: 400,
    };
    expect(() => parseUnionStatementBoard(value, 'union-a', '2026-09-14')).toThrow(
      /invoice is duplicated/
    );
  });
});

it('retains historical combined ECO without inventing a zero split', () => {
  const parsed = parseUnionStatementBoard(board(), 'union-a', '2026-09-14');
  expect(parsed.clubs[0].eco_components).toBeNull();
  expect(parsed.totals.cash_eco_amount).toBeNull();
  expect(parsed.totals.tournament_eco_amount).toBeNull();
  expect(parsed.history[0].eco_components_complete).toBe(false);
});

it('validates both original recorded ECO lanes and complete-only totals', () => {
  const value: any = board();
  const components = [
    {
      activity: 'cash',
      enabled: true,
      base_mode: 'club_profit',
      base: 100.05,
      rate: 0.1,
      amount: -10.01,
      terms_id: '11111111-1111-4111-8111-111111111111',
      record_id: '22222222-2222-4222-8222-222222222222',
      status: 'recorded',
    },
    {
      activity: 'tournament',
      enabled: true,
      base_mode: 'club_profit',
      base: -100.05,
      rate: 0.1,
      amount: 10.01,
      terms_id: '11111111-1111-4111-8111-111111111111',
      record_id: '33333333-3333-4333-8333-333333333333',
      status: 'recorded',
    },
  ];
  Object.assign(value.clubs[0], { eco_version: 2, eco_components: components });
  Object.assign(value.totals, {
    eco_components_complete: true,
    cash_eco_amount: -10.01,
    tournament_eco_amount: 10.01,
  });
  expect(parseUnionStatementBoard(value, 'union-a', '2026-09-14').totals.cash_eco_amount).toBe(
    -10.01
  );
  value.totals.cash_eco_amount = -10;
  expect(() => parseUnionStatementBoard(value, 'union-a', '2026-09-14')).toThrow(/ECO/);
  value.totals.cash_eco_amount = -10.01;
  components[1].activity = 'cash';
  expect(() => parseUnionStatementBoard(value, 'union-a', '2026-09-14')).toThrow(/ECO/);
});

it('requires an explicit complete two-lane settings patch and leaves legacy generic saves untouched', () => {
  expect(unionEcoSettingsPatch({ eco_cash_rate: 0.1 }, false)).toEqual({});
  expect(() => unionEcoSettingsPatch({ eco_cash_rate: 0.1 }, true)).toThrow(/Both ECO/);
  const settings = {
    eco_cash_enabled: true,
    eco_cash_rate: 0.1,
    eco_tournament_enabled: true,
    eco_tournament_rate: 0.1,
  };
  expect(unionEcoSettingsPatch(settings, true)).toEqual(settings);
  expect(() => unionEcoSettingsPatch({ ...settings, eco_cash_rate: NaN }, true)).toThrow();
});

describe('the stored week, the parties and the amount due (week ending 2026-11-09)', () => {
  const UNION = 'fade0000-0000-0000-0000-000000000001';
  const fresh = (): any => structuredClone(weekEndingNov9);
  const parsed = () => parseUnionStatementBoard(fresh(), UNION, '2026-11-09');
  const byInvoice = (n: string) => parsed().clubs.find((c) => c.invoice_number === n)!;

  it('reads all five stored invoices and separates the union house row by identity', () => {
    const board = parsed();
    expect(board.clubs.map((c) => c.invoice_number).sort()).toEqual([
      'MIDWAY-2026-000037',
      'MIDWAY-2026-000038',
      'MIDWAY-2026-000039',
      'MIDWAY-2026-000040',
      'MIDWAY-2026-000041',
    ]);
    expect(board.clubs.filter((c) => c.union_house).map((c) => c.invoice_number)).toEqual([
      'MIDWAY-2026-000040',
    ]);
    // The house row is the union owing its own house club, not "clubs owe".
    expect(board.totals).toMatchObject({ clubs_owe: 191267.54, union_owes: 21.25, net: 191246.29 });
  });

  it('prints the week from the stored instants as [2:00 AM, 2:00 AM) Chicago', () => {
    const board = parsed();
    expect(unionStatementWeekLabel(board.period_start_at, board.period_end_at)).toBe(
      'Mon Nov 2, 2026 2:00 AM to Mon Nov 9, 2026 2:00 AM Chicago Time'
    );
    for (const club of board.clubs)
      expect(unionStatementWeekLabel(club.period_start_at, club.period_end_at)).toBe(
        'Mon Nov 2, 2026 2:00 AM to Mon Nov 9, 2026 2:00 AM Chicago Time'
      );
  });

  it('keeps 2:00 AM at both ends across the daylight-saving change, and the boundary instant itself', () => {
    // CDT start (07:00Z) to CST end (08:00Z): 169 hours, still 2:00 AM to 2:00 AM.
    expect(unionStatementWeekLabel('2026-10-26T07:00:00+00:00', '2026-11-02T08:00:00+00:00')).toBe(
      'Mon Oct 26, 2026 2:00 AM to Mon Nov 2, 2026 2:00 AM Chicago Time'
    );
    expect(chicagoInstantLabel('2026-11-09T08:00:00Z')).toBe('Mon Nov 9, 2026 2:00 AM');
    expect(chicagoInstantLabel('2026-11-09T07:59:59Z')).toBe('Mon Nov 9, 2026 1:59 AM');
    expect(chicagoInstantLabel('2026-11-09T08:00:59Z')).toBe('Mon Nov 9, 2026 2:00 AM');
    // Spring forward: the 2026-03-09 boundary is 07:00Z, still 2:00 AM local.
    expect(chicagoInstantLabel('2026-03-09T07:00:00Z')).toBe('Mon Mar 9, 2026 2:00 AM');
    // Adding 24 h to a date would read 1:00 AM here; the zone rules do not.
    expect(chicagoInstantLabel('2026-11-02T08:00:00Z')).toBe('Mon Nov 2, 2026 2:00 AM');
  });

  it('says who pays whom for each of the five invoices', () => {
    const line = (n: string) => {
      const club = byInvoice(n);
      return unionStatementPayLine(club, club.club_name, 'Midway Union');
    };
    expect(line('MIDWAY-2026-000038')).toBe('Deep Stack Society Pays Midway Union');
    expect(line('MIDWAY-2026-000041')).toBe('The Felt Society Pays Midway Union');
    expect(line('MIDWAY-2026-000039')).toBe('KINGS CLUB Pays Midway Union');
    expect(line('MIDWAY-2026-000040')).toBe('Midway Union Pays Midway Union (House Club)');
    expect(line('MIDWAY-2026-000037')).toBe('Square, Nothing Due');
  });

  it('reconciles each amount due from its stored components to the cent', () => {
    const deep = byInvoice('MIDWAY-2026-000038');
    expect(deep).toMatchObject({
      amount: 96919.54,
      stored_outstanding: -96919.54,
      settled_in_chips: 296982.64,
      player_pnl_net: -110003.14,
      rakeback_due: 406985.78,
    });
    const house = byInvoice('MIDWAY-2026-000040');
    expect(house).toMatchObject({ amount: -21.25, stored_outstanding: 21.25, union_house: true });
  });

  it('refuses a payer that contradicts the stored direction', () => {
    const value = fresh();
    value.clubs[0].payer_type = 'union';
    value.clubs[0].payee_type = 'club';
    expect(() => parseUnionStatementBoard(value, UNION, '2026-11-09')).toThrow(
      'Statement payer and payee contradict its direction'
    );
  });

  it('refuses a settled-in-chips figure that is not rakeback plus the player result', () => {
    const value = fresh();
    value.clubs[0].settled_in_chips = 296982.65;
    expect(() => parseUnionStatementBoard(value, UNION, '2026-11-09')).toThrow(
      'Statement settled-in-chips split does not reconcile'
    );
  });

  it('refuses an amount due that is not ECO plus presettlements, or has the wrong sign', () => {
    const value = fresh();
    value.clubs[0].stored_outstanding = 96919.54;
    expect(() => parseUnionStatementBoard(value, UNION, '2026-11-09')).toThrow(
      'Statement amount due does not reconcile'
    );
  });

  it('a credited invoice states only what remains, and the credits must reconcile', () => {
    const value = fresh();
    value.clubs[0].credit_notes = [{ invoice_number: 'MIDWAY-2026-000099', amount: 96919.54 }];
    value.clubs[0].remaining_after_credits = 0;
    const deep = parseUnionStatementBoard(value, UNION, '2026-11-09').clubs[0];
    expect(unionStatementAmountDue(deep, deep.club_name, 'Midway Union')).toBe(
      'Credited In Full, Nothing Due'
    );
    value.clubs[0].remaining_after_credits = 0.01;
    expect(() => parseUnionStatementBoard(value, UNION, '2026-11-09')).toThrow(
      'Statement credit notes do not reconcile'
    );
    const uncredited = byInvoice('MIDWAY-2026-000038');
    expect(unionStatementAmountDue(uncredited, uncredited.club_name, 'Midway Union')).toBe(
      'Deep Stack Society Pays Midway Union 96,919.54'
    );
  });

  it('a charged invoice owes its amount plus its charge notes, and the charges must reconcile', () => {
    const value = fresh();
    value.clubs[0].charge_notes = [{ invoice_number: 'MIDWAY-2026-000100', amount: 43.86 }];
    value.clubs[0].remaining_after_credits = 96963.4;
    const deep = parseUnionStatementBoard(value, UNION, '2026-11-09').clubs[0];
    expect(unionStatementAmountDue(deep, deep.club_name, 'Midway Union')).toBe(
      'Deep Stack Society Pays Midway Union 96,963.40 After Charge'
    );
    expect(deep.remaining_unpaid).toBe(96963.4);
    value.clubs[0].credit_notes = [{ invoice_number: 'MIDWAY-2026-000099', amount: 900 }];
    value.clubs[0].remaining_after_credits = 96063.4;
    const both = parseUnionStatementBoard(value, UNION, '2026-11-09').clubs[0];
    expect(unionStatementAmountDue(both, both.club_name, 'Midway Union')).toBe(
      'Deep Stack Society Pays Midway Union 96,063.40 After Credit And Charge'
    );
    // A remainder that ignores the charge note does not reconcile.
    value.clubs[0].remaining_after_credits = 96019.54;
    expect(() => parseUnionStatementBoard(value, UNION, '2026-11-09')).toThrow(
      'Statement credit notes do not reconcile'
    );
    value.clubs[0].charge_notes = [];
    expect(() => parseUnionStatementBoard(value, UNION, '2026-11-09')).toThrow(
      'Statement charge notes are invalid'
    );
  });

  it('the unpaid balance and the tiles are after credit notes and payments', () => {
    const value = fresh();
    value.clubs[0].credit_notes = [{ invoice_number: 'MIDWAY-2026-000099', amount: 96919.54 }];
    value.clubs[0].remaining_after_credits = 0;
    const board = parseUnionStatementBoard(value, UNION, '2026-11-09');
    expect(board.clubs[0].remaining_unpaid).toBe(0);
    expect(board.totals).toMatchObject({
      clubs_owe: 94348,
      union_owes: 21.25,
      net: 94326.75,
      outstanding: 94369.25,
    });
    // A server that already subtracts credits from the row's outstanding is read the same.
    value.clubs[0].outstanding = 0;
    value.totals.outstanding = 94369.25;
    expect(parseUnionStatementBoard(value, UNION, '2026-11-09').clubs[0].remaining_unpaid).toBe(0);
  });

  it('refuses a house flag that is not the club_id = union id identity', () => {
    const value = fresh();
    value.clubs[0].union_house = true;
    expect(() => parseUnionStatementBoard(value, UNION, '2026-11-09')).toThrow(
      'Statement house row is misidentified'
    );
  });

  it('refuses a week whose end is not after its start', () => {
    const value = fresh();
    value.clubs[0].period_end_at = value.clubs[0].period_start_at;
    expect(() => parseUnionStatementBoard(value, UNION, '2026-11-09')).toThrow(
      'Statement week is invalid'
    );
  });

  it('still reads a board from before the stored instants, deriving the house row', () => {
    const value = fresh();
    for (const club of value.clubs)
      for (const key of [
        'invoice_number',
        'period_start_at',
        'period_end_at',
        'payer_type',
        'payer_name',
        'payee_type',
        'payee_name',
        'union_house',
        'settled_in_chips',
        'player_pnl_net',
        'stored_outstanding',
        'credit_notes',
        'remaining_after_credits',
      ])
        delete club[key];
    delete value.period_start_at;
    delete value.period_end_at;
    const board = parseUnionStatementBoard(value, UNION, '2026-11-09');
    expect(board.period_start_at).toBeNull();
    expect(board.clubs.filter((c) => c.union_house)).toHaveLength(1);
  });
});
