/**
 * Hand-row formatting shared by the Analysis tab and the page. Moved verbatim
 * out of PlayerStatsPage.tsx (Stats Page Programme phase 2).
 */
// hand_history stores board cards as "8hearts" / "Aspades". Render them as
// rank + suit symbol rather than dumping the raw token at the player.
const SUIT_SYMBOLS: Record<string, string> = {
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
  spades: '\u2660',
};

/** A short date, or a dash. `new Date('')` renders "Invalid Date" at the user. */
export function handDate(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '-';
}

export function formatCard(card: string): string {
  const m = /^([0-9TJQKA]{1,2})(hearts|diamonds|clubs|spades)$/i.exec(card.trim());
  if (!m) return card;
  return `${m[1].toUpperCase()}${SUIT_SYMBOLS[m[2].toLowerCase()] ?? ''}`;
}

/**
 * SILENT ZEROS ARE NOT MEASUREMENTS (Stats contract truth, 2026-09-20).
 *
 * Every rate on this page arrives from `ca_player_stats_overview_v2` as a
 * plain number, and the SQL writes 0 whenever the denominator was empty:
 * `CASE WHEN cash_hands > 0 THEN round(cash_bb_profit / cash_hands * 100, 2)
 * ELSE 0 END` and its siblings for ITM %, ROI and the showdown split. `num()`
 * in ./types then coerces a null to 0 as well. Both are correct defences
 * against a crash, and both produce the same lie on screen: a player who has
 * never played a cash hand is told their win rate is "0.00" BB/100, and a
 * player who has never reached a showdown is told they win "0.0%" of them.
 * A zero is a result. Never having been measured is not, and the difference
 * is the whole point of a stats page.
 *
 * `value` is the ratio the RPC already computed; `sample` is the denominator
 * it was divided by (cash hands, showdowns, entries, buy-ins). When the sample
 * is empty the formatter is never reached and the row says so in words.
 *
 * NOT a dash and not a blank cell: an empty row reads as a rendering fault,
 * and a glyph is banned copy (CLAUDE.md section 5.7). It is a sentence, in
 * Title Case, that a player can read.
 */
export const NOT_YET_MEASURED = 'Not Yet Measured';

export function ratioOrUnmeasured(
  value: number,
  sample: number,
  format: (value: number) => string
): string {
  if (!Number.isFinite(sample) || sample <= 0) return NOT_YET_MEASURED;
  if (!Number.isFinite(value)) return NOT_YET_MEASURED;
  return format(value);
}

/** Cash panels render only the cash population selected by the separated RPC. */
export const SCOPE_CASH = 'Cash';
/** Compatibility for external tab consumers; new code names the cash scope directly. */
export const SCOPE_ALL_GAMES = SCOPE_CASH;

/**
 * The aggression factor's label names its basis (2026-11-04). Until migration
 * 20261104195454 the platform counted preflop calls against the player, which
 * no tracker does; a payload from the corrected database says so and the
 * label reads "Aggression Factor (Postflop)". An older payload keeps the
 * plain label rather than claiming a basis it does not have.
 */
export function aggressionFactorLabel(basis: 'postflop' | 'all_streets' | undefined): string {
  return basis === 'postflop' ? 'Aggression Factor (Postflop)' : 'Aggression Factor';
}

export const OVERVIEW_RATE_FIELDS = new Set([
  'vpip',
  'pfr',
  'three_bet_percent',
  'fold_to_three_bet',
  'cbet_flop',
  'wtsd',
  'itm_percent',
  'roi',
]);

const AVAILABILITY_EXPORT_KEYS = [
  'three_bet_percent',
  'fold_to_three_bet',
  'cbet_flop',
  'aggression_factor',
  'wtsd',
  'hours_played',
] as const;

export function buildStatsExportMetadata(
  exportContext: {
    clubName: string;
    timezone: string;
    asset: string;
    contract: {
      contract_version: number | null;
      generated_at: string | null;
      coverage: {
        analysis_hand_cap: number | null;
        analysis_hands_capped: boolean;
        lifetime_index_complete: boolean;
        rollup_covered_through: string | null;
      };
      quality: {
        club_breakdown_starts_at: string | null;
        cash_money_source: string;
      };
    };
    privacyPresentationMode: boolean;
  },
  clubId: string | null,
  rangeLabel: string
) {
  const { coverage, quality, contract_version, generated_at } = exportContext.contract;
  return {
    clubId,
    clubName: exportContext.clubName,
    range: rangeLabel === 'All' ? 'All Time' : `Last ${rangeLabel}`,
    timezone: exportContext.timezone,
    asset: exportContext.asset,
    unit: exportContext.asset,
    coverage: JSON.stringify({
      analysis_hand_cap: coverage.analysis_hand_cap,
      analysis_hands_capped: coverage.analysis_hands_capped,
      lifetime_index_complete: coverage.lifetime_index_complete,
      rollup_covered_through: coverage.rollup_covered_through,
      club_breakdown_starts_at: quality.club_breakdown_starts_at,
    }),
    source: quality.cash_money_source,
    schemaVersion: contract_version,
    generatedAt: generated_at,
    privacyPresentationMode: exportContext.privacyPresentationMode,
  };
}

export function buildOverviewExportPayload(
  overall: Record<string, unknown>,
  availability: Partial<Record<(typeof AVAILABILITY_EXPORT_KEYS)[number], boolean>>,
  tournaments: {
    entries: number;
    cashes: number;
    wins: number;
    best_finish: number | null;
    total_buyins: number;
    total_winnings: number;
    total_prizes: number;
    total_bounty_winnings: number;
    total_bounties: number;
    net_profit: number;
    itm_percent: number;
    roi: number;
  }
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...overall,
    tournament_entries: tournaments.entries,
    tournament_cashes: tournaments.cashes,
    tournament_wins: tournaments.wins,
    tournament_best_finish: tournaments.best_finish ?? '',
    tournament_total_buyins: tournaments.total_buyins,
    tournament_total_winnings: tournaments.total_winnings,
    tournament_total_prizes: tournaments.total_prizes,
    tournament_total_bounty_winnings: tournaments.total_bounty_winnings,
    tournament_total_bounties: tournaments.total_bounties,
    tournament_net_profit: tournaments.net_profit,
    itm_percent: tournaments.itm_percent,
    roi: tournaments.roi,
  };
  for (const key of AVAILABILITY_EXPORT_KEYS) {
    if (!availability[key]) payload[key] = 'Unavailable';
  }
  return payload;
}
