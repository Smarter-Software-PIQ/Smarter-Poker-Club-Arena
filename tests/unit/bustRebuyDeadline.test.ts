import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUST_EPISODE_GAP_MS,
  nextBustRebuyClock,
  type BustRebuyClock,
} from '../../src/utils/bustRebuyDeadline';

const empty: BustRebuyClock = { localDeadlineAt: null, serverDeadlineAt: null };
const SERVER_BUST_DEADLINE = 1_800_000_020_000; // the engine's bust + 20 s

describe('the bust rebuy sheet keeps the engine deadline', () => {
  it('counts down what the engine says is left, from receipt', () => {
    const c = nextBustRebuyClock(
      empty,
      { remaining_ms: 20_000, deadline_at_ms: SERVER_BUST_DEADLINE },
      1_000,
      0
    );
    expect(c).toEqual({ localDeadlineAt: 21_000, serverDeadlineAt: SERVER_BUST_DEADLINE });
  });

  it('a frame sent after a slow wallet read carries less time, never a fresh 20', () => {
    // The engine judged 3.2 s after the bust: 16.8 s left, same deadline.
    const c = nextBustRebuyClock(
      empty,
      { remaining_ms: 16_800, deadline_at_ms: SERVER_BUST_DEADLINE },
      1_000,
      0
    )!;
    expect(c.localDeadlineAt).toBe(17_800);
  });

  it('a reload, reconnect or repeated frame of the same bust never pushes it back', () => {
    const first = nextBustRebuyClock(
      empty,
      { remaining_ms: 20_000, deadline_at_ms: SERVER_BUST_DEADLINE },
      1_000,
      0
    )!;
    // Resent 8 s later saying 15 s left (frame delayed): keep 21 000, not 24 000.
    const resent = nextBustRebuyClock(
      first,
      { remaining_ms: 15_000, deadline_at_ms: SERVER_BUST_DEADLINE + 3 },
      9_000,
      0
    )!;
    expect(resent.localDeadlineAt).toBe(21_000);
    // A reloaded page has no clock yet and is told what is left.
    const reloaded = nextBustRebuyClock(
      { localDeadlineAt: null, serverDeadlineAt: null },
      { remaining_ms: 12_000, deadline_at_ms: SERVER_BUST_DEADLINE },
      9_000,
      0
    )!;
    expect(reloaded.localDeadlineAt).toBe(21_000);
  });

  it('a late frame of an earlier bust neither shortens nor stretches the current one', () => {
    const later = SERVER_BUST_DEADLINE + 90_000; // the next bust, a hand later
    const current = nextBustRebuyClock(
      { localDeadlineAt: null, serverDeadlineAt: SERVER_BUST_DEADLINE },
      { remaining_ms: 20_000, deadline_at_ms: later },
      100_000,
      0
    )!;
    expect(current).toEqual({ localDeadlineAt: 120_000, serverDeadlineAt: later });
    for (const remaining of [1_000, 19_000]) {
      expect(
        nextBustRebuyClock(
          current,
          { remaining_ms: remaining, deadline_at_ms: SERVER_BUST_DEADLINE },
          101_000,
          0
        )
      ).toBeNull();
    }
  });

  it('a stale deadline left from an earlier bust is replaced by the next bust', () => {
    const c = nextBustRebuyClock(
      { localDeadlineAt: 21_000, serverDeadlineAt: SERVER_BUST_DEADLINE },
      { remaining_ms: 20_000, deadline_at_ms: SERVER_BUST_DEADLINE + BUST_EPISODE_GAP_MS + 1 },
      200_000,
      0
    )!;
    expect(c.localDeadlineAt).toBe(220_000);
  });

  it('a frame reaching a seat that has chips again changes nothing', () => {
    expect(
      nextBustRebuyClock(
        empty,
        { remaining_ms: 10_000, deadline_at_ms: SERVER_BUST_DEADLINE },
        1_000,
        150
      )
    ).toBeNull();
  });

  it('an expired or malformed frame changes nothing', () => {
    expect(nextBustRebuyClock(empty, { remaining_ms: 0 }, 1_000, 0)).toBeNull();
    expect(nextBustRebuyClock(empty, { remaining_ms: 'x' }, 1_000, 0)).toBeNull();
  });

  it('a frame from an engine that does not name the bust still only moves forward', () => {
    const a = nextBustRebuyClock(empty, { remaining_ms: 20_000 }, 1_000, 0)!;
    const b = nextBustRebuyClock(a, { remaining_ms: 20_000 }, 5_000, 0)!;
    expect(b.localDeadlineAt).toBe(21_000);
  });

  it('the table page routes every frame through this decision', () => {
    const page = readFileSync(join(process.cwd(), 'src', 'pages', 'TablePage.tsx'), 'utf8');
    expect(page).toMatch(/nextBustRebuyClock\(/);
    expect(page).not.toMatch(/Math\.min\(prev, told\)/);
  });
});
