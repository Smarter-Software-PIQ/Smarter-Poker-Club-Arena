import { describe, expect, it, vi } from 'vitest';
import {
  INITIAL_MEMORY_GOVERNOR_STATE,
  JOURNAL_PRESSURE_MIN_RING_SEGMENTS,
  MEMORY_GOVERNOR_FALLBACK_HARD_MB,
  MEMORY_GOVERNOR_FALLBACK_SOFT_MB,
  MEMORY_GOVERNOR_HARD_CONSECUTIVE_SAMPLES,
  MemoryGovernor,
  journalPressureRetentionSegments,
  memoryGovernorThresholds,
  memoryPressureLevel,
  stepMemoryGovernor,
} from './memoryGovernor.js';

describe('memoryGovernorThresholds', () => {
  it('derives soft 80% and hard 95% from MEMORY_LIMIT_MB', () => {
    expect(memoryGovernorThresholds({ MEMORY_LIMIT_MB: '10000' })).toEqual({
      limitMb: 10000,
      softMb: 8000,
      hardMb: 9500,
      source: 'memory_limit_env',
    });
  });

  it('falls back to 6144 soft / 8192 hard when the limit is unset or malformed', () => {
    for (const env of [{}, { MEMORY_LIMIT_MB: '' }, { MEMORY_LIMIT_MB: 'lots' }]) {
      const t = memoryGovernorThresholds(env);
      expect(t.softMb).toBe(MEMORY_GOVERNOR_FALLBACK_SOFT_MB);
      expect(t.hardMb).toBe(MEMORY_GOVERNOR_FALLBACK_HARD_MB);
      expect(t.limitMb).toBeNull();
      expect(t.source).toBe('fallback');
    }
  });

  it('honours explicit overrides and keeps hard above soft', () => {
    const t = memoryGovernorThresholds({ MEMORY_SOFT_CEILING_MB: '7000', MEMORY_HARD_CEILING_MB: '6000' });
    expect(t.softMb).toBe(7000);
    expect(t.hardMb).toBe(7001);
    expect(t.source).toBe('explicit');
  });
});

describe('memoryPressureLevel', () => {
  const t = memoryGovernorThresholds({ MEMORY_LIMIT_MB: '10000' });
  it('classifies by the two ceilings, inclusive', () => {
    expect(memoryPressureLevel(7999, t)).toBe('normal');
    expect(memoryPressureLevel(8000, t)).toBe('soft');
    expect(memoryPressureLevel(9499, t)).toBe('soft');
    expect(memoryPressureLevel(9500, t)).toBe('hard');
  });
  it('treats an unreadable sample as normal, never as pressure', () => {
    expect(memoryPressureLevel(Number.NaN, t)).toBe('normal');
    expect(memoryPressureLevel(-1, t)).toBe('normal');
  });
});

describe('stepMemoryGovernor', () => {
  const t = memoryGovernorThresholds({ MEMORY_LIMIT_MB: '10000' });

  it('stops admitting and trims the journal over the soft ceiling', () => {
    const d = stepMemoryGovernor(INITIAL_MEMORY_GOVERNOR_STATE, 8100, t);
    expect(d.state.level).toBe('soft');
    expect(d.admitNewTables).toBe(false);
    expect(d.trimJournal).toBe(true);
    expect(d.requestHandOff).toBe(false);
  });

  it('lifts soft pressure only below the hysteresis band', () => {
    let d = stepMemoryGovernor(INITIAL_MEMORY_GOVERNOR_STATE, 8100, t);
    d = stepMemoryGovernor(d.state, 7700, t); // below soft, above 95% of it
    expect(d.state.level).toBe('soft');
    expect(d.admitNewTables).toBe(false);
    d = stepMemoryGovernor(d.state, 7500, t); // below 7600
    expect(d.state.level).toBe('normal');
    expect(d.admitNewTables).toBe(true);
    expect(d.trimJournal).toBe(false);
  });

  it('requests the hand-off exactly once, after consecutive hard samples', () => {
    let state = INITIAL_MEMORY_GOVERNOR_STATE;
    const handOffs: boolean[] = [];
    for (let i = 0; i < MEMORY_GOVERNOR_HARD_CONSECUTIVE_SAMPLES + 3; i++) {
      const d = stepMemoryGovernor(state, 9600, t);
      handOffs.push(d.requestHandOff);
      state = d.state;
    }
    expect(handOffs.filter(Boolean)).toHaveLength(1);
    expect(handOffs.indexOf(true)).toBe(MEMORY_GOVERNOR_HARD_CONSECUTIVE_SAMPLES - 1);
    expect(state.handOffRequested).toBe(true);
  });

  it('a transient hard spike resets the streak and does not hand off', () => {
    let state = INITIAL_MEMORY_GOVERNOR_STATE;
    for (const rss of [9600, 9600, 8200, 9600, 9600]) {
      const d = stepMemoryGovernor(state, rss, t);
      expect(d.requestHandOff).toBe(false);
      state = d.state;
    }
    expect(state.handOffRequested).toBe(false);
  });
});

describe('journalPressureRetentionSegments', () => {
  it('is null without pressure', () => {
    expect(journalPressureRetentionSegments('normal', 2_000_000, 237_613)).toBeNull();
  });
  it('keeps a quarter of the allocation, never below hold + working ring', () => {
    expect(journalPressureRetentionSegments('soft', 2_000_000, 0)).toBe(500_000);
    expect(journalPressureRetentionSegments('soft', 2_000_000, 600_000)).toBe(
      600_000 + JOURNAL_PRESSURE_MIN_RING_SEGMENTS
    );
    expect(journalPressureRetentionSegments('hard', 40_000, 0)).toBe(40_000);
  });
});

describe('MemoryGovernor runtime', () => {
  it('publishes its state and calls the hand-off once', () => {
    let rss = 5_000e6;
    const onHandOff = vi.fn();
    const g = new MemoryGovernor({
      sampleRssBytes: () => rss,
      onHandOff,
      env: { MEMORY_LIMIT_MB: '10000' },
      now: () => 1_000,
    });
    g.sample();
    expect(g.health()).toMatchObject({ level: 'normal', admittingNewTables: true, rssMb: 5000 });
    rss = 9_700e6;
    for (let i = 0; i < 5; i++) g.sample();
    expect(onHandOff).toHaveBeenCalledTimes(1);
    expect(g.health()).toMatchObject({
      level: 'hard',
      admittingNewTables: false,
      journalTrimRequested: true,
      handOffRequested: true,
      softCeilingMb: 8000,
      hardCeilingMb: 9500,
      softEpisodes: 1,
    });
  });

  it('a sampler that throws is an unreadable sample, not pressure', () => {
    const g = new MemoryGovernor({
      sampleRssBytes: () => {
        throw new Error('no proc');
      },
      onHandOff: vi.fn(),
      env: {},
    });
    g.sample();
    expect(g.health()).toMatchObject({ level: 'normal', rssMb: null });
  });
});
