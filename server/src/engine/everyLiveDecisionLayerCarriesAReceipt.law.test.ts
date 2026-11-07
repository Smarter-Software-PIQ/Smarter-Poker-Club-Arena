/**
 * LAW: EVERY LIVE DECISION LAYER CARRIES A RECEIPT (2026-11-05)
 *
 * Dan requires proof that every built horse layer is activated and used on
 * live hands. The two-week inventory found layers that run on the decision
 * path but emit no telemetry receipt, so their use could not be counted.
 * This law pins each of those layers to a receipt feature that is
 *
 *   1. registered in HorseDataLedger (so the daily audit judges its silence),
 *   2. fired with noteFire(...) in the module where the layer acts, and
 *   3. listed in scripts/horse-measure/sql/activation.sql (so the release
 *      kit and the daily scorecard count it).
 *
 * A layer that loses its receipt, or a receipt that loses its counter, fails
 * here before it can go dark in production.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ledgerReceiptFor } from './HorseDataLedger.js';

const SRC = join(process.cwd(), 'src');
const ROOT = join(process.cwd(), '..');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/** Layer, the module that fires its receipt, and the receipt names. */
const LAYER_RECEIPTS: Array<{ layer: string; file: string; receipts: string[] }> = [
  {
    layer: 'river nuts always raise and bet full (#7780, #7788)',
    file: 'engine/HorseLogic.ts',
    receipts: [
      'river_nuts_wager',
      'river_nuts_wager_already_full',
      'river_nuts_wager_superseded',
      'near_pot_wager_full_pot',
    ],
  },
  {
    layer: 'Omaha implied credit needs a draw (#7876)',
    file: 'engine/HorseLogic.ts',
    receipts: ['omaha_implied_credit_draw', 'omaha_implied_credit_withheld'],
  },
  {
    layer: 'Omaha draw blockers (#8220)',
    file: 'engine/HorseLogic.ts',
    receipts: ['omaha_board_blocked_nut_draw'],
  },
  {
    layer: 'PLO8 low-draw and counterfeit outlook (#9351)',
    file: 'engine/HorseLogic.ts',
    receipts: ['plo8_low_outlook_read', 'plo8_low_outlook_considered'],
  },
  {
    layer: 'closed-table hand memory release (#9351)',
    file: 'engine/ServerTableEngineBase.ts',
    receipts: ['closed_table_hand_memory_released'],
  },
  {
    layer: 'exploit hydrator boot replay (#7734)',
    file: 'services/HorseExploitHydrator.ts',
    receipts: [
      'exploit_hydrator_boot_replayed',
      'exploit_hydrator_boot_replayed_empty',
      'exploit_hydrator_boot_replay_read_stopped',
    ],
  },
  {
    layer: 'reads bound to the current wager (#8847)',
    file: 'engine/HorseLogic.ts',
    receipts: [
      'wager_bound_opponent_read',
      'wager_bound_opponent_read_past_short_all_in',
      'wager_bound_pressure_read',
    ],
  },
  {
    layer: 'Lightning fast fold with human reaction time (#7958, #7993)',
    file: 'lightning/LightningHandHost.ts',
    receipts: ['lightning_horse_fast_fold', 'lightning_horse_fast_fold_considered'],
  },
  {
    layer: 'river caller showdown read, learning side (#8160, #8214)',
    file: 'engine/HorseMind.ts',
    receipts: ['river_call_showdown_learned'],
  },
  {
    layer: 'river caller showdown read, decision side (#8160, #8214)',
    file: 'engine/HorseLogic.ts',
    receipts: ['river_call_light_read', 'river_call_light_read_considered'],
  },
  {
    layer: 'conditional river opportunity counters (#8386)',
    file: 'engine/HorseMind.ts',
    receipts: ['river_last_to_act_counted'],
  },
  {
    layer: 'range reads (#8563)',
    file: 'engine/HorseMind.ts',
    receipts: ['range_read_big_bet_counted', 'range_read_capped_all_in_not_big_bet'],
  },
  {
    layer: 'heads-up cash matched commitment (#8464)',
    file: 'engine/HorseLogic.ts',
    receipts: [
      'hu_cash_matched_commitment',
      'hu_cash_matched_commitment_covered',
      'hu_cash_matched_commitment_wager',
    ],
  },
  {
    layer: 'Lightning original hand binding (#8065)',
    file: 'lightning/LightningHorse.ts',
    receipts: ['lightning_original_hand_bound', 'lightning_original_hand_unbound'],
  },
  {
    layer: 'worker memory and history retention bounds (#9387 family)',
    file: 'engine/horseDecision/ownPublicHistory.ts',
    receipts: ['horse_history_cache_entry_bound_evicted', 'horse_history_retention_refused'],
  },
  {
    layer: 'exact public-memory read on completed hands (#9693)',
    file: 'services/HorseExactOpponentMemory.ts',
    receipts: [
      'horse_exact_memory_read_ok',
      'horse_exact_memory_read_failed',
      'horse_exact_memory_read_timeout',
      'horse_exact_memory_read_busy',
      'horse_exact_memory_read_invalid',
    ],
  },
  {
    layer: 'V60 cash pressure (#8694)',
    file: 'engine/HorseLogic.ts',
    receipts: [
      'v60_cash_pressure_facing_open',
      'v60_cash_pressure_facing_open_superseded',
      'v60_cash_pressure_opener_vs_three_bet',
    ],
  },
];

describe('LAW: every live decision layer carries a receipt', () => {
  const activation = readFileSync(
    join(ROOT, 'scripts', 'horse-measure', 'sql', 'activation.sql'),
    'utf8'
  );

  for (const { layer, file, receipts } of LAYER_RECEIPTS) {
    it(`${layer}: its receipts are registered, fired where the layer acts, and counted`, () => {
      const source = read(file);
      for (const key of receipts) {
        const entry = ledgerReceiptFor(key);
        expect(entry, `${key} is not a registered receipt`).toBeTruthy();
        expect(entry!.key, `${key} must be an exact receipt, not a family`).toBe(key);
        expect(entry!.cadence, `${key} must not be retired`).not.toBe('legacy_unused');
        expect(source, `${file} does not fire ${key}`).toContain(`noteFire('${key}')`);
        expect(activation, `activation.sql does not count ${key}`).toContain(`('${key}', '`);
      }
    });
  }

  it('the inventory list is complete: every layer named by the owner is here', () => {
    const named = [
      '#7780',
      '#7788',
      '#7876',
      '#8220',
      '#9351',
      '#7734',
      '#8847',
      '#7958',
      '#7993',
      '#8160',
      '#8214',
      '#8386',
      '#8563',
      '#8464',
      '#8065',
      '#9387',
      '#8694',
      '#9693',
    ];
    const layers = LAYER_RECEIPTS.map((l) => l.layer).join(' ');
    for (const pr of named) expect(layers, `${pr} has no receipt line`).toContain(pr);
  });
});
