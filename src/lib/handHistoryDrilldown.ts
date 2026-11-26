import {
  accountingDateOnly,
  zonedAccountingDate,
  zonedAccountingInstant,
} from '../utils/pacificAccountingCalendar';
import type { HandRecord } from '../services/HandHistoryService';
import {
  isCashEvidenceMetric,
  type CashEvidenceMetric,
  type StatsEvidenceQuery,
} from '../services/StatsEvidenceService';

export interface StatsHandDrilldown {
  clubId?: string;
  gameMode?: 'cash' | 'tournament';
  variant?: string;
  position?: string;
  bigBlind?: number;
  from?: string;
  to?: string;
  statsMetric?: CashEvidenceMetric;
  statsSession?: string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
function isInstant(value: string): boolean {
  return INSTANT.test(value) && Number.isFinite(Date.parse(value));
}

/** Match ca_stats_calendar_bounds for the report that actually supplied the figures. */
export function statsEvidenceWindow(
  days: number | null,
  zone: string,
  generatedAt?: string | null,
  recordedStart?: string | null
): { from?: string; to?: string } {
  if (!days) return {};
  const exactStart = recordedStart && isInstant(recordedStart) ? recordedStart : null;
  const anchor = exactStart || generatedAt;
  const localDay = accountingDateOnly(
    zonedAccountingDate(anchor ? new Date(anchor) : new Date(), zone)
  );
  if (!exactStart) localDay.setUTCDate(localDay.getUTCDate() - days + 1);
  const from = exactStart || zonedAccountingInstant(localDay.toISOString().slice(0, 10), 0, zone);
  localDay.setUTCDate(localDay.getUTCDate() + days);
  return { from, to: zonedAccountingInstant(localDay.toISOString().slice(0, 10), 0, zone) };
}

export function readStatsDrilldown(params: URLSearchParams): StatsHandDrilldown {
  const clubId = params.get('statsClub')?.trim();
  const variant = params.get('variant')?.trim().toLowerCase();
  const position = params.get('position')?.trim().toUpperCase();
  const bigBlindRaw = Number(params.get('bigBlind'));
  const fromRaw = params.get('from') || '';
  const toRaw = params.get('to') || '';
  const statsMetricRaw = params.get('statsMetric')?.trim().toLowerCase();
  const statsSessionRaw = params.get('statsSession')?.trim();
  const mode = params.get('gameMode');
  return {
    ...(mode === 'cash' || mode === 'tournament' ? { gameMode: mode } : {}),
    ...(clubId ? { clubId } : {}),
    ...(variant ? { variant } : {}),
    ...(position ? { position } : {}),
    ...(Number.isFinite(bigBlindRaw) && bigBlindRaw > 0 ? { bigBlind: bigBlindRaw } : {}),
    ...(DATE_ONLY.test(fromRaw) || isInstant(fromRaw) ? { from: fromRaw } : {}),
    ...(DATE_ONLY.test(toRaw) || isInstant(toRaw) ? { to: toRaw } : {}),
    ...(isCashEvidenceMetric(statsMetricRaw) ? { statsMetric: statsMetricRaw } : {}),
    ...(statsSessionRaw && UUID.test(statsSessionRaw) ? { statsSession: statsSessionRaw } : {}),
  };
}

export function statsEvidenceQueryFromDrilldown(drilldown: StatsHandDrilldown): StatsEvidenceQuery {
  // Prior shared links carried inclusive UTC dates. New links carry exact [from, to) instants.
  const from =
    drilldown.from && DATE_ONLY.test(drilldown.from)
      ? `${drilldown.from}T00:00:00.000Z`
      : (drilldown.from ?? null);
  let to = drilldown.to ?? null;
  if (to && DATE_ONLY.test(to)) {
    const end = new Date(`${to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    to = Number.isFinite(end.getTime()) ? end.toISOString() : null;
  }
  return {
    variant: drilldown.variant,
    position: drilldown.position,
    bigBlind: drilldown.bigBlind,
    from,
    to,
    cashMetric: drilldown.statsMetric,
    tournament: drilldown.gameMode ? drilldown.gameMode === 'tournament' : false,
  };
}

function canonicalVariant(value: string): string {
  const compact = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (compact === 'holdem' || compact === 'texasholdem' || compact === 'nlh') return 'nlh';
  if (compact === 'omaha' || compact === 'plo' || compact === 'plo4') return 'plo4';
  return compact;
}

function handBigBlind(stakes: string): number | null {
  const numbers =
    stakes
      .match(/\d+(?:\.\d+)?/g)
      ?.map(Number)
      .filter(Number.isFinite) ?? [];
  return numbers.length > 0 ? numbers[numbers.length - 1] : null;
}

export function filterHandsByStatsDrilldown(
  hands: HandRecord[],
  drilldown: StatsHandDrilldown,
  userId: string
): HandRecord[] {
  const bounds = statsEvidenceQueryFromDrilldown(drilldown);
  const from = bounds.from ? Date.parse(bounds.from) : null;
  const to = bounds.to ? Date.parse(bounds.to) : null;
  return hands.filter((hand) => {
    if (drilldown.gameMode && Boolean(hand.tournament_id) !== (drilldown.gameMode === 'tournament'))
      return false;
    if (
      drilldown.variant &&
      canonicalVariant(hand.game_type) !== canonicalVariant(drilldown.variant)
    )
      return false;
    if (drilldown.bigBlind) {
      const bb = handBigBlind(hand.stakes);
      if (bb === null || Math.abs(bb - drilldown.bigBlind) > 0.000001) return false;
    }
    if (
      drilldown.position &&
      !hand.players.some(
        (player) => player.user_id === userId && player.position === drilldown.position
      )
    )
      return false;
    const playedAt = Date.parse(hand.played_at);
    if (from !== null && (!Number.isFinite(playedAt) || playedAt < from)) return false;
    if (to !== null && (!Number.isFinite(playedAt) || playedAt >= to)) return false;
    return true;
  });
}
