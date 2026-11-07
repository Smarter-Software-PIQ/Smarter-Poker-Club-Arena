/** Bounded read-only journal inspection. Only selected counters and receipts leave the host. */
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function validateSelection(p) {
  const shape = p && Object.keys(p).sort().join(',');
  if (typeof p?.sourceSha !== 'string' || !/^[a-f0-9]{40}$/.test(p.sourceSha))
    throw Error('selection_refused');
  const batched = shape === 'sourceSha,targets';
  if (
    !batched &&
    (shape !== 'handKeys,opponentId,sourceSha' ||
      typeof p.opponentId !== 'string' ||
      !uuid.test(p.opponentId))
  )
    throw Error('selection_refused');
  const entries = batched ? p.targets : p.handKeys;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 16)
    throw Error('selection_refused');
  const keys = new Set();
  for (const entry of entries) {
    if (
      batched &&
      (!entry ||
        Object.keys(entry).sort().join(',') !== 'handKey,opponentId' ||
        typeof entry.opponentId !== 'string' ||
        !uuid.test(entry.opponentId))
    )
      throw Error('selection_refused');
    const key = batched ? entry.handKey : entry;
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key) || keys.has(key))
      throw Error('selection_refused');
    keys.add(key);
  }
  return p;
}
// The original captures can contain arbitrary private values. Only these
// producer-defined categories can leave the host; older and unknown values stay null.
const observerDispositions = new Set([
  'independent',
  'pooled_public',
  'unknown_context',
  'unknown_hand',
  'cutoff_unavailable',
  'capacity_reset',
  'history_unavailable',
]);
const tournamentContextStatuses = new Set(['complete', 'incomplete', 'warming', 'stale']);
// Match only literal diagnostic categories emitted by the producer. Never forward
// arbitrary issue strings, identifiers or the tournament provenance object.
const tournamentIssueCodes = new Set([
  'addon_terms_missing',
  'blind_level_cache_lag',
  'blind_structure_or_level_invalid',
  'bounty_type_state_missing',
  'dead_button_atlas_unsupported',
  'dealer_seat_missing',
  'entry_window_terms_invalid',
  'game_variant_missing',
  'level_timing_future',
  'level_timing_missing',
  'level_timing_paused',
  'level_timing_stale',
  'live_blinds_invalid',
  'live_field_recovery_pending',
  'live_field_stack_cardinality_mismatch',
  'live_seat_state_incomplete',
  'live_stack_distribution_missing',
  'mystery_bounty_inventory_unavailable',
  'mystery_bounty_stage_missing',
  'next_blind_level_invalid',
  'payout_or_ticket_structure_missing',
  'player_population_invalid',
  'reentry_or_rebuy_limits_invalid',
  'reentry_or_rebuy_terms_missing',
  'reentry_rebuy_or_addon_state_missing',
  'registration_state_missing',
  'satellite_award_depth_unavailable',
  'satellite_entitlement_read_failed',
  'seats_per_table_invalid',
  'tournament_context_missing',
  'tournament_context_refresh_failed',
  'tournament_context_refresh_not_started',
  'tournament_context_refresh_timed_out',
  'tournament_context_stale',
  'tournament_context_warming',
  'tournament_id_missing',
  'tournament_status_missing',
  'tournament_type_missing',
]);
function observedTournamentIssues(tournament) {
  const issues = tournament?.contextIssues;
  if (!Array.isArray(issues) || issues.length > 64) return null;
  return {
    codes: [...new Set(issues.filter((v) => tournamentIssueCodes.has(v)))],
    otherIssuePresent: issues.some(
      (v) => v !== 'TOURNAMENT_CONTEXT_INCOMPLETE' && !tournamentIssueCodes.has(v)
    ),
  };
}
export function summarizeDecision(record, capture, view, opponentId, independent, execution) {
  const s = capture.snapshot;
  if (s?.type !== 'DECIDE_FAST' || !s.gameState?.players?.some((p) => p.user_id === opponentId))
    return null;
  const read = view.stats.get(opponentId);
  const word = (v) => (typeof v === 'string' && /^[a-z0-9_:-]{1,100}$/.test(v) ? v : null);
  const authority = (v) =>
    v ? { mode: word(v.mode), selection: word(v.selection), verdict: word(v.verdict) } : null;
  const o = capture.observerReads;
  const tournamentStatus = s.gameState.tournament?.contextStatus;
  return {
    handKey: record.handKey,
    sourceRelease: record.sourceRelease,
    observerId: s.player.user_id,
    decisionTimeMs: s.decisionTimeMs,
    street: s.gameState.stage ?? null,
    action: capture.decision.action,
    independent,
    observerDisposition: observerDispositions.has(o?.disposition) ? o.disposition : null,
    tournamentContextStatus: tournamentContextStatuses.has(tournamentStatus)
      ? tournamentStatus
      : null,
    tournamentIssues: observedTournamentIssues(s.gameState.tournament),
    history: o?.history ?? 'unknown',
    historyHands: o?.historyHands ?? null,
    historyCapped: o?.historyCapped ?? null,
    learnedThroughMs: o?.learnedThroughMs ?? null,
    opponent: read
      ? {
          hands: read.hands,
          vpip: read.vpip,
          pfr: read.pfr,
          threeBet: read.threeBet,
          sourceWindow: read.sourceWindow ?? null,
        }
      : null,
    execution: execution
      ? {
          status: word(execution.executionStatus),
          action: word(execution.executedAction),
          phase11: authority(execution.phase11Authority),
          phase13: authority(execution.phase13Authority),
        }
      : null,
  };
}
// A reconciled hand can contain both independent and shared reads. Attribute
// the shared read only to the original decision whose selected wager landed.
export function acceptedSharedRead(capture, execution, hand, review, usedPublicPool, bind) {
  const context = capture.observerReads?.context;
  if (
    !hand ||
    review.status !== 'reconciled' ||
    context?.version !== 2 ||
    typeof usedPublicPool !== 'function' ||
    !usedPublicPool(capture.observerReads, capture.snapshot) ||
    execution?.executionStatus !== 'intended' ||
    execution.handAnchor?.earlyLook === true ||
    execution.executedAction !== execution.selected?.action ||
    execution.selected?.action !== capture.decision.action ||
    execution.selected.amount !== (capture.decision.amount ?? null)
  )
    return null;
  const binding = bind(execution, hand);
  if (binding.status !== 'bound') return null;
  return {
    actionOrdinal: binding.actionOrdinal,
    profileDigest: capture.observerReads.pooledPublicProfiles.digest,
    profileSource: capture.observerReads.pooledPublicProfiles.source,
    variant: context.variant,
    format: context.format,
    dealtCount: context.dealtCount,
    speed: context.publicMemoryDomain.speed,
    ante: context.publicMemoryDomain.ante,
  };
}
const failureReasons = new Set([
  'selection_decode_failed',
  'selection_refused',
  'serving_identity_refused',
  'module_load_failed',
  'journal_configuration_missing',
  'inspection_bound',
  'journal_read_failed',
  'journal_reconciliation_failed',
  'record_decode_failed',
  'retained_plan_refused',
  'read_frame_refused',
  'decision_summary_failed',
  'output_encoding_failed',
]);
const failures = new WeakMap();
function inspectionFailure(reason) {
  const error = new Error();
  failures.set(error, reason);
  return error;
}
// Never classify by a thrown message/code: journal contents and errors are untrusted.
export function sanitizeInspectionFailure(error) {
  const reason = error && typeof error === 'object' ? failures.get(error) : undefined;
  return {
    scope: 'selected_horse_opponent_reads',
    status: 'unavailable',
    reason: failureReasons.has(reason) ? reason : 'inspection_unavailable',
  };
}
export async function inspect(p) {
  let stage = 'selection_refused';
  try {
    validateSelection(p);
    stage = 'serving_identity_refused';
    if (process.env.GIT_COMMIT_SHA !== p.sourceSha) throw Error('serving_identity_changed');
    const moduleAt = (path) => import(pathToFileURL(resolve('dist', path)).href);
    stage = 'module_load_failed';
    const [
      { readHorseJournalHandRecords, reconcileHorseJournalHand },
      { horseRetainedPlanContext },
      { decodeHorseDecisionReads },
      { horsePlanHandKey },
      { horseObserverReadsWereIndependent, horseObserverReadsUsedPublicPool },
    ] = await Promise.all([
      moduleAt('services/horseDecisionJournal/review.js'),
      moduleAt('services/horseDecisionJournal/effects.js'),
      moduleAt('engine/HorseDecisionReadFrame.js'),
      moduleAt('engine/HorseDecisionEffects.js'),
      moduleAt('engine/HorseObserverReadEvidence.js'),
    ]);
    stage = 'journal_configuration_missing';
    const directory = process.env.HORSE_DECISION_JOURNAL_DIR;
    if (!directory) throw Error('journal_unavailable');
    let bind;
    const hands = [];
    let bytes = 0;
    const started = Date.now();
    const targets =
      p.targets ?? p.handKeys.map((handKey) => ({ handKey, opponentId: p.opponentId }));
    for (const { handKey, opponentId } of targets) {
      stage = 'inspection_bound';
      if (Date.now() - started > 30000) throw Error('inspection_bound');
      stage = 'journal_read_failed';
      const records = readHorseJournalHandRecords(directory, handKey);
      stage = 'inspection_bound';
      bytes += records.reduce((n, r) => n + r.bytes, 0);
      if (bytes > 32 * 1024 * 1024) throw Error('inspection_bound');
      stage = 'journal_reconciliation_failed';
      const review = reconcileHorseJournalHand(records, handKey);
      const decisions = [];
      stage = 'record_decode_failed';
      const committed = records.filter((r) => r.kind === 'accepted_hand');
      const hand =
        committed.length === 1 && committed[0].sourceRelease === p.sourceSha
          ? JSON.parse(committed[0].body)
          : null;
      const turnKey = (r) => JSON.stringify([r.producerId, r.turnKey]);
      const executions = new Map(
        records
          .filter((r) => r.kind === 'execution' && r.sourceRelease === p.sourceSha)
          .map((r) => [turnKey(r), JSON.parse(r.body)])
      );
      for (const r of records) {
        if (r.kind !== 'decision' || r.sourceRelease !== p.sourceSha) continue;
        stage = 'record_decode_failed';
        const c = JSON.parse(r.body),
          s = c.snapshot;
        if (
          s?.type !== 'DECIDE_FAST' ||
          !s.gameState?.players?.some((a) => a.user_id === opponentId)
        )
          continue;
        stage = 'retained_plan_refused';
        const plan = horseRetainedPlanContext(c, s);
        if (plan.kind === 'invalid') throw Error('plan_invalid');
        const context = plan.kind === 'current' ? plan.context : undefined;
        stage = 'read_frame_refused';
        const view = decodeHorseDecisionReads(
          c.readFrame,
          s.gameState.players,
          horsePlanHandKey(s.gameState.actionHistory, context),
          context
        );
        stage = 'decision_summary_failed';
        const execution = executions.get(turnKey(r));
        const row = summarizeDecision(
          r,
          c,
          view,
          opponentId,
          horseObserverReadsWereIndependent(c.observerReads, s),
          execution
        );
        if (row) {
          if (hand && review.status === 'reconciled' && c.observerReads?.context?.version === 2) {
            bind ??= (await moduleAt('engine/HorseDecisionHandBinding.js'))
              .bindHorseDecisionToCommittedHand;
            row.acceptedSharedRead = acceptedSharedRead(
              c,
              execution,
              hand,
              review,
              horseObserverReadsUsedPublicPool,
              bind
            );
          }
          decisions.push(row);
        }
      }
      if (p.targets) {
        const witnesses = decisions
          .filter((r) => r.acceptedSharedRead)
          .map((r) => ({
            observerHash: createHash('sha256').update(r.observerId).digest('hex'),
            decisionTimeMs: r.decisionTimeMs,
            acceptedSharedRead: r.acceptedSharedRead,
          }));
        hands.push({ handKey, reconciled: review.status === 'reconciled', witnesses });
      } else {
        hands.push({ handKey, review, decisions });
      }
    }
    return {
      scope: p.targets ? 'selected_accepted_shared_reads' : 'selected_horse_opponent_reads',
      sourceSha: p.sourceSha,
      opponentId: p.opponentId,
      hands,
      completePopulation: false,
    };
  } catch {
    throw inspectionFailure(stage);
  }
}
if (
  process.argv[1] === '-' ||
  (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
) {
  let stage = 'selection_decode_failed';
  try {
    const p = JSON.parse(Buffer.from(process.argv[2] ?? '', 'base64').toString('utf8'));
    stage = 'inspection_unavailable';
    const result = await inspect(p);
    stage = 'output_encoding_failed';
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      JSON.stringify(
        sanitizeInspectionFailure(failures.has(error) ? error : inspectionFailure(stage))
      )
    );
    process.exitCode = 1;
  }
}
