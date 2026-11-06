import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = (p: string) => readFileSync(p, 'utf8');
describe('felted cash seats never short buy', () => {
  it('enforces the minimum at original purchase and queued delivery, with native CI coverage', () => {
    const sql = read('supabase/migrations/20261106043954_cash_rebuys_require_the_full_minimum.sql');
    expect(sql).toContain('coalesce(t.big_blind,0)*40');
    expect(sql).toContain('IF v_applied<v_rebuy_minimum THEN v_applied:=0; END IF;');
    expect(sql.match(/BUYIN_BELOW_MINIMUM: Insufficient chips/g)).toHaveLength(2);
    expect(read('scripts/ci/test-cash-addon-receipt-postgres.py')).toContain(
      'test-cash-rebuy-minimum-postgres.py'
    );
    expect(read('src/components/table/TableModalsLayer.tsx')).not.toContain(
      'Math.min(minBuyIn, bustRebuyMaxBuyIn)'
    );
  });
});
