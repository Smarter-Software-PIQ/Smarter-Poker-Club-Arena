/** Closed original-receipt census, not a strategy certificate or policy replay. */
export function inspectHorseFleetSlice(
  input,
  batch,
  api,
  original,
  river,
  now = () => performance.now()
) {
  const hash = (s) => api.journalHash(s);
  const base = {
    version: 9,
    probe: 'fleet_slice',
    status: 'unknown',
    rawRecordsExported: false,
    replayVerified: false,
    causalReplayVerified: false,
    strategyApplicationVerified: false,
    completePopulation: false,
    activationAllowed: false,
    rosterAuthority: 'externally_supplied_unverified',
    windowClock: 'engine_record_and_decision_timestamps',
    crossClockCutoffVerified: false,
    actionScope: 'accepted_horse_policy_actions_for_supplied_roster',
  };
  if (
    !input ||
    input.version !== 9 ||
    input.probe !== 'fleet_slice' ||
    !Array.isArray(input.cases) ||
    input.cases.length < 1 ||
    input.cases.length > 6 ||
    !Array.isArray(input.roster?.horseIds) ||
    !input.roster.horseIds.length ||
    input.roster.horseIds.length > 64 ||
    new Set(input.roster.horseIds).size !== input.roster.horseIds.length
  )
    return { ...base, reason: 'input_refused' };
  const start = Date.parse(input.window?.startUtc),
    end = Date.parse(input.window?.endUtc);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 86400000)
    return { ...base, reason: 'input_refused' };
  const roster = new Set(input.roster.horseIds),
    deadline = now() + 10000;
  const report = {
    ...base,
    sourceRelease: input.sourceRelease,
    expectedInstanceId: input.expectedInstanceId,
    window: input.window,
    rosterDigest: input.roster.digest,
    rosterTotal: input.roster.total,
    selectedHorseHashes: input.roster.horseIds.map(hash),
    selectedHands: input.cases.length,
    inspectedHands: 0,
    boundReached: false,
    hands: [],
  };
  if (
    !batch ||
    batch.status !== 'canonical_journal_export' ||
    batch.sourceRelease !== input.sourceRelease ||
    !Array.isArray(batch.recordsByHand) ||
    batch.recordsByHand.length !== input.cases.length
  )
    return { ...base, reason: 'journal_source_or_shape_mismatch' };
  const seenHands = new Set();
  for (const [index, target] of input.cases.entries()) {
    if (now() >= deadline) {
      report.boundReached = true;
      break;
    }
    const result = {
      handKey: target.handKey,
      status: 'unknown',
      reason: 'capture_unavailable',
      selectedActions: 0,
      inspectedActions: 0,
      acceptedRecordHash: null,
      rows: [],
    };
    try {
      if (seenHands.has(target.handKey)) throw Error();
      seenHands.add(target.handKey);
      const entry = batch.recordsByHand[index];
      if (
        !entry ||
        entry.handKey !== target.handKey ||
        !Array.isArray(entry.records) ||
        !entry.records.length ||
        entry.records.length > 256
      )
        throw Error();
      const events = new Set();
      for (const r of entry.records) {
        api.validateHorseJournalRecord(r);
        if (
          r.handKey !== target.handKey ||
          r.sourceRelease !== input.sourceRelease ||
          events.has(r.eventId)
        )
          throw Error();
        events.add(r.eventId);
      }
      const accepted = entry.records.filter((r) => r.kind === 'accepted_hand');
      if (accepted.length !== 1) throw Error();
      const hand = JSON.parse(accepted[0].body);
      if (
        accepted[0].atMs < start ||
        accepted[0].atMs >= end ||
        hand.committedHandId !== target.handId ||
        api.horseCompletedHandKey(hand) !==
          `${target.tableId}:${target.handNumber}:${target.leaseGeneration}` ||
        !Array.isArray(hand.actions) ||
        hand.actions.length > 4096
      )
        throw Error();
      result.acceptedRecordHash = accepted[0].sha256;
      if (api.reconcileHorseJournalHand(entry.records, target.handKey).status !== 'reconciled')
        throw Error();
      const actions = hand.actions
        .map((a, ordinal) => ({ a, ordinal }))
        .filter(({ a }) => a.origin === 'horse_policy' && roster.has(a.userId));
      result.selectedActions = actions.length;
      const rows = new Map();
      for (const { a, ordinal } of actions) {
        if (now() >= deadline) {
          report.boundReached = true;
          break;
        }
        const one = {
          version: 7,
          probe: 'original_turn_gap',
          sourceRelease: input.sourceRelease,
          cases: [
            {
              ...target,
              actorId: a.userId,
              seat: a.seat,
              actionOrdinal: ordinal,
              decisionRecordSha256: null,
            },
          ],
        };
        const oneBatch = { ...batch, recordsByHand: [entry] };
        const joined = original(one, oneBatch, api).cases?.[0];
        const horseHash = hash(a.userId);
        let row = rows.get(horseHash);
        if (!row) {
          row = {
            horseHash,
            acceptedActions: 0,
            sourceWitnesses: 0,
            selectionMatched: 0,
            qualifyingRiver: 0,
            acceptedValueBets: 0,
            acceptedAllIns: 0,
            acceptedChecks: 0,
            exactMemoryReads: 0,
            contexts: [],
            gaps: {},
            witnessDigest: null,
          };
          rows.set(horseHash, row);
        }
        row.acceptedActions++;
        result.inspectedActions++;
        const gap = (reason) => {
          row.gaps[reason] = (row.gaps[reason] ?? 0) + 1;
        };
        if (joined?.status !== 'observed') {
          gap('original_join_unavailable');
          continue;
        }
        const decision = entry.records.find((r) => r.sha256 === joined.recordHashes.decision);
        const execution = entry.records.find((r) => r.sha256 === joined.recordHashes.execution);
        const capture = JSON.parse(decision.body),
          s = capture.snapshot;
        if (
          s.decisionTimeMs < start ||
          s.decisionTimeMs >= end ||
          decision.atMs < start ||
          decision.atMs >= end ||
          execution.atMs < start ||
          execution.atMs >= end
        ) {
          gap('outside_window');
          continue;
        }
        row.sourceWitnesses++;
        if (joined.selection.matched && joined.executionStatus === 'intended')
          row.selectionMatched++;
        // Hash the ordered original receipt chain; never expose payloads or amounts.
        row.witnessDigest = hash(JSON.stringify([row.witnessDigest, ordinal, joined.recordHashes]));
        const g = s.gameState,
          d = g.publicMemoryDomain;
        const exactDomain =
          d &&
          Object.keys(d).sort().join(',') === 'ante,speed,version' &&
          d.version === 1 &&
          ['table', 'lightning'].includes(d.speed) &&
          ['none', 'individual', 'big_blind'].includes(d.ante);
        const memory = capture.observerReads;
        const memoryObserved =
          exactDomain &&
          memory?.context?.version === 2 &&
          memory.context.publicMemoryDomain?.version === 1 &&
          memory.context.publicMemoryDomain.speed === d.speed &&
          memory.context.publicMemoryDomain.ante === d.ante &&
          typeof api.horseObserverReadsUsedPublicPool === 'function' &&
          api.horseObserverReadsUsedPublicPool(memory, s);
        if (memoryObserved) row.exactMemoryReads++;
        else gap('exact_memory_unavailable');
        const context = {
          variant: joined.variant,
          mode: joined.mode,
          format: ['cash', 'mtt', 'sng', 'spin'].includes(g.format) ? g.format : null,
          speed: exactDomain ? d.speed : null,
          ante: exactDomain ? d.ante : null,
          dealtCount:
            g.dealtSeatIds?.length >= 2 && g.dealtSeatIds.length <= 10
              ? g.dealtSeatIds.length
              : null,
          exactMemoryReads: memoryObserved ? 1 : 0,
          sourceWitnesses: 1,
        };
        const previous = row.contexts.find(
          (c) =>
            c.variant === context.variant &&
            c.mode === context.mode &&
            c.format === context.format &&
            c.speed === context.speed &&
            c.ante === context.ante &&
            c.dealtCount === context.dealtCount
        );
        if (previous) {
          previous.sourceWitnesses++;
          previous.exactMemoryReads += context.exactMemoryReads;
        } else row.contexts.push(context);
        const opportunity = river(
          { ...one, version: 8, probe: 'river_value' },
          oneBatch,
          api,
          original
        ).cases?.[0];
        if (opportunity?.status === 'observed') {
          row.qualifyingRiver++;
          if (opportunity.actions.accepted === 'bet') row.acceptedValueBets++;
          if (opportunity.actions.accepted === 'all_in') row.acceptedAllIns++;
          if (opportunity.actions.accepted === 'check') row.acceptedChecks++;
        } else if (
          ![
            'outside_river_value_context',
            'outside_initiative_context',
            'outside_nonbottom_context',
            'selection_not_matched',
          ].includes(opportunity?.reason)
        )
          gap('river_eligibility_unavailable');
      }
      result.rows = [...rows.values()];
      result.status =
        result.inspectedActions === result.selectedActions &&
        result.rows.every((r) => r.sourceWitnesses === r.acceptedActions)
          ? 'observed'
          : 'partial';
      result.reason =
        result.status === 'observed' ? 'selected_actions_inspected' : 'selected_actions_unverified';
    } catch {
      /* Closed unavailable result, no exception or private payload escapes. */
    }
    report.hands.push(result);
    report.inspectedHands++;
    if (Buffer.byteLength(JSON.stringify(report)) > 32768) {
      report.hands.pop();
      report.inspectedHands--;
      report.boundReached = true;
      break;
    }
  }
  report.status =
    !report.boundReached &&
    report.inspectedHands === report.selectedHands &&
    report.hands.every((h) => h.status === 'observed')
      ? 'observed'
      : 'partial';
  return report;
}
export async function loadInstalledFleetSliceApi(loadRiver, loadOriginal) {
  const api = await loadRiver(loadOriginal);
  try {
    Object.assign(api, await import('/app/dist/engine/HorseObserverReadEvidence.js'));
  } catch {
    /* Old source retains unavailable memory, never a substituted validator. */
  }
  return api;
}
