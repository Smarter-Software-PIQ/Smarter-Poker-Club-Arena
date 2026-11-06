/** Closed read-only observation of original river value nodes; never policy replay. */
export function inspectRiverValueRecords(input, batch, api, reconcileOriginal) {
  const base = {
    version: 8,
    probe: 'river_value',
    status: 'unknown',
    rawRecordsExported: false,
    replayVerified: false,
    causalReplayVerified: false,
    gtoVerified: false,
    activationAllowed: false,
  };
  if (!input || input.version !== 8 || input.probe !== 'river_value')
    return { ...base, reason: 'input_refused' };
  const joined = reconcileOriginal(
    { ...input, version: 7, probe: 'original_turn_gap' },
    batch,
    api
  );
  if (!joined.cases) return { ...base, reason: joined.reason };
  const cases = joined.cases.map((item, index) => {
    const no = (reason) => ({ handKey: input.cases[index].handKey, status: 'unknown', reason });
    if (item.status !== 'observed') return no(item.reason);
    try {
      if (!item.selection.matched || item.executionStatus !== 'intended')
        return no('selection_not_matched');
      const rows = batch.recordsByHand[index].records;
      const capture = JSON.parse(rows.find((r) => r.sha256 === item.recordHashes.decision).body);
      const witness = JSON.parse(rows.find((r) => r.sha256 === item.recordHashes.execution).body);
      const g = capture.snapshot.gameState,
        p = capture.snapshot.player,
        b = g.communityCards;
      if (
        !['plo4', 'plo5', 'plo6'].includes(g.gameVariant) ||
        g.stage !== 'river' ||
        !['cash', 'tournament'].includes(g.gameMode) ||
        g.currentBet !== 0 ||
        p.bet !== 0 ||
        (g.toCall !== undefined && g.toCall !== 0) ||
        !g.legalActions?.includes('bet') ||
        g.variantRules?.splitLow8OrBetter ||
        (g.bettingStructure !== undefined && g.bettingStructure !== 'pot_limit') ||
        g.bombPot ||
        g.allInOrFold ||
        (g.boardCount ?? 1) !== 1 ||
        g.communityCards2?.length ||
        g.communityCards3?.length ||
        !Array.isArray(b) ||
        b.length !== 5 ||
        !Array.isArray(p.cards) ||
        p.cards.length !== Number(g.gameVariant.at(-1))
      )
        return no('outside_river_value_context');
      const cards = [...p.cards, ...b];
      if (
        cards.some(
          (c) =>
            !c ||
            !['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'].includes(c.rank) ||
            !['clubs', 'diamonds', 'hearts', 'spades'].includes(c.suit)
        ) ||
        new Set(cards.map((c) => c.rank + ':' + c.suit)).size !== cards.length ||
        api.omahaQuickCategory(p.cards, b) !== 7
      )
        return no('outside_river_value_context');
      const history = g.actionHistory;
      if (
        !Array.isArray(history) ||
        history.length > 4096 ||
        !history.some((a) => a.stage === 'river' && a.action === 'check' && a.userId !== p.user_id)
      )
        return no('outside_river_value_context');
      let aggressor;
      for (const street of ['turn', 'flop', 'preflop']) {
        aggressor = history
          .filter(
            (a) =>
              a.stage === street &&
              (a.action === 'bet' ||
                a.action === 'raise' ||
                (a.action === 'all_in' && a.isFullRaise === true))
          )
          .at(-1);
        if (aggressor) break;
      }
      if (!aggressor || aggressor.userId === p.user_id) return no('outside_initiative_context');
      const opponent = g.players.find((x) => x.user_id === aggressor.userId);
      if (
        !opponent ||
        opponent.is_folded ||
        opponent.is_sitting_out ||
        opponent.is_all_in ||
        !(opponent.stack > 0)
      )
        return no('outside_initiative_context');
      const checked = history.some(
        (a) => a.stage === 'river' && a.action === 'check' && a.userId === aggressor.userId
      );
      let initiative = 'aggressor_checked';
      if (!checked) {
        if (
          history.some((a) => a.stage === 'river' && a.userId === aggressor.userId) ||
          typeof api.checkedToNonBottomRiverBoat !== 'function'
        )
          return no('eligibility_unavailable');
        if (!api.checkedToNonBottomRiverBoat(p, g)) return no('outside_nonbottom_context');
        initiative = 'nonbottom_aggressor_pending';
      }
      const policyComparisons = [];
      for (const owner of [
        'phase8',
        'phase8Guard',
        'phase10',
        'phase11',
        'phase12',
        'phase13',
        'phase14',
      ]) {
        const a = witness[owner + 'Authority'];
        if (!a) continue;
        const same = (x) =>
          x?.action === witness.selected.action &&
          (x?.amount ?? null) === (witness.selected.amount ?? null);
        policyComparisons.push({
          owner,
          selectedMatchesReference: same(a.reference),
          selectedMatchesCandidate: same(a.candidate),
        });
      }
      return {
        handKey: item.handKey,
        status: 'observed',
        actionOrdinal: item.actionOrdinal,
        variant: g.gameVariant,
        mode: g.gameMode,
        initiative,
        actions: item.actions,
        recordHashes: item.recordHashes,
        inputDigest: item.inputDigest,
        readFrameDigest: item.readFrameDigest,
        policyComparisons,
        baselineAttribution: policyComparisons.length ? 'receipt_comparison_only' : 'unavailable',
        guards: item.guards,
      };
    } catch {
      return no('record_or_validator_unavailable');
    }
  });
  const result = {
    ...base,
    sourceRelease: input.sourceRelease,
    cases,
    status: cases.every((c) => c.status === 'observed') ? 'observed' : 'unknown',
  };
  for (let i = cases.length - 1; i >= 0 && Buffer.byteLength(JSON.stringify(result)) > 8192; i--) {
    cases[i] = { handKey: input.cases[i].handKey, status: 'unknown', reason: 'output_bound' };
    result.status = 'unknown';
  }
  return result;
}
export async function loadInstalledRiverValueApi(loadOriginal) {
  const api = { ...(await loadOriginal()), ...(await import('/app/dist/engine/HorseEval.js')) };
  try {
    Object.assign(api, await import('/app/dist/engine/HorseNonBottomRiverValue.js'));
  } catch {
    /* Older source can prove only the original aggressor-checked context. */
  }
  return api;
}
