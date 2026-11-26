import { HORSE_TOURNAMENT_REBUY_SHARE } from './horseTournamentRebuyChoice.js';

/** One scoped, single-line record from the original input path. No polling or money writes.
 * Deduplicate choice records by (tournamentId,userId,handNumber), never count retries as choices.
 * Unknown/transport outcomes are not declines or proof that no purchase committed.
 */
export interface HorseRebuyDecisionDiagnostic {
  tournamentId: string;
  userId: string;
  handNumber: number;
  choice: boolean;
  /** The share the choice was drawn against; defaults to the ordinary share. */
  choiceShare?: number;
  phase:
    | 'choice'
    | 'deferred'
    | 'expired'
    | 'capacity_deferred'
    | 'purchase_pending'
    | 'purchase_started'
    | 'purchased'
    | 'purchase_unproven';
  bustAtMs: number | null;
  promptUntilMs: number | null;
  startedAtMs?: number;
  dueAtMs?: number | null;
  error?: unknown;
}
export function horseRebuyFailureClass(error: unknown): string {
  const e =
    error && typeof error === 'object' ? (error as { code?: unknown; message?: unknown }) : {};
  const message = typeof e.message === 'string' ? e.message : '';
  if (/window has closed|period is closed|not accepting rebuys/i.test(message)) return 'cutoff';
  if (/insufficient|balance|fund/i.test(message)) return 'funding';
  if (/limit reached/i.test(message)) return 'limit';
  if (/generation|knockout/i.test(message)) return 'generation';
  if (/seat|chair/i.test(message)) return 'seat';
  if (/bounty/i.test(message)) return 'bounty';
  if (/frozen|maintenance/i.test(message)) return 'freeze';
  if (e.code === '57014' || /timeout|canceling statement/i.test(message)) return 'timeout';
  if (/fetch|network|transport/i.test(message)) return 'transport';
  return 'unknown';
}
const DEDUPED_POLLING_PHASES: ReadonlySet<HorseRebuyDecisionDiagnostic['phase']> = new Set([
  'choice',
  'deferred',
  'expired',
  'capacity_deferred',
  'purchase_pending',
]);

/**
 * Deduplicate repetitive polling-phase diagnostics (`choice`, `deferred`,
 * `purchase_pending`, `capacity_deferred`, `expired`) per `(userId, handNumber,
 * phase)` across frequent elimination sweeps while always emitting active
 * purchase attempts and outcomes (`purchase_started`, `purchased`,
 * `purchase_unproven`). Bounded at `maxEntries` so memory never grows with
 * tournament duration (incident 1e532243).
 */
export function shouldEmitHorseRebuyDiagnostic(
  seen: Set<string>,
  userId: string,
  handNumber: number | string | null | undefined,
  phase: HorseRebuyDecisionDiagnostic['phase'],
  maxEntries = 512
): boolean {
  if (!DEDUPED_POLLING_PHASES.has(phase)) return true;
  const key = `${userId}:${handNumber ?? 'unknown'}:${phase}`;
  if (seen.has(key)) return false;
  if (seen.size >= maxEntries) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  seen.add(key);
  return true;
}

export function reportHorseRebuyDecision(input: HorseRebuyDecisionDiagnostic): void {
  try {
    const { error, choiceShare, ...identity } = input;
    const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null;
    const observedAtMs = Date.now();
    console.info(
      '[Tournament.horse_rebuy_decision] ' +
        JSON.stringify({
          schema: 'horse-rebuy-decision/v1',
          choiceShare: choiceShare ?? HORSE_TOURNAMENT_REBUY_SHARE,
          ...identity,
          observedAtMs,
          remainingMs: input.promptUntilMs === null ? null : input.promptUntilMs - observedAtMs,
          elapsedMs: input.startedAtMs === undefined ? null : observedAtMs - input.startedAtMs,
          sqlstate: typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null,
          failureClass: input.phase === 'purchase_unproven' ? horseRebuyFailureClass(error) : null,
        })
    );
  } catch {
    /* Diagnostics cannot interrupt the original input. */
  }
}
