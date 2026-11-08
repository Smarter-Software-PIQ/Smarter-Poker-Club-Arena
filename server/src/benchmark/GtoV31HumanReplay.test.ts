/**
 * V31 human replay: the matching of a recorded action to the playbook menu and
 * the aggregation into the report. The engine replay itself is the existing
 * HorseLogic.decide path; these cases pin only what this tool adds.
 */
import { describe, expect, it } from 'vitest';

import {
  gtoV31ActualFamily,
  gtoV31DemandDistance,
  gtoV31HumanCellIdentity,
  gtoV31HumanSpecIndex,
  gtoV31ModalAction,
  gtoV31SpecAmount,
  matchActualToPlaybook,
  renderGtoV31HumanReplayMarkdown,
  summarizeGtoV31HumanReplay,
  type GtoV31HumanDecision,
  type GtoV31HumanPlaybook,
} from './GtoV31HumanReplay.js';
import type { GtoV31ActionSpec } from '../engine/GtoPostflopV31.js';

const OPEN_MENU: Record<string, GtoV31ActionSpec> = {
  c: { family: 'check', size_unit: 'none', size_value: null, all_in: false },
  b33: { family: 'bet', size_unit: 'pot_fraction', size_value: 0.33, all_in: false },
  b75: { family: 'bet', size_unit: 'pot_fraction', size_value: 0.75, all_in: false },
  b999: { family: 'all_in', size_unit: 'all_in', size_value: null, all_in: true },
};
const FACING_MENU: Record<string, GtoV31ActionSpec> = {
  f: { family: 'fold', size_unit: 'none', size_value: null, all_in: false },
  c: { family: 'call', size_unit: 'none', size_value: null, all_in: false },
  b60: { family: 'raise', size_unit: 'pot_after_call_fraction', size_value: 0.6, all_in: false },
};

const openFrame = { pot: 100, currentBet: 0, toCall: 0, bigBlind: 10 };
const facingFrame = { pot: 150, currentBet: 50, toCall: 50, bigBlind: 10 };

function playbook(
  over: Partial<GtoV31HumanPlaybook> & Pick<GtoV31HumanPlaybook, 'distribution'>
): GtoV31HumanPlaybook {
  return {
    datasetId: '187815b1-3701-46c8-8514-93db3cdb6d07',
    datasetChecksum: 'a'.repeat(64),
    cell: 'cell-open',
    handKey: 'k',
    hand: 'AKs',
    nodeRole: 'cbet',
    depthBucket: 40,
    stackBb: 38,
    actions: OPEN_MENU,
    sampledActionId: 'c',
    modalActionId: gtoV31ModalAction(over.distribution),
    policyEvBb: null,
    actionEvsBb: null,
    ...openFrame,
    ...over,
  };
}

function decision(over: Partial<GtoV31HumanDecision>): GtoV31HumanDecision {
  return {
    handId: 'h1',
    ord: 10,
    createdAt: '2026-11-01T00:00:00Z',
    street: 'flop',
    seat: 3,
    mode: 'cash',
    opponentSeat: 5,
    opponentKind: 'human',
    heroReach: 1000,
    status: 'covered',
    demandCell: 'cell-open',
    actual: { action: 'check', amount: 0 },
    playbook: null,
    ...over,
  };
}

describe('V31 human replay: matching the action taken to the playbook menu', () => {
  it('prices a sized action exactly as the certified consult builds it', () => {
    expect(gtoV31SpecAmount(OPEN_MENU.b75, openFrame)).toBeCloseTo(75);
    // raise to currentBet + (pot + toCall) x fraction
    expect(gtoV31SpecAmount(FACING_MENU.b60, facingFrame)).toBeCloseTo(50 + 200 * 0.6);
    expect(gtoV31SpecAmount(OPEN_MENU.c, openFrame)).toBeNull();
  });

  it('matches a bet to the nearest size of the same family', () => {
    const pb = { actions: OPEN_MENU, ...openFrame };
    expect(matchActualToPlaybook({ action: 'bet', amount: 40 }, pb).actionId).toBe('b33');
    const big = matchActualToPlaybook({ action: 'bet', amount: 70 }, pb);
    expect(big).toMatchObject({ family: 'bet', actionId: 'b75' });
    expect(big.sizeError).toBeCloseTo(5 / 75);
    expect(matchActualToPlaybook({ action: 'check', amount: 0 }, pb)).toMatchObject({
      family: 'check',
      actionId: 'c',
      sizeError: null,
    });
  });

  it('reads an all-in that cannot raise as a call, and a shove as the menu all-in', () => {
    expect(gtoV31ActualFamily('all_in', 40, facingFrame, 40)).toBe('call');
    expect(
      matchActualToPlaybook(
        { action: 'all_in', amount: 40 },
        { actions: FACING_MENU, ...facingFrame },
        40
      )
    ).toMatchObject({ family: 'call', actionId: 'c' });
    expect(
      matchActualToPlaybook(
        { action: 'all_in', amount: 900 },
        { actions: OPEN_MENU, ...openFrame },
        900
      )
    ).toMatchObject({ family: 'all_in', actionId: 'b999' });
    // no all-in on the menu: the largest matching wager family, by real amount
    expect(
      matchActualToPlaybook(
        { action: 'all_in', amount: 900 },
        { actions: FACING_MENU, ...facingFrame },
        900
      )
    ).toMatchObject({ family: 'all_in', actionId: 'b60' });
  });

  it('reports no action id when the menu has nothing of that family', () => {
    expect(
      matchActualToPlaybook({ action: 'fold', amount: 0 }, { actions: OPEN_MENU, ...openFrame })
    ).toMatchObject({ family: 'fold', actionId: null });
  });

  it('indexes sealed menus by the same coordinates a receipt carries', () => {
    const index = gtoV31HumanSpecIndex([
      {
        street: 'flop',
        game_family: 'cash',
        objective: 'cash_ev',
        utility_context: 'cash_ev',
        table_size: 9,
        pot_type: 'srp',
        hero_position: 'BTN',
        opponent_position: 'BB',
        depth_bucket: 40,
        texture_class: 'Brud',
        node_role: 'cbet',
        facing_kind: 'none',
        facing_size_bucket: 'none',
        action_specs: OPEN_MENU,
      },
    ]);
    const id = gtoV31HumanCellIdentity({
      street: 'flop',
      family: 'cash',
      objective: 'cash_ev',
      utilityContext: 'cash_ev',
      tableSize: 9,
      potType: 'srp',
      heroPosition: 'BTN',
      opponentPosition: 'BB',
      depthBucket: 40,
      textureClass: 'Brud',
      nodeRole: 'cbet',
      facingKind: 'none',
      facingSizeBucket: 'none',
    });
    expect(index.get(id)).toBe(OPEN_MENU);
  });
});

describe('V31 human replay: aggregation', () => {
  const fixture: GtoV31HumanDecision[] = [
    // agrees: playbook mostly checks, horse checked
    decision({
      handId: 'h1',
      ord: 10,
      actual: { action: 'check', amount: 0 },
      playbook: playbook({
        distribution: { c: 0.7, b33: 0.2, b75: 0.1, b999: 0 },
        policyEvBb: 2,
        actionEvsBb: { c: 2, b33: 1.9, b75: 1.5, b999: -3 },
      }),
    }),
    // disagrees: playbook bets big, horse checked; delta = 5 - 1 = 4
    decision({
      handId: 'h2',
      ord: 12,
      actual: { action: 'check', amount: 0 },
      playbook: playbook({
        cell: 'cell-open',
        distribution: { c: 0.1, b33: 0.1, b75: 0.8, b999: 0 },
        policyEvBb: 5,
        actionEvsBb: { c: 1, b33: 3, b75: 5.5, b999: 0 },
      }),
    }),
    // same family, other size: family agrees, exact does not; delta 0.5
    decision({
      handId: 'h3',
      ord: 7,
      actual: { action: 'bet', amount: 30 },
      playbook: playbook({
        distribution: { c: 0.1, b33: 0.1, b75: 0.8, b999: 0 },
        policyEvBb: 4,
        actionEvsBb: { c: 2, b33: 3.5, b75: 4.2, b999: 0 },
      }),
    }),
    // a horse opponent: in allCovered, not in vsHuman; no EVs
    decision({
      handId: 'h4',
      ord: 9,
      opponentKind: 'horse',
      actual: { action: 'call', amount: 50 },
      playbook: playbook({
        cell: 'cell-facing',
        actions: FACING_MENU,
        ...facingFrame,
        distribution: { f: 0.6, c: 0.3, b60: 0.1 },
      }),
    }),
    decision({ handId: 'h5', status: 'cell_miss', demandCell: 'cell-x', playbook: null }),
    decision({
      handId: 'h5',
      ord: 11,
      status: 'cell_miss',
      demandCell: 'cell-x',
      opponentKind: 'horse',
      playbook: null,
    }),
    decision({ handId: 'h6', status: 'no_hole_cards', demandCell: null, playbook: null }),
    decision({
      handId: 'h7',
      status: 'not_consulted',
      opponentKind: 'multiway',
      demandCell: null,
      playbook: null,
    }),
  ];
  const report = summarizeGtoV31HumanReplay({
    decisions: fixture,
    hands: 9,
    dataset: {
      id: '187815b1-3701-46c8-8514-93db3cdb6d07',
      checksum: 'a'.repeat(64),
      cells: 2,
      state: 'evaluating',
    },
    inputs: {},
    generatedAt: '2026-11-07T00:00:00Z',
  });

  it('counts every decision by status and covered decisions by opponent', () => {
    expect(report.census).toMatchObject({
      hands: 9,
      handsWithDecisions: 7,
      decisions: 8,
      byStatus: {
        covered: 4,
        cell_miss: 2,
        no_hole_cards: 1,
        not_consulted: 1,
        out_of_scope: 0,
        replay_error: 0,
      },
      coveredByOpponent: { human: 3, horse: 1 },
    });
  });

  it('measures agreement and the playbook EV delta against people only in the headline', () => {
    expect(report.vsHuman.decisions).toBe(3);
    expect(report.vsHuman.agreeModal).toBe(2);
    expect(report.vsHuman.agreementRate).toBeCloseTo(2 / 3);
    expect(report.vsHuman.exactAgreementRate).toBeCloseTo(1 / 3);
    expect(report.vsHuman.expectedAgreement).toBeCloseTo((0.7 + 0.1 + 0.9) / 3);
    expect(report.vsHuman.evEligible).toBe(3);
    expect(report.vsHuman.evDeltaSumBb).toBeCloseTo(0 + 4 + 0.5);
    expect(report.vsHuman.confusion).toEqual({ check: { check: 1 }, bet: { check: 1, bet: 1 } });
    expect(report.allCovered.decisions).toBe(4);
    expect(report.allCovered.evEligible).toBe(3);
    expect(report.allCovered.confusion.fold).toEqual({ call: 1 });
  });

  it('breaks results down per cell and lists uncovered demand', () => {
    expect(report.perCell.map((c) => [c.cell, c.decisions, c.vsHumanDecisions])).toEqual([
      ['cell-open', 3, 3],
      ['cell-facing', 1, 0],
    ]);
    expect(report.uncoveredDemand).toEqual([{ cell: 'cell-x', decisions: 2, vsHuman: 1 }]);
  });

  it('lists the largest disagreements by EV delta with hand ids', () => {
    expect(report.largestDisagreements.map((d) => [d.handId, d.ord, d.evDeltaBb])).toEqual([
      ['h2', 12, 4],
      ['h3', 7, 0.5],
    ]);
    expect(report.largestDisagreements[0]).toMatchObject({
      actualActionId: 'c',
      playbookModal: 'b75',
    });
  });

  it('renders a short markdown report with the headline and caveats', () => {
    const md = renderGtoV31HumanReplayMarkdown(report);
    expect(md).toContain('| vs a person (heads-up) | 3 | 3 | 66.7% | 33.3% |');
    expect(md).toContain('h2 | 12');
    expect(md).toContain('Measurement only');
    expect(md).not.toMatch(/—/);
  });

  it('measures how far each consult was from the cell set', () => {
    const cell = 'flop|cash|cash_ev|cash_ev|9|srp|BTN|BB|40|Brud|cbet|none|none';
    expect(
      gtoV31DemandDistance(
        [
          cell,
          cell.replace('Brud', 'Mtud'),
          cell.replace('|40|', '|80|'),
          cell.replace('|40|Brud|', '|80|Mtud|'),
          cell.replace('|9|', '|6|'),
        ],
        [cell]
      )
    ).toEqual({
      consults: 5,
      exactCell: 1,
      textureOnly: 1,
      depthOnly: 1,
      textureAndDepth: 1,
      other: 1,
    });
    expect(report.demandDistance).toBeNull();
  });
});
