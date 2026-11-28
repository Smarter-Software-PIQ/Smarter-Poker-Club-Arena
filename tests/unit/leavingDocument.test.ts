/**
 * A read cancelled by the page's own reload or navigation is not a failure
 * (src/lib/leavingDocument.ts, post-deploy run 46063424139).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isDocumentLeaving,
  isTransportFailure,
  wasCancelledByLeavingPage,
} from '../../src/lib/leavingDocument';

const failedToFetch = { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' };

afterEach(() => {
  window.dispatchEvent(new Event('pageshow'));
  vi.useRealTimers();
});

describe('leavingDocument', () => {
  it('is not leaving on a live page, so a transport failure is still a failure', () => {
    expect(isDocumentLeaving()).toBe(false);
    expect(wasCancelledByLeavingPage(failedToFetch)).toBe(false);
  });

  it('treats a transport failure during pagehide as the page cancelling its own read', () => {
    window.dispatchEvent(new Event('pagehide'));
    expect(wasCancelledByLeavingPage(failedToFetch)).toBe(true);
    expect(wasCancelledByLeavingPage(new TypeError('Load failed'))).toBe(true);
    expect(wasCancelledByLeavingPage(new DOMException('aborted', 'AbortError'))).toBe(true);
  });

  it('never hides a server refusal or a non-transport error', () => {
    window.dispatchEvent(new Event('pagehide'));
    expect(wasCancelledByLeavingPage({ message: 'permission denied', code: '42501' })).toBe(false);
    expect(wasCancelledByLeavingPage(new Error('agents_query_broken'))).toBe(false);
    expect(wasCancelledByLeavingPage(null)).toBe(false);
  });

  it('lets a cancelled beforeunload prompt lapse, and a bfcache restore clears pagehide', () => {
    vi.useFakeTimers();
    window.dispatchEvent(new Event('beforeunload'));
    expect(isDocumentLeaving()).toBe(true);
    vi.advanceTimersByTime(10_001);
    expect(isDocumentLeaving()).toBe(false);
    window.dispatchEvent(new Event('beforeunload'));
    window.dispatchEvent(new Event('pagehide'));
    vi.advanceTimersByTime(60_000);
    expect(isDocumentLeaving()).toBe(true);
    window.dispatchEvent(new Event('pageshow'));
    expect(isDocumentLeaving()).toBe(false);
  });

  it('recognises each browser spelling of a transport failure', () => {
    for (const message of [
      'TypeError: Failed to fetch',
      'Load failed',
      'NetworkError when attempting to fetch resource.',
      'AbortError: signal is aborted without reason',
    ]) {
      expect(isTransportFailure({ message, code: '' })).toBe(true);
    }
  });
});
