import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  withReducedTournamentGuarantee as apply,
  guaranteeTargetNameFilter,
  GUARANTEE_REDUCTION_START_MS as start,
} from './TournamentGuaranteePolicy.js';
const base = {
  name: 'Nightly 10K (NLH)',
  guaranteed_prize: 10000,
  buy_in_amount: 32,
  buy_in_fee: 3,
  start_time: new Date(start).toISOString(),
  starting_chips: 20000,
};
describe('November midnight tournament guarantee reduction', () => {
  it('halves the fresh guarantee at the Chicago cutoff and preserves all other terms', () => {
    expect(apply({ ...base, start_time: new Date(start - 1).toISOString() }).guaranteed_prize).toBe(
      10000
    );
    expect(apply(base)).toEqual({ ...base, name: 'Nightly 5K (NLH)', guaranteed_prize: 5000 });
    expect(base.guaranteed_prize).toBe(10000);
  });
  it('preserves the 200 entry 25k guarantee, but not other 200 entry amounts', () => {
    expect(
      apply({ ...base, buy_in_amount: 180, buy_in_fee: 20, guaranteed_prize: 25000 })
        .guaranteed_prize
    ).toBe(25000);
    expect(
      apply({ ...base, buy_in_amount: 180, buy_in_fee: 20, guaranteed_prize: 40000 })
        .guaranteed_prize
    ).toBe(20000);
  });
  it('halves free-entry guarantees too and leaves zero alone', () => {
    expect(
      apply({ ...base, buy_in_amount: 0, buy_in_fee: 0, guaranteed_prize: 250 }).guaranteed_prize
    ).toBe(125);
    expect(apply({ ...base, guaranteed_prize: 0 }).guaranteed_prize).toBe(0);
  });
  it('updates guarantee labels without changing entry prices or stack amounts', () => {
    const result = apply({
      ...base,
      guaranteed_prize: 5000,
      name: '40 Chip Freezeout - 5K GTD (NLH)',
      short_description: '5K GTD | 20K Stack | 8 Min Levels',
    });
    expect(result.name).toBe('40 Chip Freezeout - 2.5K GTD (NLH)');
    expect(result.short_description).toBe('2.5K GTD | 20K Stack | 8 Min Levels');
  });
  it('keeps satellites connected to original committed and reduced target names', () => {
    expect(guaranteeTargetNameFilter('40 Chip Freezeout - 5K GTD (NLH)')).toBe(
      'name.ilike."40 Chip Freezeout - 5K GTD (NLH)%",name.ilike."40 Chip Freezeout - 2.5K GTD (NLH)%"'
    );
    expect(guaranteeTargetNameFilter('Nightly 10K (NLH)')).toContain('Nightly 5K (NLH)');
    expect(guaranteeTargetNameFilter('Sunday 200 Deep Stack')).toBe(
      'name.ilike."Sunday 200 Deep Stack%"'
    );
  });
  it('applies after the fixed/weekly row builder and before Diamond pricing or admission', () => {
    const source = readFileSync(
      new URL('./ScheduledTournamentService.ts', import.meta.url),
      'utf8'
    );
    const begin = source.indexOf('private async spawnInstance(');
    const body = source.slice(begin, source.indexOf('private async spawnDiamondInstance', begin));
    expect(body.indexOf('withReducedTournamentGuarantee(')).toBeGreaterThan(
      body.indexOf('await this.buildInsertRow(')
    );
    expect(body.indexOf('withReducedTournamentGuarantee(')).toBeLessThan(
      body.indexOf('diamondSpawnConfig(')
    );
  });
});
