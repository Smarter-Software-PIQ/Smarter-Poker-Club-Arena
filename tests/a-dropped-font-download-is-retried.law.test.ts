import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error - plain .mjs build helper without types
import * as lib from '../scripts/lib/fetch-font-input.mjs';

// 2026-11-07: Publish run 42418194250 (commit 8bc49c9) lost its release to one
// transient "fetch failed" from Google Fonts in scripts/self-host-fonts.mjs.
// Every font input is now timed, verified and retried when transient.
const { fetchFontInput, FONT_FETCH_ATTEMPTS, FONT_FETCH_BACKOFF_MS, FONT_FETCH_TIMEOUT_MS } =
  lib as {
    fetchFontInput: (url: string, opts: Record<string, unknown>) => Promise<Buffer>;
    FONT_FETCH_ATTEMPTS: number;
    FONT_FETCH_BACKOFF_MS: readonly number[];
    FONT_FETCH_TIMEOUT_MS: number;
  };

const WOFF2 = Buffer.concat([Buffer.from('wOF2', 'latin1'), Buffer.alloc(60, 7)]);
const CSS = Buffer.from(
  '@font-face { font-family: Inter; src: url(https://fonts.gstatic.com/s/x.woff2) }'
);
const URL_ = 'https://fonts.gstatic.com/s/inter/v19/x.woff2';

function reply(body: Buffer, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
  };
}

function run(kind: 'css' | 'woff2', answers: Array<() => unknown>) {
  const fetcher = vi.fn(async () => {
    const next = answers.shift();
    if (!next) throw new Error('test ran out of answers');
    return next();
  });
  const sleep = vi.fn(async () => undefined);
  const log = vi.fn();
  const done = fetchFontInput(URL_, { kind, userAgent: 'UA', fetcher, sleep, log });
  return { done, fetcher, sleep, log };
}

describe('a dropped font download is retried, a wrong one is refused', () => {
  it('a network drop is retried with the bounded backoff, then the verified bytes ship', async () => {
    const drop = () => {
      throw new TypeError('fetch failed');
    };
    const { done, fetcher, sleep } = run('woff2', [drop, drop, () => reply(WOFF2)]);
    expect((await done).equals(WOFF2)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2_000, 5_000]);
    const init = fetcher.mock.calls[0][1] as unknown as RequestInit;
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('a server error or rate limit is retried, but never more than the bound', async () => {
    const busy = () => reply(Buffer.from('busy'), 503);
    const { done, fetcher, sleep } = run('woff2', [busy, busy, busy, busy, busy]);
    await expect(done).rejects.toThrow(`woff2 fetch failed ${FONT_FETCH_ATTEMPTS} times: HTTP 503`);
    expect(fetcher).toHaveBeenCalledTimes(FONT_FETCH_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(FONT_FETCH_ATTEMPTS - 1);
    const limited = run('css', [() => reply(Buffer.from(''), 429), () => reply(CSS)]);
    expect((await limited.done).equals(CSS)).toBe(true);
  });

  it('a definite refusal fails at once: asking again cannot change a 404', async () => {
    const { done, fetcher, sleep } = run('woff2', [() => reply(Buffer.from('gone'), 404)]);
    await expect(done).rejects.toThrow('woff2 fetch refused: HTTP 404');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('a wrong or cut-short body never ships, and is fetched again', async () => {
    const html = () => reply(Buffer.from('<html>captive portal</html>'));
    const short = () =>
      reply(WOFF2.subarray(0, 20), 200, { 'content-length': String(WOFF2.length) });
    const { done, fetcher } = run('woff2', [html, short, () => reply(WOFF2)]);
    expect((await done).equals(WOFF2)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const nofaces = run('css', [
      () => reply(Buffer.from('body{}')),
      () => reply(Buffer.from('body{}')),
      () => reply(Buffer.from('body{}')),
      () => reply(Buffer.from('body{}')),
    ]);
    await expect(nofaces.done).rejects.toThrow('stylesheet has no @font-face rule');
  });

  it('a compressed body is not measured against its compressed length', async () => {
    const gz = () => reply(WOFF2, 200, { 'content-length': '12', 'content-encoding': 'gzip' });
    expect((await run('woff2', [gz]).done).equals(WOFF2)).toBe(true);
  });

  it('the whole wait is bounded', () => {
    expect(FONT_FETCH_ATTEMPTS).toBeLessThanOrEqual(5);
    const waits = FONT_FETCH_BACKOFF_MS.reduce((a, b) => a + b, 0);
    // Worst case per file: every attempt times out, plus every wait.
    expect(FONT_FETCH_ATTEMPTS * FONT_FETCH_TIMEOUT_MS + waits).toBeLessThanOrEqual(120_000);
  });

  it('the font step fetches every input through it, never a bare fetch', () => {
    const step = readFileSync('scripts/self-host-fonts.mjs', 'utf8');
    expect(step).toContain("import { fetchFontInput } from './lib/fetch-font-input.mjs';");
    expect(step).toContain("fetchFontInput(cssUrl, { kind: 'css', userAgent: UA })");
    expect(step).toContain("fetchFontInput(url, { kind: 'woff2', userAgent: UA })");
    expect(step).not.toMatch(/\bawait fetch\(/);
  });
});
