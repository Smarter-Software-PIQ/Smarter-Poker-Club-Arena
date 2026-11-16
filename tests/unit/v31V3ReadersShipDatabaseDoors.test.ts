import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
// @ts-expect-error untyped CI module
import { createdFunctions } from '../../scripts/ci/window-migration-doors.mjs';

it('ships both v3 loader readers as real migration declarations', () => {
  const sql = readFileSync(
    'supabase/migrations/20261115143957_v31_runtime_cells_store_cell_contract_v3_dormant.sql',
    'utf8'
  );
  const names = createdFunctions(sql);
  for (const name of ['fn_gto_v31_active_cells_v3', 'fn_gto_v31_evaluation_cells_v3']) {
    expect(names.has(name), name).toBe(true);
  }
});
