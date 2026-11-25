/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SEAT-FIRST PRE-CHECK, COUNTED WHERE A DASHBOARD CAN SEE IT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * topUpWithHorses skips fn_seat_horse_in_seat_first_game for a horse the seat
 * rows show seated and for a table they show full (see seatFirstSeatPrecheck
 * in TournamentRecurringService.ts). The saving is a lock acquisition that
 * did not happen on the one platform-wide key every hand settlement waits on,
 * and until now the only evidence of it was a log line per fill pass. A log
 * line needs log access; a counter needs a scrape.
 *
 * One counter family, one label. `outcome` carries every field of the
 * per-pass tally, so the ratio that matters - `seated` against `rpc_called`,
 * which should move toward one - is a PromQL division, and the residue the
 * ledger cannot see (`rpc_already_seated`, `rpc_table_full`, the race within
 * a tick) is a series that can be watched rather than grepped.
 *
 * Module-level, like wsAuthRefusals in transport/wsHelpers.ts: the counters
 * belong to the process, not to a service instance, because several services
 * (GameServer discovery, the scheduler, the overlay guard) drive the same
 * top-up. Every series is present from the first scrape, at zero, so a rule
 * can tell "nothing skipped" from "nothing reported".
 */

export const SEAT_FIRST_PRECHECK_OUTCOMES = [
  'rpc_called',
  'skipped_already_seated',
  'skipped_table_full',
  'verify_reads',
  'seated',
  'rpc_already_seated',
  'rpc_table_full',
  'rpc_refused',
  'rpc_other_noop',
] as const;

export type SeatFirstPrecheckOutcome = (typeof SEAT_FIRST_PRECHECK_OUTCOMES)[number];

export interface SeatFirstPrecheckTally {
  rpcCalled: number;
  skippedAlreadySeated: number;
  skippedTableFull: number;
  /** Lock-free re-reads of the seat rows made to confirm a skip before taking it. */
  verifyReads: number;
  seated: number;
  rpcAlreadySeated: number;
  rpcTableFull: number;
  rpcRefused: number;
  rpcOtherNoop: number;
}

export function emptySeatFirstPrecheckTally(): SeatFirstPrecheckTally {
  return {
    rpcCalled: 0,
    skippedAlreadySeated: 0,
    skippedTableFull: 0,
    verifyReads: 0,
    seated: 0,
    rpcAlreadySeated: 0,
    rpcTableFull: 0,
    rpcRefused: 0,
    rpcOtherNoop: 0,
  };
}

const totals = new Map<SeatFirstPrecheckOutcome, number>(
  SEAT_FIRST_PRECHECK_OUTCOMES.map((k) => [k, 0] as const)
);

function bump(outcome: SeatFirstPrecheckOutcome, by: number): void {
  const n = Math.max(0, Math.floor(Number(by) || 0));
  if (n === 0) return;
  totals.set(outcome, (totals.get(outcome) ?? 0) + n);
}

/** Fold one fill pass's tally into the process-wide counters. */
export function recordSeatFirstPrecheck(tally: SeatFirstPrecheckTally): void {
  bump('rpc_called', tally.rpcCalled);
  bump('skipped_already_seated', tally.skippedAlreadySeated);
  bump('skipped_table_full', tally.skippedTableFull);
  bump('verify_reads', tally.verifyReads);
  bump('seated', tally.seated);
  bump('rpc_already_seated', tally.rpcAlreadySeated);
  bump('rpc_table_full', tally.rpcTableFull);
  bump('rpc_refused', tally.rpcRefused);
  bump('rpc_other_noop', tally.rpcOtherNoop);
}

/** The running totals, for tests and for anything that wants them without parsing exposition text. */
export function seatFirstPrecheckTotals(): Record<SeatFirstPrecheckOutcome, number> {
  const out = {} as Record<SeatFirstPrecheckOutcome, number>;
  for (const k of SEAT_FIRST_PRECHECK_OUTCOMES) out[k] = totals.get(k) ?? 0;
  return out;
}

/** Tests only: a fresh process has no history. */
export function resetSeatFirstPrecheckTotalsForTests(): void {
  for (const k of SEAT_FIRST_PRECHECK_OUTCOMES) totals.set(k, 0);
}

/** Prometheus exposition lines (always present, every outcome, even at zero). */
export function seatFirstPrecheckPrometheusLines(): string[] {
  const lines = [
    '# HELP poker_seat_first_precheck_total Seat-first horse fill decisions (label: outcome). rpc_called = fn_seat_horse_in_seat_first_game taken; skipped_already_seated / skipped_table_full = calls the seat rows made unnecessary; verify_reads = lock-free re-reads that confirmed a skip; seated / rpc_already_seated / rpc_table_full / rpc_refused / rpc_other_noop = what the calls answered',
    '# TYPE poker_seat_first_precheck_total counter',
  ];
  for (const k of SEAT_FIRST_PRECHECK_OUTCOMES) {
    lines.push(`poker_seat_first_precheck_total{outcome="${k}"} ${totals.get(k) ?? 0}`);
  }
  return lines;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FAST-FAIL SPIN SEAT-FIRST BOOKING REFUSAL COUNTER (2026-11-24, incident
 *  3c817b04-bc3a-4bc5-aa43-b2eee257584d)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * When fn_seat_horse_in_seat_first_game raises a deterministic SQL refusal on
 * a Spin board (such as three_paid_seats_required from fn_spin_book_entry),
 * the board used to loop silently every 12 seconds for 2.4 hours until
 * SpinFleetProducingNothing finally paged past the 8400s ladder envelope.
 *
 * This bounded-label counter records unexpected Spin seat-first RPC refusals
 * (never ordinary horse four-table-cap refusals) with a closed, low-cardinality
 * reason label so SpinSeatFirstBookingRefusedRepeatedly pages in two minutes
 * with the exact reason already in the alert payload. Every series is present
 * at zero from boot so Prometheus rules never evaluate an absent vector.
 */
export const SPIN_SEAT_FIRST_BOOKING_REFUSAL_REASONS = [
  'three_paid_seats_required',
  'invalid_spin_contract',
  'not_a_spin',
  'spin_reserve_unproven',
  'other',
] as const;

export type SpinSeatFirstBookingRefusalReason =
  (typeof SPIN_SEAT_FIRST_BOOKING_REFUSAL_REASONS)[number];

const spinBookingRefusals = new Map<SpinSeatFirstBookingRefusalReason, number>(
  SPIN_SEAT_FIRST_BOOKING_REFUSAL_REASONS.map((r) => [r, 0] as const)
);

/** Map a raw seat-first RPC error message into a bounded low-cardinality reason label. */
export function classifySpinSeatFirstBookingRefusalReason(
  message: string | null | undefined
): SpinSeatFirstBookingRefusalReason {
  const text = String(message ?? '').toLowerCase();
  if (text.includes('three_paid_seats_required')) return 'three_paid_seats_required';
  if (text.includes('invalid_spin_contract')) return 'invalid_spin_contract';
  if (text.includes('not_a_spin')) return 'not_a_spin';
  if (
    text.includes('spin_reserve') ||
    text.includes('spin_entry') ||
    text.includes('spin_paid_entry_unproven') ||
    text.includes('spin_field_unproven')
  ) {
    return 'spin_reserve_unproven';
  }
  return 'other';
}

/** Record one unexpected Spin seat-first booking RPC refusal (excludes expected capacity caps). */
export function recordSpinSeatFirstBookingRefusal(
  message: string | null | undefined
): SpinSeatFirstBookingRefusalReason {
  const reason = classifySpinSeatFirstBookingRefusalReason(message);
  spinBookingRefusals.set(reason, (spinBookingRefusals.get(reason) ?? 0) + 1);
  return reason;
}

/** Running totals by bounded refusal reason, for tests and diagnostics. */
export function spinSeatFirstBookingRefusalTotals(): Record<
  SpinSeatFirstBookingRefusalReason,
  number
> {
  const out = {} as Record<SpinSeatFirstBookingRefusalReason, number>;
  for (const r of SPIN_SEAT_FIRST_BOOKING_REFUSAL_REASONS) {
    out[r] = spinBookingRefusals.get(r) ?? 0;
  }
  return out;
}

/** Tests only: reset Spin seat-first booking refusal totals. */
export function resetSpinSeatFirstBookingRefusalTotalsForTests(): void {
  for (const r of SPIN_SEAT_FIRST_BOOKING_REFUSAL_REASONS) spinBookingRefusals.set(r, 0);
}

/** Prometheus exposition lines for Spin seat-first booking refusals (always emitted at boot). */
export function spinSeatFirstBookingRefusalPrometheusLines(): string[] {
  const lines = [
    '# HELP poker_spin_seat_first_booking_refused_total Unexpected Spin seat-first booking RPC refusals (label: reason), excluding expected four-table horse-capacity refusals. Emitted at zero from boot so SpinSeatFirstBookingRefusedRepeatedly watches live series.',
    '# TYPE poker_spin_seat_first_booking_refused_total counter',
  ];
  for (const r of SPIN_SEAT_FIRST_BOOKING_REFUSAL_REASONS) {
    lines.push(
      `poker_spin_seat_first_booking_refused_total{reason="${r}"} ${spinBookingRefusals.get(r) ?? 0}`
    );
  }
  return lines;
}
