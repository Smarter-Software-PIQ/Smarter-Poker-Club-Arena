import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  observeWheelWalletReaders,
  WHEEL_WALLET_CUTOVER,
} from '../../scripts/ci/wheel-wallet-lock-observation.mjs';

const source = readFileSync(`supabase/migrations/${WHEEL_WALLET_CUTOVER}`, 'utf8');
const installer = readFileSync('scripts/ci/apply-recorded-migration.mjs', 'utf8');
afterEach(() => vi.useRealTimers());

describe('wheel wallet cutover observation', () => {
  it('runs only for the exact ordinary file, before the timed transaction', () => {
    expect(installer).toContain('ordinaryTransaction && file === WHEEL_WALLET_CUTOVER');
    expect(installer.indexOf('await observeWheelWalletReaders(client, sql)')).toBeLessThan(
      installer.indexOf('const started = Date.now()')
    );
    expect(installer.indexOf('await observeWheelWalletReaders(client, sql)')).toBeGreaterThan(
      installer.indexOf('SET transaction_timeout')
    );
    const afterObservation = installer.slice(
      installer.indexOf('await observeWheelWalletReaders(client, sql)'),
      installer.indexOf('const started = Date.now()')
    );
    expect(afterObservation).not.toContain('client.query(');
    expect(afterObservation).toContain('await refusalNow()');
    expect(source.match(/IN ACCESS EXCLUSIVE MODE NOWAIT;/g)).toHaveLength(1);
  });

  it('only reads the lock catalog, returns after release, and uses the actual lock targets', async () => {
    vi.useFakeTimers();
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ holders: 3 }] })
      .mockResolvedValueOnce({ rows: [{ holders: 0 }] });
    const observation = observeWheelWalletReaders({ query }, source);
    await vi.advanceTimersByTimeAsync(125);
    await observation;
    expect(query).toHaveBeenCalledTimes(2);
    const { text, values } = query.mock.calls[0][0];
    expect(text.trim()).toMatch(/^SELECT/);
    expect(text).not.toMatch(/LOCK TABLE|UPDATE|INSERT|DELETE/);
    expect(values[0]).toHaveLength(15);
    expect(source).toContain(`LOCK TABLE ${values[0].join(', ')} IN ACCESS EXCLUSIVE MODE NOWAIT`);
  });

  it('refuses without acquiring a lock if readers persist or evidence is missing', async () => {
    vi.useFakeTimers();
    const query = vi.fn().mockResolvedValue({ rows: [{ holders: 1 }] });
    const busy = expect(observeWheelWalletReaders({ query }, source)).rejects.toThrow(
      'remained busy'
    );
    await vi.advanceTimersByTimeAsync(60000);
    await busy;
    await expect(
      observeWheelWalletReaders({ query: vi.fn().mockResolvedValue({ rows: [] }) }, source)
    ).rejects.toThrow('Unreadable');
    expect(query).toHaveBeenCalledTimes(480);
  });
});
