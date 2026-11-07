import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { copyToClipboard } from '../../src/lib/copyToClipboard';

/*
 * Measured on the live Share Hand popup (2026-11-06): the Clipboard API was
 * present but refused ("Write permission denied"), so Copy Link did nothing.
 * The fallback ran only when the API was missing.
 */
const setClipboard = (writeText: ((t: string) => Promise<void>) | undefined) =>
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
const setExec = (result: boolean | 'throw') =>
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn(() => {
      if (result === 'throw') throw new Error('unsupported');
      return result;
    }),
  });

afterEach(() => {
  setClipboard(undefined);
  document.body.innerHTML = '';
});

describe('copyToClipboard', () => {
  it('uses the Clipboard API when it is allowed', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    setExec(false);
    await expect(copyToClipboard('https://smarter.poker/h/AbCdEfGh')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://smarter.poker/h/AbCdEfGh');
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('falls back to a selection copy when the Clipboard API is refused', async () => {
    setClipboard(() => Promise.reject(new DOMException('Write permission denied', 'NotAllowedError')));
    setExec(true);
    await expect(copyToClipboard('link')).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('falls back when the Clipboard API is missing', async () => {
    setClipboard(undefined);
    setExec(true);
    await expect(copyToClipboard('link')).resolves.toBe(true);
  });

  it('answers false when nothing could copy, so nothing is counted as sent', async () => {
    setClipboard(() => Promise.reject(new Error('denied')));
    setExec(false);
    await expect(copyToClipboard('link')).resolves.toBe(false);
    setExec('throw');
    await expect(copyToClipboard('link')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
    await expect(copyToClipboard('')).resolves.toBe(false);
  });

  it('both Copy Link buttons go through it and only a real copy counts as sent', () => {
    const share = readFileSync('src/components/table/ShareHand.tsx', 'utf8');
    expect(share).toContain('if (await copyToClipboard(shareUrl)) {');
    expect(share).not.toContain('await navigator.clipboard.writeText(shareUrl)');
    const modal = readFileSync('src/components/table/HandDetailModal.tsx', 'utf8');
    expect(modal).toContain('const ok = await copyToClipboard(text);');
    expect(modal).not.toContain('if (link === shortLink.url) shortLink.markSent();');
  });
});
