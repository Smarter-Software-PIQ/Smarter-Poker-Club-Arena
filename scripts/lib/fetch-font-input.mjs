/**
 * A DROPPED FONT DOWNLOAD IS RETRIED, A WRONG ONE IS REFUSED (2026-11-07).
 *
 * `self-host-fonts.mjs` must fetch Google's css2 stylesheet and every woff2 it
 * names in every build, because the origin requires dist/fonts/fonts.css in
 * every release (see that script). It used one bare fetch() per file, with no
 * timeout and no second attempt. Publish run 42418194250 (commit 8bc49c9,
 * 2026-11-07 21:59 UTC) lost its whole release to one transient
 * "fetch failed" from Google, and a hung connection would have held the build
 * job until GitHub killed it.
 *
 * Every fetch now has a timeout and up to FONT_FETCH_ATTEMPTS attempts with a
 * bounded backoff. Only a transient answer is retried: a network error, a
 * timeout, a 408/429/5xx, or a body that arrived cut short or malformed. A
 * definite refusal (any other 4xx, or a redirect) fails at once, because
 * asking again cannot change it. Nothing is ever shipped unverified: the
 * stylesheet must contain @font-face rules, each font must carry the woff2
 * signature ("wOF2"), and an uncompressed body must be exactly as long as the
 * server said. The receipt still records each file's sha256 and byte count
 * (client-runtime-font-inputs.json), which retention re-verifies against
 * Google byte for byte.
 *
 * Why not commit the fonts to the repository instead: the sealed runtime
 * receipt is defined as Google's own bytes at their own URLs and retention
 * re-fetches them to prove the bundle is reproducible
 * (scripts/ci/client-runtime-font-inputs.mjs verifyFontInputs). A vendored
 * snapshot would drift from Google the day Google ships a new font version,
 * and every later retention proof would then fail. A bounded retry keeps that
 * contract and removes the single-fetch failure.
 */

export const FONT_FETCH_ATTEMPTS = 4;
export const FONT_FETCH_TIMEOUT_MS = 20_000;
/** Waits between attempts: 2 s, 5 s, 10 s; at most 17 s of waiting in all. */
export const FONT_FETCH_BACKOFF_MS = Object.freeze([2_000, 5_000, 10_000]);

class DefiniteFontRefusal extends Error {}

const WOFF2_SIGNATURE = Buffer.from('wOF2', 'latin1');

/** Throws (retryably) when a downloaded body is not what the build needs. */
export function checkFontBody(kind, buf, response) {
  if (buf.length === 0) throw new Error('empty body');
  const encoding = response.headers?.get?.('content-encoding');
  const declared = response.headers?.get?.('content-length');
  if (!encoding && declared !== null && declared !== undefined && declared !== '') {
    const want = Number(declared);
    if (Number.isSafeInteger(want) && want !== buf.length)
      throw new Error(`truncated body: ${buf.length} of ${want} bytes`);
  }
  if (kind === 'css' && !buf.toString('utf8').includes('@font-face'))
    throw new Error('stylesheet has no @font-face rule');
  if (kind === 'woff2' && !buf.subarray(0, 4).equals(WOFF2_SIGNATURE))
    throw new Error('font is not a woff2 file');
}

/**
 * Fetch one font input with a timeout, verify it, and retry only what a retry
 * can fix. Resolves to the verified bytes; rejects with a message naming the
 * URL and how many attempts were made.
 */
export async function fetchFontInput(
  url,
  {
    kind,
    userAgent,
    fetcher = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = (line) => console.warn(line),
    attempts = FONT_FETCH_ATTEMPTS,
    timeoutMs = FONT_FETCH_TIMEOUT_MS,
  }
) {
  if (kind !== 'css' && kind !== 'woff2') throw new Error(`unknown font input kind ${kind}`);
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetcher(url, {
        headers: { 'User-Agent': userAgent },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const status = response.status;
      if (!response.ok) {
        if (status === 408 || status === 429 || status >= 500) throw new Error(`HTTP ${status}`);
        throw new DefiniteFontRefusal(`HTTP ${status}`);
      }
      const buf = Buffer.from(await response.arrayBuffer());
      checkFontBody(kind, buf, response);
      if (attempt > 1) log(`[self-host-fonts] ${url} succeeded on attempt ${attempt}`);
      return buf;
    } catch (error) {
      last = error;
      if (error instanceof DefiniteFontRefusal) break;
      if (attempt < attempts) {
        const wait = FONT_FETCH_BACKOFF_MS[Math.min(attempt - 1, FONT_FETCH_BACKOFF_MS.length - 1)];
        log(
          `[self-host-fonts] attempt ${attempt} of ${attempts} for ${url} failed ` +
            `(${error?.message || error}); retrying in ${wait / 1000}s`
        );
        await sleep(wait);
      }
    }
  }
  const tried = last instanceof DefiniteFontRefusal ? 'refused' : `failed ${attempts} times`;
  throw new Error(`${kind} fetch ${tried}: ${last?.message || last} ${url}`);
}
