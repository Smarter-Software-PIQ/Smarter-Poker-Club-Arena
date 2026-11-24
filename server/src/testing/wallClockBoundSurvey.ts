// ---------------------------------------------------------------------------
// THE SURVEY BEHIND theServerSuiteAssertsNoTightWallClockBound.law.test.ts.
//
// Reads the text of one test file and returns every assertion that holds an
// UPPER bound on real elapsed time. It is text analysis, not a type checker,
// and it is deliberately narrow: it follows time only where the file itself
// shows a real clock being read and subtracted.
//
//   elapsed value   an expression that reads performance.now(), Date.now() or
//                   process.hrtime and subtracts; a name declared from,
//                   assigned or pushed one; a name declared from an elapsed
//                   value or from a call to a local function that returns one.
//   upper bound     expect(<elapsed>).toBeLessThan(B) / .toBeLessThanOrEqual(B),
//                   or expect(<elapsed> < B).toBe(true).
//
// Not reported, by construction:
//   - a test under a fake or stubbed clock (the time is not real);
//   - a bound that is itself measured (`first / 2`): that is the relative form;
//   - a quotient from measureRelativeCost: `cost.ratio` is not a clock read.
//
// What it cannot see: an elapsed value that arrives through an imported helper
// or an object field (`run.ms`). Those are out of reach of a text rule; the
// law says so rather than guessing at names.
// ---------------------------------------------------------------------------

export interface WallClockBound {
  /** 1-based line of the `expect(`. */
  line: number;
  /** The asserted subject, whitespace collapsed. */
  subject: string;
  /** The bound expression, whitespace collapsed. */
  bound: string;
  /** The bound as a number when the file states it (a literal or a same-file numeric const). */
  boundValue: number | null;
  /** `<subject> < <bound>`: the stable key an allowlist entry names. */
  key: string;
}

const CLOCK_SOURCE = String.raw`performance\.now\(\)|Date\.now\(\)|hrtime(?:\.bigint)?\(`;
const clock = (): RegExp => new RegExp(CLOCK_SOURCE, 'g');

/** A file that replaces the clock measures no real time. */
const FAKE_CLOCK =
  /\buseFakeTimers\s*\(|\bsetSystemTime\s*\(|spyOn\(\s*Date\s*,\s*'now'\s*\)|spyOn\(\s*performance\s*,\s*'now'\s*\)|\bDate\.now\s*=[^=]/;

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

function closing(src: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** True when `text` reads a real clock and subtracts. */
function readsElapsed(text: string): boolean {
  return clock().test(text) && /-/.test(text.replace(clock(), ''));
}

function mentions(text: string, names: ReadonlySet<string>): boolean {
  for (const name of names) {
    const escaped = name.replace(/\$/g, '\\$');
    if (new RegExp(`(^|[^\\w$.])${escaped}($|[^\\w$])`).test(text)) return true;
  }
  return false;
}

function numberOf(text: string, constants: ReadonlyMap<string, number>): number | null {
  const t = text.trim();
  if (/^\d[\d_]*(\.\d+)?$/.test(t)) return Number(t.replace(/_/g, ''));
  const known = constants.get(t);
  return known === undefined ? null : known;
}

export function usesAFakeClock(source: string): boolean {
  return FAKE_CLOCK.test(source);
}

/** Every `it(...)` / `test(...)` call (with `.each`, `.skip` and the like), as [start, end]. */
function testSpans(source: string): Array<[number, number]> {
  const tests: Array<[number, number]> = [];
  const testRe = /\b(?:it|test)(?:\.[A-Za-z]+)*(?:\([^()]*\))?\(/g;
  let t: RegExpExecArray | null;
  while ((t = testRe.exec(source))) {
    const open = t.index + t[0].length - 1;
    const end = closing(source, open, '(', ')');
    if (end > 0) tests.push([t.index, end]);
  }
  return tests;
}

/**
 * Where the clock is not real. A stub installed in one test says nothing about
 * the next test in the same file, so this is decided per test body:
 *   - the whole file, when a fake clock is installed outside every test body
 *     and outside every named local function (a hook, or top-level code);
 *   - one test body, when it installs one itself or calls a local function
 *     that does.
 */
function fakeClockScope(source: string): (index: number) => boolean {
  if (!usesAFakeClock(source)) return () => false;
  const spans: Array<[number, number]> = [];
  const installers = new Set<string>();
  const fnRe =
    /(?:function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)[^{;]*\{|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)[^{;=]*=>\s*(\{)?)/g;
  let fn: RegExpExecArray | null;
  while ((fn = fnRe.exec(source))) {
    const start = fn.index;
    let end: number;
    if (fn[1] !== undefined || fn[3] !== undefined) {
      end = closing(source, fn.index + fn[0].length - 1, '{', '}');
    } else {
      end = source.indexOf(';', fn.index + fn[0].length);
    }
    if (end < 0) continue;
    spans.push([start, end]);
    if (FAKE_CLOCK.test(source.slice(start, end + 1))) installers.add(fn[1] ?? fn[2]);
  }
  const tests = testSpans(source);
  const callsInstaller = (text: string): boolean =>
    [...installers].some((n) =>
      new RegExp(`(^|[^\\w$.])${n.replace(/\$/g, '\\$')}\\s*\\(`).test(text)
    );
  // Blank out test bodies and named local functions; what is left is hooks and top-level code.
  const chars = source.split('');
  for (const [a, b] of [...spans, ...tests]) for (let i = a; i <= b; i++) chars[i] = ' ';
  const rest = chars.join('');
  if (FAKE_CLOCK.test(rest) || callsInstaller(rest)) return () => true;
  const fakeTests = tests.filter(([a, b]) => {
    const body = source.slice(a, b + 1);
    return FAKE_CLOCK.test(body) || callsInstaller(body);
  });
  return (index) => fakeTests.some(([a, b]) => index >= a && index <= b);
}

export function surveyWallClockBounds(source: string): WallClockBound[] {
  if (!clock().test(source)) return [];
  const clockIsFakeAt = fakeClockScope(source);

  // Local functions that return an elapsed value.
  const timers = new Set<string>();
  const fnRe =
    /(?:function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)[^{;]*|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)[^{;=]*=>\s*)\{/g;
  let fn: RegExpExecArray | null;
  while ((fn = fnRe.exec(source))) {
    const open = fn.index + fn[0].length - 1;
    const end = closing(source, open, '{', '}');
    if (end < 0) continue;
    const body = source.slice(open, end);
    const returns = body.match(/\breturn\s+[^;]*;/g) ?? [];
    if (returns.some(readsElapsed)) timers.add(fn[1] ?? fn[2]);
  }

  // Declarations: numeric constants, and every name given a value.
  const constants = new Map<string, number>();
  const decls: Array<{ name: string; rhs: string; at: number }> = [];
  const declRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*([^;]*);/g;
  let d: RegExpExecArray | null;
  while ((d = declRe.exec(source))) {
    decls.push({ name: d[1], rhs: d[2], at: d.index });
    const n = numberOf(d[2], constants);
    if (n !== null) constants.set(d[1], n);
  }
  // Assignments and array pushes carry an elapsed value the same way.
  const assignRe = /(?:^|[;{}]\s*|\n\s*)([A-Za-z_$][\w$]*)\s*(?:=(?!=|>)|\.push\()\s*([^;]*);/g;
  while ((d = assignRe.exec(source))) decls.push({ name: d[1], rhs: d[2], at: d.index });
  const callsATimer = (rhs: string): boolean =>
    [...timers].some((t) => new RegExp(`(^|[^\\w$.])${t.replace(/\$/g, '\\$')}\\s*\\(`).test(rhs));

  // A name is followed inside the test body that gives it its value (and from
  // file level into every test), never from one test body into another: two
  // tests that both call something `elapsed` are not talking about one value.
  const tests = testSpans(source);
  const spanOf = (index: number): number => tests.findIndex(([a, b]) => index >= a && index <= b);
  const elapsedBySpan = new Map<number, Set<string>>();
  const elapsedIn = (span: number): Set<string> => {
    const known = elapsedBySpan.get(span);
    if (known) return known;
    const visible = decls.filter(({ at }) => {
      const s = spanOf(at);
      return s === -1 || s === span;
    });
    const elapsed = new Set<string>();
    for (let changed = true; changed; ) {
      changed = false;
      for (const { name, rhs } of visible) {
        if (elapsed.has(name) || timers.has(name)) continue;
        // An arrow function declared here is a function, not a value.
        if (/=>/.test(rhs)) continue;
        if (readsElapsed(rhs) || callsATimer(rhs) || mentions(rhs, elapsed)) {
          elapsed.add(name);
          changed = true;
        }
      }
    }
    elapsedBySpan.set(span, elapsed);
    return elapsed;
  };
  const isElapsedAt = (text: string, index: number): boolean =>
    readsElapsed(text) || mentions(text, elapsedIn(spanOf(index))) || callsATimer(text);

  const out: WallClockBound[] = [];
  const expectRe = /\bexpect\(/g;
  let m: RegExpExecArray | null;
  while ((m = expectRe.exec(source))) {
    const open = m.index + 'expect'.length;
    const close = closing(source, open, '(', ')');
    if (close < 0) continue;
    const inner = source.slice(open + 1, close);
    const after = source.slice(close + 1, close + 60);
    const matcher = after.match(/^\s*\.(toBeLessThan|toBeLessThanOrEqual|toBe)\(/);
    if (!matcher) continue;
    let subject: string;
    let bound: string;
    if (matcher[1] === 'toBe') {
      // expect(<elapsed> < B).toBe(true)
      if (!/^\s*\.toBe\(\s*true\s*\)/.test(after)) continue;
      const cmp = inner.match(/^([\s\S]*[^<=>-])<=?(?!=)([^<=>][\s\S]*)$/);
      if (!cmp) continue;
      subject = cmp[1];
      bound = cmp[2];
    } else {
      // The first argument only: a second one is the failure message.
      let depth = 0;
      let cut = inner.length;
      for (let i = 0; i < inner.length; i++) {
        const c = inner[i];
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
        else if (c === ',' && depth === 0) {
          cut = i;
          break;
        }
      }
      subject = inner.slice(0, cut);
      const argOpen = close + 1 + after.indexOf('(');
      const argClose = closing(source, argOpen, '(', ')');
      if (argClose < 0) continue;
      bound = source.slice(argOpen + 1, argClose);
    }
    if (!isElapsedAt(subject, m.index)) continue;
    if (clockIsFakeAt(m.index)) continue;
    // A bound that is itself measured is the relative form.
    if (isElapsedAt(bound, m.index)) continue;
    const s = squash(subject);
    const b = squash(bound);
    out.push({
      line: source.slice(0, m.index).split('\n').length,
      subject: s,
      bound: b,
      boundValue: numberOf(b, constants),
      key: `${s} < ${b}`,
    });
  }
  return out;
}
