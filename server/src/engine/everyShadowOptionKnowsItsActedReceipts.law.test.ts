/**
 * LAW: EVERY OPTION THAT CAN BE SHADOWED KNOWS ITS ACTED RECEIPTS (2026-11-26, PLO-OWNER lead-7, lane HARDENING;
 * HorseOptionActedReceipts.optionActedReceiptGaps).
 *
 * The live shadow watch proves a shadow trial did not act on the option by finding none of the option's own receipts.
 * It knew four options' receipts by a table in the script and read every other as VERDICT=DIRTY
 * reasons=acted_leak_unchecked, so a clean trial read as dirty. Now the receipts come from the ledger (each receipt
 * entry whose consumer names the option) or a declaration in it, and an option off by release default that takes
 * shadow with neither fails the build here; the watch's table (scripts/ops/horse-option-acted-receipts.json) holds the
 * same derivation.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HORSE_DATA_LEDGER, type LedgerEntry } from './HorseDataLedger.js';
import {
  consumerNames,
  optionActedReceiptGaps,
  optionActedReceiptTable,
  optionActedReceiptsJson,
} from './HorseOptionActedReceipts.js';
import { OPTION_SWITCH_REGISTRY } from './HorseOptionSwitch.js';

const rec = (key: string, consumer: string): LedgerEntry => ({
  key,
  kind: 'receipt',
  source: 's',
  cadence: 'per_action',
  consumer,
  note: 'n',
  since: 'x',
});
const opt = (
  name: string,
  releaseDefault = 'off',
  states = ['off', 'shadow', 'on_shadow', 'on']
) => ({
  name,
  releaseDefault,
  states,
});

describe('LAW: every option that can be shadowed knows its acted receipts', () => {
  it('holds for every option the registry holds today', () => {
    expect(optionActedReceiptGaps(OPTION_SWITCH_REGISTRY)).toEqual([]);
  });

  it("the watch's table is the ledger derivation (regenerate: npx tsx scripts/gen-horse-option-acted-receipts.ts)", () => {
    const file = readFileSync(
      new URL('../../../scripts/ops/horse-option-acted-receipts.json', import.meta.url),
      'utf8'
    );
    // compared as data: the repository's formatter may lay the file out differently from JSON.stringify
    expect(JSON.parse(file)).toEqual(JSON.parse(optionActedReceiptsJson(OPTION_SWITCH_REGISTRY)));
  });

  it('the four options the script knew by hand derive the same receipts from the ledger', () => {
    const t = optionActedReceiptTable(OPTION_SWITCH_REGISTRY);
    expect(t.holdemValueAndCallsArePriced!.keys).toContain('holdem_priced_call');
    expect(t.holdemTournamentAllInCallIsPriced!.keys).toContain(
      'holdem_tournament_all_in_call_priced_fold_seen'
    );
    expect(t.cashDefenceTrimColdCalls!.keys).toEqual(['cash_defence_trim_cold_calls_seen']);
    expect(t.omahaMathCorePlo5Flop).toMatchObject({
      prefixes: ['omaha_math_core_'],
      unlessOn: ['omahaMathCore'],
    });
    // and the option whose clean shadow read as dirty on 2026-11-26
    expect(t.omahaOopReraiseRangeHoldsVsReraise!.keys).toContain(
      'omaha_oop_reraise_range_holds_folded'
    );
  });

  it('a new default-off option that takes shadow with no receipt naming it fails; a receipt or a reasoned none passes', () => {
    const registry = [...OPTION_SWITCH_REGISTRY, opt('holdemSomethingNewIsPriced')];
    expect(optionActedReceiptGaps(registry)).toEqual([
      'holdemSomethingNewIsPriced: a default-off option that takes shadow names its acted receipts (a ledger receipt whose consumer names it, or OPTION_ACTED_RECEIPTS_DECLARED)',
    ]);
    expect(
      optionActedReceiptGaps(registry, [
        ...HORSE_DATA_LEDGER,
        rec('holdem_something_new_seen', 'HorseLogic (holdemSomethingNewIsPriced)'),
      ])
    ).toEqual([]);
    expect(
      optionActedReceiptGaps([opt('aNew')], [], {
        aNew: { none: 'fires no receipt of its own: a threshold' },
      })
    ).toEqual([]);
  });

  it('a default-on or off-only option needs nothing (in shadow its receipts fire by design, or it is never shadowed)', () => {
    expect(
      optionActedReceiptGaps(
        [opt('aRule', 'on'), opt('bRule', 'code'), opt('cRule', 'off', ['off'])],
        [],
        {}
      )
    ).toEqual([]);
    expect(optionActedReceiptTable([opt('aRule', 'on')], [], {}).aRule!.source).toBe(
      'not_applicable'
    );
  });

  it('reads globs and shared receipts: a receipt naming two options is legitimate while the other is on', () => {
    expect(
      consumerNames('Wiring (holdemTournament*DefenceIsPriced / holdemCommitted)', [
        'holdemTournamentBlindDefenceIsPriced',
        'holdemTournamentHuDefenceIsPriced',
        'holdemCommitted',
        'other',
      ]).sort()
    ).toEqual([
      'holdemCommitted',
      'holdemTournamentBlindDefenceIsPriced',
      'holdemTournamentHuDefenceIsPriced',
    ]);
    const t = optionActedReceiptTable(
      [opt('aIsPriced'), opt('bIsPriced')],
      [rec('shared_seen', 'X (aIsPriced, bIsPriced)'), rec('a_family_*', 'Y (aIsPriced)')],
      {}
    );
    expect(t.aIsPriced).toMatchObject({
      source: 'ledger',
      keys: ['shared_seen'],
      prefixes: ['a_family_'],
      unlessOn: ['bIsPriced'],
    });
  });

  it('refuses a declaration for a name that is not a default-off shadow option, a bare reason, an empty or malformed prefix, an unknown unlessOn', () => {
    const gaps = optionActedReceiptGaps([opt('aIsPriced'), opt('onRule', 'on')], [], {
      aIsPriced: { prefixes: ['Bad-Prefix'], unlessOn: ['nobody'] },
      onRule: { none: 'short' },
      gone: { prefixes: [] },
    });
    expect(gaps).toEqual([
      'aIsPriced: malformed receipt prefix Bad-Prefix',
      'aIsPriced: unlessOn names an unregistered option nobody',
      'onRule: declared acted receipts but is not a registered default-off option that takes shadow',
      'onRule: the reason for no acted receipt is not a reason',
      'gone: declared acted receipts but is not a registered default-off option that takes shadow',
      'gone: declares no prefix',
    ]);
  });
});
