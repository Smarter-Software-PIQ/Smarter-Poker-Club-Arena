/**
 * Which receipt keys a node replay keeps on each arm (scripts/audited-node-option-replay.ts).
 *
 * The scorer splits every count per rule receipt the replayed arm carried, and counts a row as changed when the
 * kept receipts differ (benchmark/AuditedDecisionReplay.ts). The replay used to keep only the keys a hand-kept
 * pattern named (priced, value_share, multiway, plo6_facing, holdem_, hu_ prefixes), so an option whose receipt
 * fell outside it was scored as "(no receipt)": omahaHiLoTournamentFirstIn fires omaha_hilo_tournament_first_in,
 * which no prefix matched (2026-11-21).
 *
 * The receipts of an option are now read from the ledger: every receipt entry of HORSE_DATA_LEDGER whose consumer
 * names the option in its parentheses (`HorsePreflop (omahaHiLoTournamentFirstIn)`, `HorsePreflop via HorseLogic
 * (huBbDefendsToPrice)`), including a `prefix_*` family entry, which covers every key sharing the prefix. A replay
 * keeps the receipts of every option any of its arms turns on, on every arm (the base arm too, so a receipt that
 * fires both off and on is seen as unchanged). The earlier families stay kept as well, so rows already scored with
 * them score the same.
 */
import { HORSE_DATA_LEDGER, type LedgerEntry } from '../engine/HorseDataLedger.js';

/** The receipt families every replay keeps (the pattern before 2026-11-21; unchanged). */
export const REPLAY_RECEIPT_FAMILIES = /priced|value_share|multiway|plo6_facing|holdem_|^hu_/;

/** The option names a ledger consumer string names in parentheses. */
export function consumerOptionNames(consumer: string): string[] {
  const out: string[] = [];
  for (const m of consumer.matchAll(/\(([^)]*)\)/g))
    for (const w of m[1]!.split(/[^A-Za-z0-9]+/)) if (w) out.push(w);
  return out;
}

/** The ledger receipt entries of one option (exact keys and `prefix_*` families). */
export function ledgerReceiptsOfOption(
  option: string,
  ledger: readonly LedgerEntry[] = HORSE_DATA_LEDGER
): LedgerEntry[] {
  return ledger.filter(
    (e) => e.kind === 'receipt' && consumerOptionNames(e.consumer).includes(option)
  );
}

/**
 * The keep test for one replay: a receipt key is kept when it belongs to an option of the arm options given (as
 * the ledger attributes it) or to one of the earlier families. An arm option the ledger names no receipt for keeps
 * only the families; it is returned in `unattributed` so the caller says so.
 */
export function replayReceiptKeep(
  armOptions: readonly string[],
  ledger: readonly LedgerEntry[] = HORSE_DATA_LEDGER
): { keep: (key: string) => boolean; unattributed: string[] } {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  const unattributed: string[] = [];
  for (const option of new Set(armOptions)) {
    const entries = ledgerReceiptsOfOption(option, ledger);
    if (entries.length === 0) unattributed.push(option);
    for (const e of entries)
      if (e.key.endsWith('*')) prefixes.push(e.key.slice(0, -1));
      else exact.add(e.key);
  }
  return {
    keep: (key) =>
      exact.has(key) ||
      prefixes.some((p) => key.startsWith(p)) ||
      REPLAY_RECEIPT_FAMILIES.test(key),
    unattributed,
  };
}
