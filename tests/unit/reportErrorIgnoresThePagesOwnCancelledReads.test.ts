/**
 * A read the page's own reload cancelled is not reported, by any caller
 * (2026-11-28). #12264 taught one loader (MemberAssignAgent); the reporter now
 * decides it once for every catch block. A network loss on a page that is not
 * leaving, and any error with a server code, must still be reported.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function load() {
  vi.resetModules();
  const reporter = await import('../../src/utils/errorReporter');
  return reporter.reportError;
}

describe('reportError and the page that is leaving', () => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    window.dispatchEvent(new Event('pageshow'));
    vi.restoreAllMocks();
  });

  it('reports a transport failure while the page is staying', async () => {
    const reportError = await load();
    reportError(new TypeError('Failed to fetch'), 'Loader.read');
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('drops a transport failure that arrives while the page is leaving', async () => {
    const reportError = await load();
    window.dispatchEvent(new Event('pagehide'));
    reportError(new TypeError('Failed to fetch'), 'MemberTransactionHistory.load');
    reportError({ message: 'TypeError: Load failed', code: '' }, 'MemberStats.load');
    reportError(new DOMException('The operation was aborted.', 'AbortError'), 'Other.load');
    expect(errors).not.toHaveBeenCalled();
  });

  it('still reports a server error while the page is leaving', async () => {
    const reportError = await load();
    window.dispatchEvent(new Event('pagehide'));
    reportError({ message: 'permission denied', code: '42501' }, 'Loader.read');
    reportError(new Error('Unexpected payload'), 'Loader.parse');
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it('reports again once the page is restored from the back/forward cache', async () => {
    const reportError = await load();
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    reportError(new TypeError('Failed to fetch'), 'Loader.read');
    expect(errors).toHaveBeenCalledTimes(1);
  });
});
