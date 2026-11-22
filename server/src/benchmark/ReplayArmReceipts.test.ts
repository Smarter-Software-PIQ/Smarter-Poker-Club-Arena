import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '../engine/HorseDataLedger.js';
import {
  REPLAY_RECEIPT_FAMILIES,
  consumerOptionNames,
  ledgerReceiptsOfOption,
  replayReceiptKeep,
} from './ReplayArmReceipts.js';

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'scripts',
  'audited-node-option-replay.ts'
);

describe('a node replay keeps the receipts the ledger gives the option under test', () => {
  it('omahaHiLoTournamentFirstIn keeps omaha_hilo_tournament_first_in (scored as "(no receipt)" before)', () => {
    // The defect: no earlier family matched this key, so the scorer line had no receipt for the option.
    expect(REPLAY_RECEIPT_FAMILIES.test('omaha_hilo_tournament_first_in')).toBe(false);
    expect(ledgerReceiptsOfOption('omahaHiLoTournamentFirstIn').map((e) => e.key)).toContain(
      'omaha_hilo_tournament_first_in'
    );
    const { keep, unattributed } = replayReceiptKeep(['omahaHiLoTournamentFirstIn']);
    expect(keep('omaha_hilo_tournament_first_in')).toBe(true);
    expect(unattributed).toEqual([]);
  });

  it('keeps the earlier families, so rows already scored with them score the same', () => {
    const { keep } = replayReceiptKeep([]);
    for (const k of [
      'hu_bb_defends_unread_to_price',
      'omaha_small_bet_floor_size_priced_kept',
      'holdem_x',
    ])
      expect(keep(k)).toBe(true);
    expect(keep('omaha_hilo_tournament_first_in')).toBe(false);
    expect(keep('nash_call_vs_jam')).toBe(false);
  });

  it('reads the option names in a consumer parenthesis, and only there', () => {
    expect(consumerOptionNames('HorsePreflop via HorseLogic (huBbDefendsToPrice)')).toEqual([
      'huBbDefendsToPrice',
    ]);
    expect(consumerOptionNames('HorsePreflop (V72)')).toEqual(['V72']);
    expect(consumerOptionNames('HorseLogic.decide')).toEqual([]);
    expect(replayReceiptKeep(['nashCallVsJam']).keep('nash_call_vs_jam')).toBe(true);
  });

  it('a prefix family entry covers its keys; an option with no ledger receipt is reported', () => {
    const ledger: LedgerEntry[] = [
      {
        key: 'fam_*',
        kind: 'receipt',
        source: 's',
        cadence: 'per_action',
        consumer: 'HorseLogic (famOption)',
        note: '',
        since: 'T',
      },
    ];
    const r = replayReceiptKeep(['famOption', 'ghostOption'], ledger);
    expect(r.keep('fam_a')).toBe(true);
    expect(r.keep('other_a')).toBe(false);
    expect(r.unattributed).toEqual(['ghostOption']);
  });

  it('v72DefenceByOpener and other audited authority options resolve their ledger receipts', () => {
    // Regression: v72_defend_vs_opener previously named only "(V72)" in its ledger consumer,
    // so replaying v72DefenceByOpener reported it unattributed and dropped its receipt.
    expect(REPLAY_RECEIPT_FAMILIES.test('v72_defend_vs_opener')).toBe(false);
    expect(ledgerReceiptsOfOption('v72DefenceByOpener').map((e) => e.key)).toContain(
      'v72_defend_vs_opener'
    );
    const v72 = replayReceiptKeep(['v72DefenceByOpener']);
    expect(v72.keep('v72_defend_vs_opener')).toBe(true);
    expect(v72.unattributed).toEqual([]);

    const auditedCases: ReadonlyArray<readonly [string, string]> = [
      ['omahaSmallBlindSteal', 'omaha_full_table_sb_steal'],
      ['omahaNutClassValueSize', 'omaha_nut_class_pot_wager'],
      ['omahaNutClassValueSize', 'omaha_public_bet_size_nut_class_kept'],
      ['omahaPreflopReraiseDefencePricedInPosition', 'omaha_preflop_reraise_defence_call'],
      ['omahaPreflopReraiseDefencePricedInPosition', 'omaha_preflop_reraise_defence_changed'],
      ['omahaReraisedPositionInLightning', 'omaha_reraised_call_priced_call'],
      ['omahaFacingBetEvShownField', 'omaha_facing_bet_ev_call'],
      ['omahaFacingBetValueIsRangeRelative', 'omaha_facing_bet_ev_call'],
      ['omahaPairedBoardRiverIsPriced', 'omaha_facing_bet_ev_call'],
      ['omahaRiverBluffCatchIsPriced', 'omaha_facing_bet_ev_call'],
      ['omahaTurnCallRealizationByRunout', 'omaha_facing_bet_ev_call'],
      ['omahaMathCore', 'v44_declined_math_core_owned'],
      ['omahaMathCore', 'lightning_fold_through_math_core_owned'],
      ['omahaMathCore', 'omaha_math_core_refused_choice_priced_call'],
      ['omahaRiverNutBlockerBluffReachable', 'v86_river_nut_blocker_bluff'],
    ];
    for (const [option, receiptKey] of auditedCases) {
      const r = replayReceiptKeep([option]);
      expect(r.unattributed, option).toEqual([]);
      expect(r.keep(receiptKey), `${option} -> ${receiptKey}`).toBe(true);
    }
  });

  it('the replay script filters through it, not a hand-kept pattern', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).toContain('replayReceiptKeep(');
    expect(src).toContain('.filter(receiptKeep.keep)');
    expect(src).not.toMatch(/\/priced\|value_share/);
  });
});
