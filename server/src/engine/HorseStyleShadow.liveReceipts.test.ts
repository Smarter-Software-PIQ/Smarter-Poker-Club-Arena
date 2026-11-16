/**
 * LIVE ENGAGEMENT RECEIPTS (2026-11-15): an option that is ON records that it engaged where its adjustment applied,
 * and the engagement receipt names Lightning apart from Classic cash. Telemetry only: nothing re-decides because of
 * an ON option (the live counterfactual is Hold'em Strategy's R1), and the shadow receipt keeps its c|t format.
 *
 * Part 1 pins the format and key encoding. Part 2 runs the pinned style contexts through the real brain: an ON
 * option records an engagement wherever its applied receipt fires, a shadow or off option records none in the live
 * record, and the live record is never read by the decision.
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_SPOTS,
  VILLAINS,
  decide,
  install,
  type Mode,
} from './HorseOpponentStyle.contexts.test-support.js';
import { STYLE_SWITCH_OPTIONS, type StyleSwitchOption } from './HorseStyleSwitch.js';
import {
  clearStyleShadowEngaged,
  noteStyleEngaged,
  noteStyleShadowEngaged,
  styleReceiptFormat,
  styleReceiptFormatCode,
  styleShadowAggregateKey,
  styleShadowOptionCode,
  takeStyleLiveEngaged,
  takeStyleShadowEngaged,
} from './HorseStyleShadow.js';

describe('live style engagement receipts: key encoding', () => {
  it('format: tournament first, then Lightning speed, else Classic cash', () => {
    expect(styleReceiptFormat({ gameMode: 'cash' })).toBe('cash');
    expect(
      styleReceiptFormat({
        gameMode: 'cash',
        publicMemoryDomain: { speed: 'table' },
      })
    ).toBe('cash');
    expect(
      styleReceiptFormat({
        gameMode: 'cash',
        publicMemoryDomain: { speed: 'lightning' },
      })
    ).toBe('lightning');
    expect(styleReceiptFormat({ gameMode: 'cash', publicMemoryDomain: null })).toBe('cash');
    expect(styleReceiptFormat({ gameMode: 'tournament' })).toBe('tournament');
    expect(styleReceiptFormat({ gameMode: 'cash', tournament: { id: 't' } })).toBe('tournament');
    expect(
      styleReceiptFormat({ gameMode: 'tournament', publicMemoryDomain: { speed: 'lightning' } })
    ).toBe('tournament');
    expect(styleReceiptFormatCode('cash')).toBe('c');
    expect(styleReceiptFormatCode('tournament')).toBe('t');
    expect(styleReceiptFormatCode('lightning')).toBe('l');
  });

  it('the engagement key set is fixed: 7 options x 3 formats = 21 keys', () => {
    const keys = new Set<string>();
    for (const option of STYLE_SWITCH_OPTIONS)
      for (const format of ['cash', 'tournament', 'lightning'] as const)
        keys.add(
          `style_engaged_${styleShadowOptionCode(option)}_${styleReceiptFormatCode(format)}_seen`
        );
    expect(keys.size).toBe(21);
    for (const k of keys) expect(k).toMatch(/^style_engaged_(vb|bb|rr|tr|fr|ve|fb)_[ctl]_seen$/);
  });

  it('the shadow receipt is unchanged: format c|t and arm s|c only', () => {
    const base = {
      option: 'styleFoldBluff' as const,
      variant: 'nlh',
      street: 'river',
      actualAction: 'bet',
      wouldBeAction: 'check',
    };
    expect(styleShadowAggregateKey({ ...base, format: 'cash', arm: 'shadow' })).toBe(
      'style_shadow.fb.c.nlh.r.b.k.s_seen'
    );
    expect(styleShadowAggregateKey({ ...base, format: 'tournament', arm: 'canary' })).toBe(
      'style_shadow.fb.t.nlh.r.b.k.c_seen'
    );
  });

  it('the live and shadow records are separate, bounded per option, and both cleared together', () => {
    clearStyleShadowEngaged();
    noteStyleEngaged('styleFoldBluff', 0.4, 'on');
    noteStyleEngaged('styleFoldBluff', 0.9, 'on');
    noteStyleEngaged('styleRaiseRespect', 7, 'on');
    noteStyleEngaged('styleValueExtraction', 0.5, 'shadow');
    noteStyleShadowEngaged('styleBigBetHonesty', 0.3);
    expect(takeStyleLiveEngaged()).toEqual([
      { option: 'styleFoldBluff', confidence: 0.4 },
      { option: 'styleRaiseRespect', confidence: 1 },
    ]);
    expect(takeStyleLiveEngaged()).toEqual([]);
    expect(takeStyleShadowEngaged()).toEqual([
      { option: 'styleValueExtraction', confidence: 0.5 },
      { option: 'styleBigBetHonesty', confidence: 0.3 },
    ]);
    noteStyleEngaged('styleFoldBluff', 0.4, 'on');
    noteStyleShadowEngaged('styleFoldBluff', 0.4);
    clearStyleShadowEngaged();
    expect(takeStyleLiveEngaged()).toEqual([]);
    expect(takeStyleShadowEngaged()).toEqual([]);
  });
});

/** The receipts an option fires only when it APPLIES its adjustment, by option. */
const APPLIED: Record<string, StyleSwitchOption> = {
  style_value_bettor_not_maniac_seen: 'styleValueBettorNotManiac',
  style_big_bet_honesty_seen: 'styleBigBetHonesty',
  style_bluff_catch_cap_seen: 'styleBigBetHonesty',
  style_bluff_catch_cap_bounty_priced_seen: 'styleBigBetHonesty',
  style_raise_respect_seen: 'styleRaiseRespect',
  style_value_raise_respect_seen: 'styleRaiseRespect',
  style_commitment_priced_seen: 'styleRaiseRespect',
  style_tight_opener_respect_seen: 'styleTightReRaiserRespect',
  style_tight_reraiser_respect_seen: 'styleTightReRaiserRespect',
  style_pre_repair_fold_rate_discounted_seen: 'styleFoldRatePreRepair',
  style_value_extraction_seen: 'styleValueExtraction',
  style_fold_bluff_seen: 'styleFoldBluff',
};

describe('live style engagement receipts: an ON option records where it applies, through the real brain', () => {
  const ALL_ON = Object.fromEntries(STYLE_SWITCH_OPTIONS.map((o) => [o, true]));
  const liveTotal = new Map<string, number>();
  for (const mode of ['cash', 'tournament', 'bubble'] as Mode[])
    it(`${mode}: every applied receipt has its option in the live record; shadow and off record nothing there`, () => {
      for (const spot of ALL_SPOTS(mode))
        for (const [vn, v] of Object.entries(VILLAINS)) {
          // all ON
          install(v, mode);
          clearStyleShadowEngaged();
          const on = decide(spot, ALL_ON);
          const live = takeStyleLiveEngaged();
          expect(takeStyleShadowEngaged(), `${spot.name}/${vn}`).toEqual([]);
          const liveOptions = new Set(live.map((e) => e.option));
          for (const f of Object.keys(on.fires))
            if (APPLIED[f])
              expect(liveOptions.has(APPLIED[f]), `${spot.name}/${vn}: ${f}`).toBe(true);
          for (const e of live) {
            expect(e.confidence).toBeGreaterThanOrEqual(0);
            expect(e.confidence).toBeLessThanOrEqual(1);
            liveTotal.set(e.option, (liveTotal.get(e.option) ?? 0) + 1);
          }
          // all in shadow and all off: the live record stays empty
          for (const opts of [{ styleShadow: STYLE_SWITCH_OPTIONS }, {}]) {
            install(v, mode);
            clearStyleShadowEngaged();
            decide(spot, opts);
            expect(takeStyleLiveEngaged(), `${spot.name}/${vn}`).toEqual([]);
            clearStyleShadowEngaged();
          }
        }
    });
  it('the ON arm engaged on the pinned spots', () => {
    expect([...liveTotal.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  for (const mode of ['cash', 'tournament', 'bubble'] as Mode[])
    it(`${mode}: the decision never reads the live record (all ON, record empty or already full: same decision, same receipts)`, () => {
      for (const spot of ALL_SPOTS(mode))
        for (const [vn, v] of Object.entries(VILLAINS)) {
          install(v, mode);
          clearStyleShadowEngaged();
          const empty = decide(spot, ALL_ON);
          clearStyleShadowEngaged();
          install(v, mode);
          for (const o of STYLE_SWITCH_OPTIONS) noteStyleEngaged(o, 0.5, 'on');
          const full = decide(spot, ALL_ON);
          clearStyleShadowEngaged();
          expect(full.digest, `${spot.name}/${vn}`).toBe(empty.digest);
          expect(full.fires, `${spot.name}/${vn}`).toEqual(empty.fires);
        }
    });
});
