import { describe, expect, it, vi } from 'vitest';
import {
  INITIAL_MEMORY_GOVERNOR_STATE,
  JOURNAL_PRESSURE_MIN_RING_SEGMENTS,
  MEMORY_GOVERNOR_FALLBACK_HARD_MB,
  MEMORY_GOVERNOR_FALLBACK_SOFT_MB,
  MEMORY_GOVERNOR_HARD_CONSECUTIVE_SAMPLES,
  MEMORY_GOVERNOR_DEFAULT_HANDOFF_MIN_UPTIME_S,
  MemoryGovernor,
  journalPressureRetentionSegments,
  journalPressureTrimEnabled,
  memoryGovernorPolicy,
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
    const t = memoryGovernorThresholds({
      MEMORY_SOFT_CEILING_MB: '7000',
      MEMORY_HARD_CEILING_MB: '6000',
    });
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
      env: {
        MEMORY_LIMIT_MB: '10000',
        MEMORY_GOVERNOR_MODE: 'enforce',
        MEMORY_GOVERNOR_HARD_ACTION: 'handoff',
        MEMORY_GOVERNOR_HANDOFF_MIN_UPTIME_S: '0',
      },
      now: () => 1_000,
    });
    g.sample();
    expect(g.health()).toMatchObject({ level: 'normal', admittingNewTables: true, rssMb: 5000 });
    rss = 9_700e6;
    for (let i = 0; i < 5; i++) g.sample();
    expect(onHandOff).toHaveBeenCalledTimes(1);
    expect(g.health()).toMatchObject({
      mode: 'enforce',
      hardAction: 'handoff',
      level: 'hard',
      admittingNewTables: false,
      journalTrimRequested: true,
      handOffRequested: true,
      hardCeilingReached: true,
      handOffsWithheld: 0,
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

describe('memoryGovernorPolicy (operator opt-in)', () => {
  it('is observe-only unless MEMORY_GOVERNOR_MODE=enforce', () => {
    for (const env of [{}, { MEMORY_GOVERNOR_MODE: '' }, { MEMORY_GOVERNOR_MODE: 'enforcing' }]) {
      expect(memoryGovernorPolicy(env)).toEqual({
        mode: 'observe',
        hardAction: 'alert',
        handOffMinUptimeS: MEMORY_GOVERNOR_DEFAULT_HANDOFF_MIN_UPTIME_S,
      });
    }
    expect(memoryGovernorPolicy({ MEMORY_GOVERNOR_MODE: ' Enforce ' }).mode).toBe('enforce');
    expect(memoryGovernorPolicy({ MEMORY_GOVERNOR_MODE: 'off' }).mode).toBe('off');
  });

  it('hand-off needs enforce AND MEMORY_GOVERNOR_HARD_ACTION=handoff', () => {
    expect(memoryGovernorPolicy({ MEMORY_GOVERNOR_HARD_ACTION: 'handoff' }).hardAction).toBe(
      'alert'
    );
    expect(memoryGovernorPolicy({ MEMORY_GOVERNOR_MODE: 'enforce' }).hardAction).toBe('alert');
    expect(
      memoryGovernorPolicy({
        MEMORY_GOVERNOR_MODE: 'enforce',
        MEMORY_GOVERNOR_HARD_ACTION: 'handoff',
      }).hardAction
    ).toBe('handoff');
  });

  it('parses the uptime guard, falling back to the default when malformed', () => {
    expect(
      memoryGovernorPolicy({ MEMORY_GOVERNOR_HANDOFF_MIN_UPTIME_S: '0' }).handOffMinUptimeS
    ).toBe(0);
    expect(
      memoryGovernorPolicy({ MEMORY_GOVERNOR_HANDOFF_MIN_UPTIME_S: '-5' }).handOffMinUptimeS
    ).toBe(MEMORY_GOVERNOR_DEFAULT_HANDOFF_MIN_UPTIME_S);
  });

  it('the journal writer trims only for an enforcing governor', () => {
    expect(journalPressureTrimEnabled({})).toBe(false);
    expect(journalPressureTrimEnabled({ MEMORY_GOVERNOR_MODE: 'observe' })).toBe(false);
    expect(journalPressureTrimEnabled({ MEMORY_GOVERNOR_MODE: 'enforce' })).toBe(true);
  });
});

describe('MemoryGovernor first deploy safety (2026-10-31 production RSS)', () => {
  // /health on eed06fe5: 5101 MB at 14 min after boot; 8850 MB at 81 min;
  // 9490 MB at 102 min. Steady state sits ABOVE the 8192 MB fallback hard line.
  const productionRssMb = [5101, 6000, 7000, 8000, 8850, 8900, 9000, 9100, 9300, 9490, 9490, 9490];

  it('with no env at all it only observes: never holds, trims or hands off', () => {
    let i = 0;
    const onHandOff = vi.fn();
    const onHardCeilingWithheld = vi.fn();
    const g = new MemoryGovernor({
      sampleRssBytes: () => productionRssMb[Math.min(i++, productionRssMb.length - 1)] * 1e6,
      onHandOff,
      onHardCeilingWithheld,
      env: {},
      now: () => 10_000_000,
      processStartedAt: 0,
    });
    for (let n = 0; n < 30; n++) {
      const d = g.sample();
      expect(d.admitNewTables).toBe(true);
      expect(d.trimJournal).toBe(false);
      expect(d.requestHandOff).toBe(false);
      expect(g.admitsNewTables()).toBe(true);
    }
    expect(onHandOff).not.toHaveBeenCalled();
    // Detection still happens, once per process.
    expect(onHardCeilingWithheld).toHaveBeenCalledTimes(1);
    expect(g.health()).toMatchObject({
      mode: 'observe',
      level: 'hard',
      admittingNewTables: true,
      journalTrimRequested: false,
      handOffRequested: false,
      hardCeilingReached: true,
      handOffsWithheld: 1,
      softCeilingMb: MEMORY_GOVERNOR_FALLBACK_SOFT_MB,
      hardCeilingMb: MEMORY_GOVERNOR_FALLBACK_HARD_MB,
    });
  });

  it('enforce without HARD_ACTION=handoff holds new tables but never exits', () => {
    const onHandOff = vi.fn();
    const onHardCeilingWithheld = vi.fn();
    const g = new MemoryGovernor({
      sampleRssBytes: () => 9_490e6,
      onHandOff,
      onHardCeilingWithheld,
      env: { MEMORY_GOVERNOR_MODE: 'enforce' },
      now: () => 10_000_000,
      processStartedAt: 0,
    });
    for (let n = 0; n < 10; n++) g.sample();
    expect(g.admitsNewTables()).toBe(false);
    expect(onHandOff).not.toHaveBeenCalled();
    expect(onHardCeilingWithheld).toHaveBeenCalledTimes(1);
    expect(g.health()).toMatchObject({
      mode: 'enforce',
      hardAction: 'alert',
      journalTrimRequested: true,
    });
  });

  it('the uptime guard withholds a hand-off right after boot, then lets a later streak act', () => {
    let now = 0;
    const onHandOff = vi.fn();
    const onHardCeilingWithheld = vi.fn();
    const g = new MemoryGovernor({
      sampleRssBytes: () => 9_600e6,
      onHandOff,
      onHardCeilingWithheld,
      env: {
        MEMORY_LIMIT_MB: '10000',
        MEMORY_GOVERNOR_MODE: 'enforce',
        MEMORY_GOVERNOR_HARD_ACTION: 'handoff',
        MEMORY_GOVERNOR_HANDOFF_MIN_UPTIME_S: '600',
      },
      now: () => now,
      processStartedAt: 0,
    });
    // 0..590 s: every streak is withheld; alerted once, not every streak.
    for (; now < 600_000; now += 10_000) g.sample();
    expect(onHandOff).not.toHaveBeenCalled();
    expect(onHardCeilingWithheld).toHaveBeenCalledTimes(1);
    expect(g.health().handOffsWithheld).toBeGreaterThan(1);
    // After the guard: the next full streak hands off exactly once.
    for (let n = 0; n < 10; n++, now += 10_000) g.sample();
    expect(onHandOff).toHaveBeenCalledTimes(1);
    expect(g.health().handOffRequested).toBe(true);
  });

  it('mode=off never starts a sampler', () => {
    const sampleRssBytes = vi.fn(() => 1e9);
    const g = new MemoryGovernor({
      sampleRssBytes,
      onHandOff: vi.fn(),
      env: { MEMORY_GOVERNOR_MODE: 'off' },
    });
    vi.useFakeTimers();
    try {
      g.start(10);
      vi.advanceTimersByTime(100);
      expect(sampleRssBytes).not.toHaveBeenCalled();
    } finally {
      g.stop();
      vi.useRealTimers();
    }
  });
});
