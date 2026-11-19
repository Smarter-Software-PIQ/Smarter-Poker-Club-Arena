import { unionEcoComponents, unionEcoSummary, type UnionEcoComponent } from './unionEco';
import { formatWalletChips } from './format';
export interface WeeklyPlayerResults {
  version: 1;
  cash_net_loss: number;
  tournament_net_loss: number;
  total_net_loss: number;
  rakeback_credit: number;
  eco_charge: number;
  weekly_net_due_to_union: number;
  sign_convention: 'positive_club_owes_union';
}

export interface UnionStatementClub {
  weekly_player_results?: WeeklyPlayerResults | null;
  eco_version?: number | null;
  eco_components?: UnionEcoComponent[] | null;
  club_id: string;
  club_name: string;
  club_code: string | null;
  club_slug: string | null;
  invoice_id: string | null;
  snapshot_complete: boolean;
  status: string;
  issued_at: string | null;
  due_at: string | null;
  amount: number;
  direction: string | null;
  message_sent: boolean;
  overdue: boolean;
  payment_details_available?: boolean;
  paid_total: number | null;
  outstanding: number | null;
  rake_generated: number;
  rakeback_due: number;
  union_fee_kept: number;
  players_won: number;
  eco_amount: number;
  eco_components_complete?: boolean;
  cash_eco_amount?: number | null;
  tournament_eco_amount?: number | null;
  presettled: number;
  /* The stored document's own identity, week and parties (20261115011424).
     Optional so a board from before that migration still reads; the house
     flag is derived from club_id = union_id when the server omits it. */
  invoice_number?: string | null;
  period_start_at?: string | null;
  period_end_at?: string | null;
  payer_type?: StatementParty | null;
  payer_name?: string | null;
  payee_type?: StatementParty | null;
  payee_name?: string | null;
  union_house?: boolean;
  settled_in_chips?: number | null;
  player_pnl_net?: number | null;
  stored_outstanding?: number | null;
  /* Credit notes recorded against this invoice, and what remains after them
     (fn_union_invoice_outstanding). A credited invoice never reads as owing
     its full original amount. */
  credit_notes?: StatementCredit[] | null;
  remaining_after_credits?: number | null;
  /* What is still unpaid: the amount after credit notes less payments
     (null when historical payment details are unavailable and no credit
     note settles it). Derived here so every view reads one definition. */
  remaining_unpaid?: number | null;
}

export interface StatementCredit {
  invoice_number: string;
  amount: number;
}

export type StatementParty = 'club' | 'union';

export interface UnionStatementPeriod {
  period_start: string | null;
  period_end: string;
  clubs: number;
  total_amount: number;
  rake_generated: number;
  eco_amount: number;
  eco_components_complete?: boolean;
  cash_eco_amount?: number | null;
  tournament_eco_amount?: number | null;
  paid: number;
  delivered: number;
  period_start_at?: string | null;
  period_end_at?: string | null;
}

export interface UnionStatementTotals {
  clubs: number;
  issued: number;
  missing: number;
  delivered: number;
  paid: number;
  clubs_owe: number;
  union_owes: number;
  net: number;
  payment_details_available?: boolean;
  collected: number | null;
  outstanding: number | null;
  rake_generated: number;
  eco_amount: number;
  eco_components_complete?: boolean;
  cash_eco_amount?: number | null;
  tournament_eco_amount?: number | null;
}

export interface UnionStatementBoard {
  union_id: string;
  union_name: string | null;
  period_end: string | null;
  period_start: string | null;
  period_start_at?: string | null;
  period_end_at?: string | null;
  totals: UnionStatementTotals;
  clubs: UnionStatementClub[];
  history: UnionStatementPeriod[];
  generated_at: string;
}

type JsonRecord = Record<string, unknown>;

const STATUSES = new Set([
  'missing',
  'generated',
  'pending',
  'overdue',
  'disputed',
  'paid',
  'cancelled',
]);
const DIRECTIONS = new Set(['club owes union', 'union owes club', 'square']);

function objectValue(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as JsonRecord;
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : textValue(value, label);
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} is invalid`);
  return value;
}

function countValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function moneyValue(value: unknown, label: string, nonnegative = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (nonnegative && value < 0)) {
    throw new Error(`${label} is invalid`);
  }
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 0.000001) {
    throw new Error(`${label} is not an exact chip-cent amount`);
  }
  return cents / 100;
}

function isoDate(value: unknown, label: string): string {
  const date = textValue(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`${label} is invalid`);
  }
  return date;
}

function nullableDate(value: unknown, label: string): string | null {
  return value === null ? null : isoDate(value, label);
}

function timestamp(value: unknown, label: string): string {
  const time = textValue(value, label);
  if (!Number.isFinite(Date.parse(time))) throw new Error(`${label} is invalid`);
  return time;
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label);
}

function optionalTimestamp(value: unknown, label: string): string | null {
  return value === undefined ? null : nullableTimestamp(value, label);
}

function optionalText(value: unknown, label: string): string | null {
  return value === undefined ? null : nullableText(value, label);
}

function optionalMoney(value: unknown, label: string): number | null {
  return value === undefined || value === null ? null : moneyValue(value, label);
}

function optionalCredits(value: unknown): StatementCredit[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0)
    throw new Error('Statement credit notes are invalid');
  return value.map((entry) => {
    const credit = objectValue(entry, 'Statement credit note');
    const amount = moneyValue(credit.amount, 'Statement credit note amount', true);
    if (cents(amount) === 0) throw new Error('Statement credit note amount is invalid');
    return {
      invoice_number: textValue(credit.invoice_number, 'Statement credit note number'),
      amount,
    };
  });
}

function optionalParty(value: unknown, label: string): StatementParty | null {
  if (value === undefined || value === null) return null;
  if (value !== 'club' && value !== 'union') throw new Error(`${label} is invalid`);
  return value;
}

/** An accounting week is [start, end): the start instant is in it, the end is not. */
function weekInstants(start: unknown, end: unknown, label: string): [string | null, string | null] {
  const from = optionalTimestamp(start, `${label} start`);
  const to = optionalTimestamp(end, `${label} end`);
  if ((from === null) !== (to === null) || (from && to && Date.parse(from) >= Date.parse(to)))
    throw new Error(`${label} is invalid`);
  return [from, to];
}

const cents = (value: number): number => Math.round(value * 100);
const sumCents = (values: number[]): number => values.reduce((sum, value) => sum + cents(value), 0);

export function parseWeeklyPlayerResults(row: Record<string, unknown>): WeeklyPlayerResults | null {
  // Old immutable invoices have no original activity split. Missing stays unknown.
  if (row.weekly_player_results !== undefined && row.weekly_player_results !== null) {
    const facts = objectValue(row.weekly_player_results, 'Weekly player results');
    if (facts.version !== 1 || facts.sign_convention !== 'positive_club_owes_union')
      throw new Error('Weekly player result contract is invalid');
    const result: WeeklyPlayerResults = {
      version: 1,
      cash_net_loss: moneyValue(facts.cash_net_loss, 'Cash player net loss'),
      tournament_net_loss: moneyValue(facts.tournament_net_loss, 'Tournament player net loss'),
      total_net_loss: moneyValue(facts.total_net_loss, 'Total player net loss'),
      rakeback_credit: moneyValue(facts.rakeback_credit, 'Club rakeback credit', true),
      eco_charge: moneyValue(facts.eco_charge, 'ECO charge'),
      weekly_net_due_to_union: moneyValue(facts.weekly_net_due_to_union, 'Full weekly net'),
      sign_convention: 'positive_club_owes_union',
    };
    if (
      cents(result.total_net_loss) !==
        cents(result.cash_net_loss) + cents(result.tournament_net_loss) ||
      cents(result.total_net_loss) !==
        -cents(moneyValue(row.players_won, 'Statement player result')) ||
      cents(result.rakeback_credit) !==
        cents(moneyValue(row.rakeback_due, 'Statement rakeback', true)) ||
      cents(result.eco_charge) !== -cents(moneyValue(row.eco_amount, 'Statement ECO amount')) ||
      cents(result.weekly_net_due_to_union) !==
        cents(result.total_net_loss) - cents(result.rakeback_credit) + cents(result.eco_charge)
    )
      throw new Error('Weekly player results do not reconcile');
    return result;
  } else return null;
}

interface ParsedClub {
  club: UnionStatementClub;
  rawAmount: number;
}

function parseClub(value: unknown, unionId: string): ParsedClub {
  const row = objectValue(value, 'Statement club');
  const status = textValue(row.status, 'Statement status');
  if (!STATUSES.has(status)) throw new Error('Statement status is invalid');
  const direction = nullableText(row.direction, 'Statement direction');
  if (direction !== null && !DIRECTIONS.has(direction)) {
    throw new Error('Statement direction is invalid');
  }
  const available =
    row.payment_details_available === undefined
      ? true
      : booleanValue(row.payment_details_available, 'Statement payment availability');
  if (
    !available &&
    (status !== 'paid' || row.paid_total !== null || row.outstanding !== null || row.amount === 0)
  )
    throw new Error('Statement payment availability is inconsistent');
  const rawAmount = moneyValue(row.amount, 'Statement amount');
  const parsed: UnionStatementClub = {
    club_id: textValue(row.club_id, 'Statement club identity'),
    club_name: textValue(row.club_name, 'Statement club name'),
    club_code: nullableText(row.club_code, 'Statement club code'),
    club_slug: nullableText(row.club_slug, 'Statement club slug'),
    invoice_id: nullableText(row.invoice_id, 'Statement invoice identity'),
    snapshot_complete: booleanValue(row.snapshot_complete, 'Statement accounting snapshot'),
    status,
    issued_at: nullableTimestamp(row.issued_at, 'Statement issue time'),
    due_at: nullableTimestamp(row.due_at, 'Statement due time'),
    amount: rawAmount,
    direction,
    message_sent: booleanValue(row.message_sent, 'Statement delivery state'),
    overdue: booleanValue(row.overdue, 'Statement overdue state'),
    payment_details_available: available,
    paid_total: available ? moneyValue(row.paid_total, 'Statement paid total', true) : null,
    outstanding: available
      ? moneyValue(row.outstanding, 'Statement outstanding total', true)
      : null,
    rake_generated: moneyValue(row.rake_generated, 'Statement rake', true),
    rakeback_due: moneyValue(row.rakeback_due, 'Statement rakeback', true),
    union_fee_kept: moneyValue(row.union_fee_kept, 'Statement union fee', true),
    players_won: moneyValue(row.players_won, 'Statement player result'),
    eco_amount: moneyValue(row.eco_amount, 'Statement ECO amount'),
    eco_version: row.eco_version === 2 ? 2 : null,
    eco_components: unionEcoComponents(row),
    presettled: moneyValue(row.presettled, 'Statement presettled amount'),
  };
  const [weekStart, weekEnd] = weekInstants(
    row.period_start_at,
    row.period_end_at,
    'Statement week'
  );
  parsed.invoice_number = optionalText(row.invoice_number, 'Statement invoice number');
  parsed.period_start_at = weekStart;
  parsed.period_end_at = weekEnd;
  parsed.payer_type = optionalParty(row.payer_type, 'Statement payer');
  parsed.payer_name = optionalText(row.payer_name, 'Statement payer name');
  parsed.payee_type = optionalParty(row.payee_type, 'Statement payee');
  parsed.payee_name = optionalText(row.payee_name, 'Statement payee name');
  parsed.settled_in_chips = optionalMoney(row.settled_in_chips, 'Statement settled in chips');
  parsed.player_pnl_net = optionalMoney(row.player_pnl_net, 'Statement player result');
  parsed.stored_outstanding = optionalMoney(row.stored_outstanding, 'Statement amount due');
  parsed.credit_notes = optionalCredits(row.credit_notes);
  parsed.remaining_after_credits = optionalMoney(
    row.remaining_after_credits,
    'Statement amount after credit notes'
  );
  // The union's own house club row (club_id = union id) is not a member club.
  const house = parsed.club_id === unionId;
  if (
    row.union_house !== undefined &&
    booleanValue(row.union_house, 'Statement house row') !== house
  )
    throw new Error('Statement house row is misidentified');
  parsed.union_house = house;

  parsed.weekly_player_results = parseWeeklyPlayerResults(row);

  if (row.eco_version === 2 && !parsed.eco_components)
    throw new Error('Statement ECO components are invalid');

  if (status === 'missing') {
    if (
      parsed.invoice_id !== null ||
      parsed.snapshot_complete ||
      parsed.issued_at !== null ||
      parsed.due_at !== null ||
      parsed.direction !== null ||
      parsed.message_sent ||
      parsed.overdue ||
      parsed.invoice_number !== null ||
      parsed.period_start_at !== null ||
      parsed.payer_type !== null ||
      parsed.payee_type !== null ||
      parsed.settled_in_chips !== null ||
      parsed.player_pnl_net !== null ||
      parsed.stored_outstanding !== null ||
      parsed.credit_notes !== null ||
      parsed.remaining_after_credits !== null ||
      [
        parsed.amount,
        parsed.paid_total,
        parsed.outstanding,
        parsed.rake_generated,
        parsed.rakeback_due,
        parsed.union_fee_kept,
        parsed.players_won,
        parsed.eco_amount,
        parsed.presettled,
      ].some((amount) => amount !== null && cents(amount) !== 0)
    ) {
      throw new Error('Missing statement row carries invoice data');
    }
    return { club: parsed, rawAmount };
  }

  if (!parsed.invoice_id || !parsed.snapshot_complete || !parsed.issued_at || !parsed.direction) {
    throw new Error('Issued statement identity is incomplete');
  }
  if (parsed.direction === 'square') {
    if (cents(rawAmount) !== 0) throw new Error('Square statement carries a nonzero amount');
    parsed.amount = 0;
  } else {
    if (cents(rawAmount) === 0) throw new Error('Directed statement carries a zero amount');
    if (parsed.direction === 'club owes union' && rawAmount < 0) {
      throw new Error('Statement amount contradicts its club-owes direction');
    }
    parsed.amount =
      parsed.direction === 'club owes union' ? Math.abs(rawAmount) : -Math.abs(rawAmount);
  }
  if (parsed.paid_total !== null && parsed.paid_total > Math.abs(parsed.amount)) {
    throw new Error('Statement paid total exceeds its amount');
  }
  // The server's unpaid balance is the amount after credit notes less
  // payments (20261115030918); before it, the amount less payments. They
  // differ only for a credited invoice with payment details.
  const paidCents = cents(parsed.paid_total ?? 0);
  const afterCredits =
    parsed.remaining_after_credits === null || parsed.remaining_after_credits === undefined
      ? Math.abs(cents(parsed.amount))
      : cents(parsed.remaining_after_credits);
  if (
    available &&
    cents(parsed.outstanding as number) !== Math.max(afterCredits - paidCents, 0) &&
    cents(parsed.outstanding as number) !== Math.max(Math.abs(cents(parsed.amount)) - paidCents, 0)
  ) {
    throw new Error('Statement outstanding total does not reconcile');
  }
  if (cents(parsed.rake_generated) !== cents(parsed.rakeback_due) + cents(parsed.union_fee_kept)) {
    throw new Error('Statement rake split does not reconcile');
  }
  // Who pays whom is the stored document's from/to party, and it must say
  // the same thing as the stored direction.
  if (parsed.payer_type !== null || parsed.payee_type !== null) {
    const expected =
      parsed.direction === 'club owes union'
        ? ['club', 'union']
        : parsed.direction === 'union owes club'
          ? ['union', 'club']
          : null;
    if (
      parsed.payer_type === null ||
      parsed.payee_type === null ||
      (expected !== null &&
        (parsed.payer_type !== expected[0] || parsed.payee_type !== expected[1]))
    )
      throw new Error('Statement payer and payee contradict its direction');
  }
  // settled_in_chips is the producer's player_pnl_net + rakeback_due.
  if (
    parsed.settled_in_chips !== null &&
    parsed.player_pnl_net !== null &&
    cents(parsed.settled_in_chips) !== cents(parsed.player_pnl_net) + cents(parsed.rakeback_due)
  )
    throw new Error('Statement settled-in-chips split does not reconcile');
  // The amount due is the recorded ECO plus recorded presettlements, signed
  // positive when the union pays, and its magnitude is the document amount.
  if (parsed.stored_outstanding !== null) {
    const due = cents(parsed.stored_outstanding);
    if (
      due !== cents(parsed.eco_amount) + cents(parsed.presettled) ||
      Math.abs(due) !== Math.abs(cents(parsed.amount)) ||
      Math.sign(due) !==
        (parsed.direction === 'union owes club'
          ? 1
          : parsed.direction === 'club owes union'
            ? -1
            : 0)
    )
      throw new Error('Statement amount due does not reconcile');
  }
  // What remains is the document amount less every credit note against it.
  if (parsed.remaining_after_credits !== null || parsed.credit_notes !== null) {
    const credited = (parsed.credit_notes ?? []).reduce((sum, c) => sum + cents(c.amount), 0);
    if (
      parsed.remaining_after_credits === null ||
      cents(parsed.remaining_after_credits) < 0 ||
      cents(parsed.remaining_after_credits) !== Math.abs(cents(parsed.amount)) - credited
    )
      throw new Error('Statement credit notes do not reconcile');
  }
  if (available && status === 'paid' && cents(parsed.outstanding as number) !== 0) {
    throw new Error('Paid statement still has an outstanding balance');
  }
  const remainingAfterCredits = parsed.credit_notes?.length
    ? cents(parsed.remaining_after_credits as number)
    : Math.abs(cents(parsed.amount));
  parsed.remaining_unpaid =
    parsed.direction === 'square' || remainingAfterCredits === 0
      ? 0
      : available
        ? Math.max(remainingAfterCredits - cents(parsed.paid_total ?? 0), 0) / 100
        : null;
  return { club: parsed, rawAmount };
}

function parseTotals(value: unknown): UnionStatementTotals {
  const totals = objectValue(value, 'Statement totals');
  const available =
    totals.payment_details_available === undefined
      ? true
      : booleanValue(totals.payment_details_available, 'Statement totals payment availability');
  if (!available && (totals.collected !== null || totals.outstanding !== null))
    throw new Error('Statement totals payment availability is inconsistent');
  return {
    payment_details_available: available,
    clubs: countValue(totals.clubs, 'Statement club count'),
    issued: countValue(totals.issued, 'Statement issued count'),
    missing: countValue(totals.missing, 'Statement missing count'),
    delivered: countValue(totals.delivered, 'Statement delivered count'),
    paid: countValue(totals.paid, 'Statement paid count'),
    clubs_owe: moneyValue(totals.clubs_owe, 'Statement clubs owed', true),
    union_owes: moneyValue(totals.union_owes, 'Statement union owed', true),
    net: moneyValue(totals.net, 'Statement net'),
    collected: available ? moneyValue(totals.collected, 'Statement collected', true) : null,
    outstanding: available ? moneyValue(totals.outstanding, 'Statement outstanding', true) : null,
    rake_generated: moneyValue(totals.rake_generated, 'Statement rake generated', true),
    eco_amount: moneyValue(totals.eco_amount, 'Statement ECO total'),
    ...unionEcoSummary(totals),
  };
}

function parseHistory(value: unknown): UnionStatementPeriod[] {
  if (!Array.isArray(value)) throw new Error('Statement history is invalid');
  const seen = new Set<string>();
  let previousEnd: string | null = null;
  return value.map((entry): UnionStatementPeriod => {
    const row = objectValue(entry, 'Statement history row');
    const periodEnd = isoDate(row.period_end, 'Statement history period end');
    const periodStart = nullableDate(row.period_start, 'Statement history period start');
    if (seen.has(periodEnd) || (previousEnd !== null && periodEnd >= previousEnd)) {
      throw new Error('Statement history is duplicated or out of order');
    }
    if (periodStart && periodStart > periodEnd)
      throw new Error('Statement history range is invalid');
    seen.add(periodEnd);
    previousEnd = periodEnd;
    const clubs = countValue(row.clubs, 'Statement history club count');
    const paid = countValue(row.paid, 'Statement history paid count');
    const delivered = countValue(row.delivered, 'Statement history delivered count');
    if (paid > clubs || delivered > clubs) throw new Error('Statement history counts are invalid');
    const [weekStart, weekEnd] = weekInstants(
      row.period_start_at,
      row.period_end_at,
      'Statement history week'
    );
    return {
      period_start_at: weekStart,
      period_end_at: weekEnd,
      period_start: periodStart,
      period_end: periodEnd,
      clubs,
      total_amount: moneyValue(row.total_amount, 'Statement history amount'),
      rake_generated: moneyValue(row.rake_generated, 'Statement history rake', true),
      eco_amount: moneyValue(row.eco_amount, 'Statement history ECO'),
      ...unionEcoSummary(row),
      paid,
      delivered,
    };
  });
}

export function parseUnionStatementBoard(
  value: unknown,
  expectedUnionId: string,
  expectedPeriodEnd: string | null
): UnionStatementBoard {
  const board = objectValue(value, 'Statement board');
  const unionId = textValue(board.union_id, 'Statement union identity');
  if (unionId !== expectedUnionId) throw new Error('Statement board belongs to another union');
  const periodEnd = nullableDate(board.period_end, 'Statement period end');
  const periodStart = nullableDate(board.period_start, 'Statement period start');
  if (expectedPeriodEnd !== null && periodEnd !== expectedPeriodEnd) {
    throw new Error('Statement board belongs to another period');
  }
  if (periodStart && periodEnd && periodStart > periodEnd) {
    throw new Error('Statement board period is invalid');
  }
  const [boardWeekStart, boardWeekEnd] = weekInstants(
    board.period_start_at,
    board.period_end_at,
    'Statement board week'
  );
  if (!Array.isArray(board.clubs)) throw new Error('Statement clubs are invalid');
  const parsedClubs = board.clubs.map((club) => parseClub(club, unionId));
  const clubs = parsedClubs.map(({ club }) => club);
  const clubIds = new Set<string>();
  const invoiceIds = new Set<string>();
  for (const club of clubs) {
    if (clubIds.has(club.club_id)) throw new Error('Statement club is duplicated');
    clubIds.add(club.club_id);
    if (club.invoice_id) {
      if (invoiceIds.has(club.invoice_id)) throw new Error('Statement invoice is duplicated');
      invoiceIds.add(club.invoice_id);
    }
  }
  const totals = parseTotals(board.totals);
  const issued = clubs.filter((club) => club.status !== 'missing');
  const expectedCounts = {
    clubs: clubs.length,
    issued: issued.length,
    missing: clubs.length - issued.length,
    delivered: clubs.filter((club) => club.message_sent).length,
    paid: clubs.filter((club) => club.status === 'paid').length,
  };
  for (const [key, expected] of Object.entries(expectedCounts)) {
    if (totals[key as keyof typeof expectedCounts] !== expected) {
      throw new Error(`Statement ${key} total does not reconcile`);
    }
  }
  if (totals.issued + totals.missing !== totals.clubs || totals.delivered > totals.issued) {
    throw new Error('Statement count totals do not reconcile');
  }
  const normalizedSignedTotals = {
    clubs_owe: sumCents(clubs.filter((row) => row.amount > 0).map((row) => row.amount)),
    union_owes: sumCents(clubs.filter((row) => row.amount < 0).map((row) => -row.amount)),
    net: sumCents(clubs.map((row) => row.amount)),
  };
  const legacySignedTotals = {
    clubs_owe: sumCents(
      parsedClubs.filter(({ rawAmount }) => rawAmount > 0).map(({ rawAmount }) => rawAmount)
    ),
    union_owes: sumCents(
      parsedClubs.filter(({ rawAmount }) => rawAmount < 0).map(({ rawAmount }) => -rawAmount)
    ),
    net: sumCents(parsedClubs.map(({ rawAmount }) => rawAmount)),
  };
  const suppliedSignedTotals = {
    clubs_owe: cents(totals.clubs_owe),
    union_owes: cents(totals.union_owes),
    net: cents(totals.net),
  };
  const matchesSignedTotals = (expected: typeof normalizedSignedTotals): boolean =>
    suppliedSignedTotals.clubs_owe === expected.clubs_owe &&
    suppliedSignedTotals.union_owes === expected.union_owes &&
    suppliedSignedTotals.net === expected.net;
  if (!matchesSignedTotals(normalizedSignedTotals) && !matchesSignedTotals(legacySignedTotals)) {
    throw new Error('Statement signed totals do not reconcile');
  }

  const available = clubs.every((row) => row.payment_details_available !== false);
  if (available !== totals.payment_details_available)
    throw new Error('Statement payment availability total does not reconcile');
  const moneyChecks: Array<[number, number, string]> = [
    ...(available
      ? ([
          [
            totals.collected as number,
            sumCents(clubs.map((row) => row.paid_total as number)),
            'collected',
          ],
          [
            totals.outstanding as number,
            sumCents(
              clubs
                .filter((row) => row.status !== 'missing' && row.status !== 'cancelled')
                .map((row) => row.outstanding as number)
            ),
            'outstanding',
          ],
        ] as Array<[number, number, string]>)
      : []),
    [totals.rake_generated, sumCents(clubs.map((row) => row.rake_generated)), 'rake'],
    [totals.eco_amount, sumCents(clubs.map((row) => row.eco_amount)), 'ECO'],
  ];
  if (totals.eco_components_complete) {
    if (clubs.some((c) => !c.eco_components))
      throw new Error('Separate ECO totals omit an original club');
    for (const [index, actual] of [
      [0, totals.cash_eco_amount],
      [1, totals.tournament_eco_amount],
    ] as const) {
      if (cents(actual as number) !== sumCents(clubs.map((c) => c.eco_components![index].amount)))
        throw new Error('Separate ECO lane total does not reconcile');
    }
  }
  for (const [actual, expectedCents, label] of moneyChecks) {
    if (cents(actual) !== expectedCents)
      throw new Error(`Statement ${label} total does not reconcile`);
  }

  const afterCredit = (row: UnionStatementClub): number =>
    Math.sign(row.amount) *
    (row.credit_notes?.length
      ? cents(row.remaining_after_credits as number)
      : Math.abs(cents(row.amount)));
  const afterCreditTotals = {
    clubs_owe: clubs
      .map(afterCredit)
      .filter((c) => c > 0)
      .reduce((a, b) => a + b, 0),
    union_owes: -clubs
      .map(afterCredit)
      .filter((c) => c < 0)
      .reduce((a, b) => a + b, 0),
    net: clubs.map(afterCredit).reduce((a, b) => a + b, 0),
  };
  const unpaidRows = clubs.filter((row) => row.status !== 'missing' && row.status !== 'cancelled');

  return {
    union_id: unionId,
    union_name: nullableText(board.union_name, 'Statement union name'),
    period_end: periodEnd,
    period_start: periodStart,
    period_start_at: boardWeekStart,
    period_end_at: boardWeekEnd,
    // The tiles state what is owed after credit notes, and the unpaid
    // balance after credit notes and payments when every row can say it.
    totals: {
      ...totals,
      clubs_owe: afterCreditTotals.clubs_owe / 100,
      union_owes: afterCreditTotals.union_owes / 100,
      net: afterCreditTotals.net / 100,
      outstanding: unpaidRows.every((row) => row.remaining_unpaid !== null)
        ? sumCents(unpaidRows.map((row) => row.remaining_unpaid as number)) / 100
        : totals.outstanding,
    },
    clubs,
    history: parseHistory(board.history),
    generated_at: timestamp(board.generated_at, 'Statement generation time'),
  };
}

/* ---------------------------------------------------------------------------
 * PRESENTATION OF A STORED STATEMENT (owner specification item 8, 2026-11-14)
 *
 * The accounting week is [start, end) in America/Chicago, bounded at 2:00 AM.
 * Both ends are formatted from the stored instants with the IANA zone, never
 * by adding 24 hours to a date, so a week that crosses a daylight-saving
 * change still reads 2:00 AM at both ends.
 * ------------------------------------------------------------------------- */

const CHICAGO_INSTANT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const CHICAGO_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

/** "Mon Nov 2, 2026 2:00 AM" for a stored instant, in Chicago. */
export function chicagoInstantLabel(iso: string): string {
  const parts: Record<string, string> = {};
  for (const part of CHICAGO_INSTANT.formatToParts(new Date(iso))) parts[part.type] = part.value;
  return `${parts.weekday} ${parts.month} ${parts.day}, ${parts.year} ${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
}

/** "Thu Nov 12" for a stored instant, in Chicago. */
export function chicagoDayLabel(iso: string): string {
  return CHICAGO_DAY.format(new Date(iso)).replace(',', '');
}

/**
 * "Mon Nov 2, 2026 2:00 AM to Mon Nov 9, 2026 2:00 AM Chicago Time", or null
 * when the statement predates stored week instants.
 */
export function unionStatementWeekLabel(
  start: string | null | undefined,
  end: string | null | undefined
): string | null {
  if (!start || !end) return null;
  return `${chicagoInstantLabel(start)} to ${chicagoInstantLabel(end)} Chicago Time`;
}

/**
 * The whole "Amount Due" sentence: who pays whom and how much is still due,
 * after any credit note recorded against the invoice.
 */
export function unionStatementAmountDue(
  club: Pick<
    UnionStatementClub,
    | 'status'
    | 'direction'
    | 'amount'
    | 'union_house'
    | 'club_name'
    | 'credit_notes'
    | 'remaining_after_credits'
  >,
  clubName: string,
  unionName: string
): string {
  const payLine = unionStatementPayLine(club, clubName, unionName);
  if (club.status === 'missing' || club.direction === 'square' || cents(club.amount) === 0)
    return payLine;
  if (club.credit_notes?.length) {
    const remaining = club.remaining_after_credits ?? 0;
    return cents(remaining) <= 0
      ? 'Credited In Full, Nothing Due'
      : `${payLine} ${formatWalletChips(remaining)} After Credit`;
  }
  return `${payLine} ${formatWalletChips(Math.abs(club.amount))}`;
}

/** The club side of a statement; the union's own house club says so. */
export function statementClubName(
  club: Pick<UnionStatementClub, 'club_name' | 'union_house'>,
  name: string
): string {
  return club.union_house ? `${name} (House Club)` : name;
}

/**
 * Who pays whom, in words: "Deep Stack Society Pays Midway Union",
 * "Midway Union Pays Club Savage" or "Square, Nothing Due". Names are passed
 * in already formatted for print.
 */
export function unionStatementPayLine(
  club: Pick<UnionStatementClub, 'status' | 'direction' | 'amount' | 'union_house' | 'club_name'>,
  clubName: string,
  unionName: string
): string {
  if (club.status === 'missing') return 'Not Billed';
  if (club.direction === 'square' || cents(club.amount) === 0) return 'Square, Nothing Due';
  const clubSide = statementClubName(club, clubName);
  return club.direction === 'club owes union'
    ? `${clubSide} Pays ${unionName}`
    : `${unionName} Pays ${clubSide}`;
}

/**
 * One statement row in the board's own shape, checked by the same rules the
 * board applies to each of its rows (identity, direction, reconciliation).
 * The statement document reader returns exactly this shape for one invoice.
 */
export function parseUnionStatementRow(value: unknown, unionId: string): UnionStatementClub {
  return parseClub(value, unionId).club;
}
