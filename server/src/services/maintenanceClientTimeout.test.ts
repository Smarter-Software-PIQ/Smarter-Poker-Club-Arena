import { describe, expect, it } from 'vitest';
import { resolveMaintenanceClientTimeoutMs } from './maintenanceClientTimeout.js';

describe('maintenance HTTP timeout preserves terminal SQL headroom', () => {
  it.each([
    undefined, '', ' ', 'no', 'NaN', 'Infinity', '-Infinity',
    '0', '-1', '15000', '45000', '49999', '2147483648', '1e100',
  ])(
    'uses the established 50-second budget for unsafe override %s',
    (value) => {
      expect(resolveMaintenanceClientTimeoutMs({ MAINTENANCE_SUPABASE_TIMEOUT_MS: value })).toBe(50_000);
    }
  );
  it.each(['50000', '50000.5', '60000', '2147483647'])(
    'preserves valid timer override %s',
    (value) => {
      expect(resolveMaintenanceClientTimeoutMs({ MAINTENANCE_SUPABASE_TIMEOUT_MS: value })).toBe(
        Number(value)
      );
    }
  );
});
