/** Read the original graph node, never execute a chooser or price an alternative. */
export function inspectOriginalWagerRules(input, batch, api, reconcileOriginal) {
  const version = 10,
    probe = 'original_wager_rules';
  if (input?.version !== version || input.probe !== probe)
    return { status: 'unknown', reason: 'input_refused' };
  const original = reconcileOriginal(
    { ...input, version: 7, probe: 'original_turn_gap' },
    batch,
    api
  );
  const out = { ...original, version, probe };
  if (!original.cases) return out;
  out.cases = original.cases.map((item, i) => {
    if (item.status !== 'observed') return item;
    const no = (reason) => ({ handKey: item.handKey, status: 'unknown', reason });
    try {
      if (!item.selection.matched || item.executionStatus !== 'intended')
        return no('selection_not_matched');
      const rows = batch.recordsByHand[i].records;
      const read = (key) => JSON.parse(rows.find((r) => r.sha256 === item.recordHashes[key]).body);
      const d = read('decision'),
        w = read('execution'),
        { player: p, gameState: g } = d.snapshot;
      const b = g.communityCards;
      if (
        g.stage !== 'river' ||
        g.stateSchemaVersion !== 1 ||
        !['plo4', 'plo5', 'plo6'].includes(g.gameVariant) ||
        g.variantRules?.splitLow8OrBetter ||
        g.bombPot ||
        g.allInOrFold ||
        (g.boardCount ?? 1) !== 1 ||
        g.communityCards2?.length ||
        g.communityCards3?.length ||
        b?.length !== 5 ||
        p.cards?.length !== Number(g.gameVariant.at(-1)) ||
        p.bet !== 0 ||
        !Number.isFinite(p.stack) ||
        p.stack <= 0 ||
        p.is_folded ||
        p.is_all_in ||
        p.is_sitting_out ||
        !Array.isArray(g.actionHistory) ||
        g.actionHistory.length > 4096
      )
        return no('outside_value_context');
      const cards = [...p.cards, ...b];
      if (
        cards.some(
          (c) =>
            !c ||
            !'23456789TJQKA'.split('').includes(c.rank) ||
            !['clubs', 'diamonds', 'hearts', 'spades'].includes(c.suit)
        ) ||
        new Set(cards.map((c) => c.rank + c.suit)).size !== cards.length ||
        b.some((c) => b.filter((x) => x.rank === c.rank).length >= 3) ||
        api.omahaQuickCategory(p.cards, b) !== 7
      )
        return no('outside_value_context');
      let opportunity;
      if (
        g.toCall === 0 &&
        !g.wagersCapped &&
        Number.isFinite(g.pot) &&
        g.pot > 0 &&
        Number.isFinite(g.minRaiseTo) &&
        g.minRaiseTo > 0 &&
        Number.isFinite(g.maxRaiseTo) &&
        g.maxRaiseTo >= g.minRaiseTo &&
        g.maxRaiseTo <= p.stack + 0.005 &&
        g.players.some(
          (x) =>
            x.seat !== p.seat && !x.is_folded && !x.is_all_in && !x.is_sitting_out && x.stack > 0
        ) &&
        api.checkedToNonBottomRiverBoat(p, g)
      )
        opportunity = 'checked_to';
      else {
        if (
          g.bettingStructure !== 'pot_limit' ||
          !Number.isFinite(g.currentBet) ||
          !(g.currentBet > 0) ||
          !Number.isFinite(g.toCall) ||
          !(g.toCall > 0) ||
          Math.abs(Math.min(p.stack, g.toCall) - Math.min(p.stack, g.currentBet)) > 0.005 ||
          !(
            g.legalActions?.includes('call') ||
            (p.stack <= g.currentBet + 0.005 && g.legalActions?.includes('all_in'))
          )
        )
          return no('outside_value_context');
        const opener = g.actionHistory.find(
          (a) => a.stage === 'river' && ['bet', 'raise', 'all_in'].includes(a.action)
        );
        const faced = api.v81StreetWager(
          g.actionHistory,
          'river',
          new Map(g.players.map((x) => [x.seat, x.bet])),
          g.pot
        );
        if (
          opener?.action !== 'bet' ||
          opener.seat === p.seat ||
          opener.amount !== g.currentBet ||
          !faced ||
          faced.bettorSeat !== opener.seat ||
          faced.wager !== opener.amount ||
          faced.wager + 0.000001 < faced.potBefore ||
          !(api.omahaBoatPosition(p.cards, b)?.lowerBoats > 0) ||
          api.hasRiverNuts(p, g)
        )
          return no('outside_value_context');
        opportunity = 'facing_opening_pot_bet';
      }
      const graph = d.decision.policyGraph;
      if (
        !graph ||
        !w.policyGraph ||
        api.horseJournalJson(graph) !== api.horseJournalJson(w.policyGraph)
      )
        return no('original_graph_unavailable');
      const t = graph.transitions.find((x) => x.node === 'wager_rules');
      const same = (a, b) => a?.action === b?.action && a?.amount === b?.amount;
      const valid = (x) =>
        x &&
        ['fold', 'check', 'call', 'bet', 'raise', 'all_in'].includes(x.action) &&
        (x.amount === null || (Number.isFinite(x.amount) && x.amount >= 0));
      const order = api.horsePolicyOrderForVersion(graph.version);
      if (
        !order ||
        !Array.isArray(graph.transitions) ||
        order.length !== graph.transitions.length ||
        !graph.transitions.every(
          (step, index) =>
            step.node === order[index] &&
            valid(step.after) &&
            (index === 0
              ? step.before === null && step.changed === false
              : valid(step.before) &&
                same(step.before, graph.transitions[index - 1].after) &&
                step.changed === !same(step.before, step.after))
        )
      )
        return no('original_graph_unavailable');
      if (
        !valid(t?.before) ||
        !valid(t.after) ||
        t.changed === same(t.before, t.after) ||
        !same(t.after, graph.finalAction) ||
        !same(t.after, { action: w.selected.action, amount: w.selected.amount ?? null })
      )
        return no('original_graph_unavailable');
      return {
        ...item,
        opportunity,
        wagerRules: {
          before: { action: t.before.action, amount: t.before.amount },
          after: { action: t.after.action, amount: t.after.amount },
          changed: t.changed,
        },
      };
    } catch {
      return no('record_or_validator_unavailable');
    }
  });
  out.status = out.cases.every((c) => c.status === 'observed') ? 'observed' : 'unknown';
  for (let i = out.cases.length - 1; i >= 0 && Buffer.byteLength(JSON.stringify(out)) > 8192; i--) {
    out.cases[i] = { handKey: input.cases[i].handKey, status: 'unknown', reason: 'output_bound' };
    out.status = 'unknown';
  }
  return out;
}
export async function loadInstalledOriginalWagerApi(loadOriginal, loadRiver) {
  return {
    ...(await loadRiver(loadOriginal)),
    ...(await import('/app/dist/engine/HorseOmahaBigBetCalls.js')),
    ...(await import('/app/dist/engine/HorseRiverNuts.js')),
    ...(await import('/app/dist/engine/HorsePolicyGraph.js')),
  };
}
