import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SCRIPT = readFileSync(resolve(ROOT, 'scripts/ci/test-hot-path-no-history-scans.py'), 'utf8');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/promo-play-through.yml'), 'utf8');

const REQUIRED_HOT_PATH_ROOTS = [
  'fn_ca_commit_hand_settlement',
  'fn_ca_process_hand_post_commit_obligations',
  'process_tournament_rebuy',
  'fn_ca_promo_profit_credit_owned',
  'fn_ca_promo_custody_on_ledger',
  'fn_ca_promo_realize_event_principal',
  'fn_ca_promo_roll_event_principal',
  'fn_ca_promo_profit_return_entitlement_ticket',
];

describe('hot-path functions never transitively scan promo fee history', () => {
  it('inspects all required hot-path roots via a PostgreSQL pg_proc recursive call graph', () => {
    expect(SCRIPT).toContain('WITH RECURSIVE');
    expect(SCRIPT).toContain('pg_catalog.pg_proc');
    expect(SCRIPT).toContain('fn_ca_promo_shared_fee_state_live');
    expect(SCRIPT).toContain("k.fn_name LIKE 'fn_ca_commit_hand_settlement_%'");

    for (const root of REQUIRED_HOT_PATH_ROOTS) {
      expect(SCRIPT, `missing hot-path root ${root}`).toContain(`'${root}'`);
    }
  });

  it('keeps exemptions strictly bounded to table_cashout and pre-lane fn_ca_promo_fee_state_ensure', () => {
    expect(SCRIPT).toContain("NEW\\.category\\s*=\\s*''table_cashout''");
    expect(SCRIPT).toContain('fn_ca_promo_fee_state_ensure');
    expect(SCRIPT).toContain('fn_ca_share_tournament_lane_for_rebuy');
    expect(SCRIPT).toContain('ensure_last_pos');
    expect(SCRIPT).toContain('mutation self-test catches synthetic transitive settle');
  });

  it('closes the non-fn_ca_promo_ bridge blind spot across resolve_pending_addon -> fn_cash_record_funding_application (incidents 053d3341 & 515d6f24)', () => {
    expect(SCRIPT).toContain('REQUIRED_BRIDGE_FNS');
    expect(SCRIPT).toContain('"resolve_pending_addon"');
    expect(SCRIPT).toContain('"fn_cash_record_funding_application"');
    expect(SCRIPT).toContain('"fn_ca_promo_apply_pending_cash_funding"');
    expect(SCRIPT).toContain('4-hop post-commit regressions');
  });

  it('wires the PostgreSQL call-graph guard into the required promo-play-through CI workflow', () => {
    expect(WORKFLOW).toContain('scripts/ci/test-hot-path-no-history-scans.py');
    expect(WORKFLOW).toContain('tests/hot-path-never-scans-promo-history.law.test.ts');
    expect(WORKFLOW).toContain('artifacts/hot-path-no-history-scans/RESULTS.json');
  });
});
