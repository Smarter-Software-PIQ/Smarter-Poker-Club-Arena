// Held-out qualification reads of the GitHub REST API ride out transient
// provider failures inside the step that needs them.
//
// Every job of a held-out run is unrecoverable once the run exists: a second
// dispatch is refused because the run holds the partition, and a rerun is
// refused once a cell's Execute step has started. A 5xx, a dropped connection
// or an exhausted GITHUB_TOKEN rate limit therefore used to burn the family on
// the first failed read, before a single hand was dealt.
//
// Only transient answers are waited out: a network error or timeout, any 5xx,
// a 429, or a 403 that carries a rate-limit signal. Every other answer is
// returned to the caller unchanged and keeps its existing refusal. Reads are
// GETs, so a repeated read changes nothing. Waits honour Retry-After and the
// rate-limit reset and never pass the caller's deadline; at the deadline the
// last answer (or error) is returned as it is. The TypeScript twin in
// src/benchmark/IncrementalPressureQualification.ts must classify identically
// (src/benchmark/QualificationGithubRead.test.ts runs both on one table).

/** Read budgets, measured from process start, sized inside each job's limit:
 * plan job 20 min, cell job 240 min (prepare + Execute), assemble job 30 min. */
export const QUALIFICATION_READ_BUDGET_MS = Object.freeze({
  plan: 10 * 60_000,
  cell: 75 * 60_000,
  assemble: 20 * 60_000,
});
export const QUALIFICATION_READ_MAX_BACKOFF_MS = 60_000;
export const QUALIFICATION_SECONDARY_LIMIT_WAIT_MS = 60_000;

export function qualificationReadDeadline(kind, origin = performance.timeOrigin) {
  const budget = QUALIFICATION_READ_BUDGET_MS[kind];
  if (!Number.isFinite(budget)) throw new Error('qualification_read_budget_unknown');
  return origin + budget;
}

const sleepFor = (ms) => new Promise((done) => setTimeout(done, ms));

async function transientWait(response, attempt, now) {
  const backoff = Math.min(QUALIFICATION_READ_MAX_BACKOFF_MS, 2000 * 2 ** attempt);
  if (response.status >= 500 && response.status <= 599) return backoff;
  // An absent header is not zero: Number(null) is 0, which would retry a refusal.
  const header = (name) => {
    const value = response.headers.get(name);
    return value === null || value.trim() === '' ? NaN : Number(value);
  };
  const retryAfter = header('retry-after');
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = header('x-ratelimit-reset');
  if (response.status === 429 || response.status === 403) {
    if (Number.isFinite(retryAfter) && retryAfter >= 0) return retryAfter * 1000 + 250;
    if (remaining === '0' && Number.isFinite(reset) && reset > 0)
      return Math.max(1000, reset * 1000 - now + 1000);
    if (response.status === 429) return Math.max(QUALIFICATION_SECONDARY_LIMIT_WAIT_MS, backoff);
    let text = '';
    try {
      text = await response.clone().text();
    } catch {
      text = '';
    }
    if (/rate limit|abuse detection/i.test(text))
      return Math.max(QUALIFICATION_SECONDARY_LIMIT_WAIT_MS, backoff);
  }
  return null;
}

/** Fetches `url` with `init`, waiting out transient answers until `deadline`.
 * Returns the final Response (ok or a permanent refusal) for the caller to
 * judge; rethrows the last network error if the deadline passes on one. */
export async function readGithubWithRetry(url, init, deadline, deps = {}) {
  const doFetch = deps.fetch ?? fetch,
    now = deps.now ?? Date.now,
    sleep = deps.sleep ?? sleepFor,
    log = deps.log ?? ((line) => process.stderr.write(line + '\n')),
    timeoutMs = init.timeoutMs ?? 20_000,
    label = String(url).replace(/^https:\/\/api\.github\.com/, '');
  for (let attempt = 0; ; attempt++) {
    let response, failure;
    try {
      response = await doFetch(url, {
        headers: init.headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      failure = error;
    }
    const wait = failure
      ? Math.min(QUALIFICATION_READ_MAX_BACKOFF_MS, 2000 * 2 ** attempt)
      : response.ok
        ? null
        : await transientWait(response, attempt, now());
    if (wait === null) return response;
    if (now() + wait > deadline) {
      log(`[qualification-read] ${label}: transient answer past the read deadline; not retried`);
      if (failure) throw failure;
      return response;
    }
    log(
      `[qualification-read] ${label}: transient ${failure ? 'network error' : 'HTTP ' + response.status}; retry ${attempt + 1} in ${Math.ceil(wait / 1000)}s`
    );
    await sleep(wait);
  }
}

/** Like readGithubWithRetry, and also waits out a JSON body that breaks after
 * the headers arrived (a reset or timeout mid-body, a truncated proxy body).
 * A non-OK final answer is returned with value undefined, unread, for the
 * caller's existing refusal. A body that stays unreadable past the deadline
 * rethrows its error. */
export async function readGithubJsonWithRetry(url, init, deadline, deps = {}) {
  const now = deps.now ?? Date.now,
    sleep = deps.sleep ?? sleepFor,
    log = deps.log ?? ((line) => process.stderr.write(line + '\n')),
    label = String(url).replace(/^https:\/\/api\.github\.com/, '');
  for (let attempt = 0; ; attempt++) {
    const response = await readGithubWithRetry(url, init, deadline, deps);
    if (!response.ok) return { response, value: undefined };
    try {
      return { response, value: await response.json() };
    } catch (error) {
      const wait = Math.min(QUALIFICATION_READ_MAX_BACKOFF_MS, 2000 * 2 ** attempt);
      if (now() + wait > deadline) throw error;
      log(
        `[qualification-read] ${label}: body unreadable; retry ${attempt + 1} in ${Math.ceil(wait / 1000)}s`
      );
      await sleep(wait);
    }
  }
}
