import {
  publicMemoryDomainIsValid,
  publicMemoryDomainKey,
  type HorsePublicMemoryDomain,
} from './HorsePublicMemoryDomain.js';
import { horseTournamentProvenanceMatchesSnapshot } from './HorseTournamentContextProvenance.js';
import { TOURNAMENT_CONTEXT_INCOMPLETE } from './HorseTournamentPreflop.js';
import type { LiveHorseDecisionSnapshot } from './horseDecision/protocol.js';
const VARIANTS = [
  'nlh',
  'plo4',
  'plo5',
  'plo6',
  'plo8',
  'flh',
  'flo8',
  'short_deck',
  'pineapple',
] as const;
type ObserverVariant = (typeof VARIANTS)[number];
const memoryVariant = (value: unknown): ObserverVariant | null =>
  typeof value === 'string' && VARIANTS.includes(value as ObserverVariant)
    ? (value as ObserverVariant)
    : null;

// These original issues affect payout, field valuation or seat-position charts.
const ISSUES_OUTSIDE_PUBLIC_MEMORY_DOMAIN = new Set<string>([
  TOURNAMENT_CONTEXT_INCOMPLETE,
  'satellite_award_depth_unavailable',
  'live_field_recovery_pending',
  'live_field_stack_cardinality_mismatch',
  'dead_button_atlas_unsupported',
]);

/** An individual observer's public-read partition. Unknown stays unavailable. */
export interface HorseObserverReadContext {
  readonly version: 1 | 2;
  readonly publicMemoryDomain?: HorsePublicMemoryDomain;
  readonly observerId: string;
  readonly variant: ObserverVariant;
  readonly format: 'cash' | 'mtt' | 'sng' | 'spin' | 'hu_sng';
  readonly dealtCount: number;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function horseObserverReadContextIsValid(value: unknown): value is HorseObserverReadContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = ['version', 'observerId', 'variant', 'format', 'dealtCount'];
  if (v.version === 2) keys.push('publicMemoryDomain');
  return (
    Object.keys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k)) &&
    (v.version === 1 || (v.version === 2 && publicMemoryDomainIsValid(v.publicMemoryDomain))) &&
    typeof v.observerId === 'string' &&
    UUID.test(v.observerId) &&
    typeof v.variant === 'string' &&
    memoryVariant(v.variant) === v.variant &&
    ['cash', 'mtt', 'sng', 'spin', 'hu_sng'].includes(v.format as string) &&
    Number.isInteger(v.dealtCount) &&
    (v.dealtCount as number) >= 2 &&
    (v.dealtCount as number) <= 10
  );
}
export function horseObserverReadContextKey(value: unknown): string | null {
  if (!horseObserverReadContextIsValid(value)) return null;
  return JSON.stringify([
    value.version,
    value.observerId.toLowerCase(),
    value.variant,
    value.format,
    value.dealtCount,
    ...(value.version === 2 ? [publicMemoryDomainKey(value.publicMemoryDomain)] : []),
  ]);
}
export function horseObserverReadContextFromRequest(
  request: Pick<LiveHorseDecisionSnapshot, 'player' | 'gameState'>
): HorseObserverReadContext | null {
  const { gameState: gs, player } = request;
  const variant = memoryVariant(gs.gameVariant);
  const dealt = gs.dealtSeatIds;
  let format = gs.format;
  if (gs.gameMode === 'tournament' && gs.tournament?.contextStatus !== 'complete') {
    const tournament = gs.tournament;
    const provenance = tournament?.contextProvenance;
    if (
      tournament?.contextStatus !== 'incomplete' ||
      !provenance?.source?.mttFormatContract ||
      !publicMemoryDomainIsValid(gs.publicMemoryDomain) ||
      !Array.isArray(gs.players) ||
      !Array.isArray(tournament.contextIssues) ||
      !horseTournamentProvenanceMatchesSnapshot(request) ||
      !tournament.contextIssues.some((issue) => issue !== TOURNAMENT_CONTEXT_INCOMPLETE) ||
      !tournament.contextIssues.every((issue) => ISSUES_OUTSIDE_PUBLIC_MEMORY_DOMAIN.has(issue)) ||
      !Array.isArray(dealt) ||
      (tournament.contextIssues.includes('dead_button_atlas_unsupported') &&
        (dealt.length <= 2 || gs.dealerSeat == null || dealt.includes(gs.dealerSeat))) ||
      dealt.length !== provenance.projection.dealtSeatIds.length ||
      !dealt.every((seat) => provenance.projection.dealtSeatIds.includes(seat))
    )
      return null;
    format = 'mtt';
  }
  // The original producer's dealt seats are required. RLS chairs and showdown
  // cards do not reconstruct participation. Never infer format from stack size.
  if (
    !variant ||
    !Array.isArray(gs.players) ||
    !Array.isArray(dealt) ||
    new Set(dealt).size !== dealt.length ||
    !dealt.includes(player.seat) ||
    dealt.some((seat) => !Number.isInteger(seat) || seat < 1 || seat > 10) ||
    gs.players.filter((p) => p.user_id === player.user_id && p.seat === player.seat).length !== 1 ||
    dealt.some((seat) => gs.players.filter((p) => p.seat === seat).length !== 1) ||
    (gs.format === 'cash' ? gs.gameMode !== 'cash' : gs.gameMode !== 'tournament')
  )
    return null;
  if (Object.hasOwn(gs, 'publicMemoryDomain') && !publicMemoryDomainIsValid(gs.publicMemoryDomain))
    return null;
  const value = {
    version: publicMemoryDomainIsValid(gs.publicMemoryDomain) ? 2 : 1,
    ...(publicMemoryDomainIsValid(gs.publicMemoryDomain)
      ? { publicMemoryDomain: gs.publicMemoryDomain }
      : {}),
    observerId: player.user_id?.toLowerCase(),
    variant,
    format,
    dealtCount: dealt.length,
  };
  return horseObserverReadContextIsValid(value) ? Object.freeze(value) : null;
}
