/**
 * EVERY HORSE TYPES LIKE ITS OWN PERSON (Dan 2026-10-22)
 *
 * "there should be like 100+ different short phrases and things said, and
 * every horse should be different and say different things, in different
 * styles, (like text styles) it must be 100% unique for each horse, some use
 * emoji's some don't."
 */
import { describe, expect, it } from 'vitest';
import { LINES, TALK_EVENTS, TALK_VOICES } from './horseTableTalkLines.js';
import { chooseLine, fillLine, moodOf, sanitizeStyledLine } from './HorseTableTalk.js';
import {
  EMOJI_BY_MOOD,
  EMOJI_COUNT_WEIGHTS,
  emojiRun,
  STYLE_EMOJI,
  personalChance,
  personalThrowChance,
  personalPool,
  styleFingerprint,
  styleLine,
  voiceStyleFor,
} from './horseVoiceStyle.js';

/** A thousand horse ids, shaped like the real ones. */
const HORSES = Array.from({ length: 1000 }, (_, i) => {
  const hex = (n: number, w: number) => n.toString(16).padStart(w, '0');
  return `${hex(i * 2654435761, 8).slice(-8)}-${hex(i, 4)}-4${hex(i * 7, 3).slice(-3)}-8${hex(i * 13, 3).slice(-3)}-${hex(i * 977, 12).slice(-12)}`;
});

const ALL_LINES = [
  ...new Set(
    TALK_EVENTS.flatMap((e) => TALK_VOICES.flatMap((v) => LINES[e][v].lines.map((l) => l)))
  ),
];
const FILL = { potBB: 52, street: 'river' as const, hand: 'full house', seat: 7 };
const EMOJI_RANGE = /[\u{1F000}-\u{1FAFF}]/u;

describe('the pool', () => {
  it('holds well over 100 different phrases', () => {
    const distinct = new Set(ALL_LINES.map((l) => l.toLowerCase()));
    expect(distinct.size).toBeGreaterThanOrEqual(120);
  });

  it('the emoji the style may write are single code points, built from numbers', () => {
    for (const e of STYLE_EMOJI) expect([...e]).toHaveLength(1);
    for (const mood of Object.keys(EMOJI_BY_MOOD)) {
      expect(EMOJI_BY_MOOD[mood as keyof typeof EMOJI_BY_MOOD].length).toBeGreaterThan(2);
    }
  });
});

describe('every horse is its own person', () => {
  it('every horse can participate occasionally with independent talking and gesture rates', () => {
    const styles = HORSES.map(voiceStyleFor);
    for (const style of styles) {
      expect(style.chattiness).toBeGreaterThanOrEqual(0.15);
      expect(style.throwiness).toBeGreaterThanOrEqual(0.15);
    }
    for (const talksMore of [false, true])
      for (const gesturesMore of [false, true]) {
        expect(
          styles.some(
            (style) =>
              style.chattiness > 0.5 === talksMore && style.throwiness > 0.5 === gesturesMore
          )
        ).toBe(true);
      }
    for (const horse of HORSES) {
      expect(personalChance(horse, 0)).toBe(0);
      expect(personalThrowChance(horse, 0)).toBe(0);
      for (const base of [6, 14, 30, 100]) {
        expect(personalChance(horse, base)).toBeGreaterThan(0);
        expect(personalChance(horse, base)).toBeLessThanOrEqual(35);
        expect(personalThrowChance(horse, base)).toBeGreaterThan(0);
        // 40, not 25: the gesture cap was raised so boosted tournament and
        // big-pot moments actually land (owner 2026-11-11).
        expect(personalThrowChance(horse, base)).toBeLessThanOrEqual(40);
      }
    }
  });

  it.each([
    ['AuntieKurt', '71efcdb3-a39e-4e4d-9039-337de85f3eea'],
    ['MicahPoker', '44f1ff92-b5de-44c5-9f7b-319318ff2a74'],
    ['jester_86', 'aef849b8-2906-4dc0-b108-251710e76d3c'],
    ['Burls', '7e616640-58dd-4d8d-a18e-2f37f057bcd9'],
    ['Mr Drew', 'd1187172-6cd3-477a-b035-bbb677d0a62f'],
    ['pam.chen', '1b049140-90bf-4b45-82db-a6dc259ce0c3'],
    ['Luis71', 'fd1b5e7e-3dfc-40d2-890f-23b936ac24ab'],
    ['NatSr', 'ad0c8518-f9e3-4341-a1db-dccf83145838'],
    ['rosanguyen', '01bd8786-371e-4ba2-85d6-baab469bba07'],
    ['zoeokafor', '778f8033-c9e2-45fa-98ca-935f38e2b8ca'],
  ])('%s from the reported Hold’em tables has both social capabilities', (_name, horse) => {
    expect(personalChance(horse, 14)).toBeGreaterThan(0);
    expect(personalThrowChance(horse, 18)).toBeGreaterThan(0);
  });

  it('preserves the existing frequencies of horses that already participated', () => {
    const uncleJules = voiceStyleFor('32a4fc92-d1d4-472b-a585-ac19a7e10616');
    expect(uncleJules.chattiness).toBe(0.88);
    expect(uncleJules.throwiness).toBe(0.95);
    const pitTony = voiceStyleFor('b5fa9dcb-bc18-4806-b308-3085f42fbff2');
    expect(pitTony.chattiness).toBe(0.33);
    expect(pitTony.throwiness).toBe(0.88);
  });

  it('no two of a thousand horses share a style fingerprint', () => {
    const prints = new Set(HORSES.map((h) => styleFingerprint(h, ALL_LINES)));
    expect(prints.size).toBe(HORSES.length);
  });

  it('the style is stable: the same horse is the same person every time', () => {
    for (const h of HORSES.slice(0, 50)) {
      expect(voiceStyleFor(h)).toEqual(voiceStyleFor(h));
      expect(styleLine('nice hand', h, 'lost', '42|pot_lost')).toBe(
        styleLine('nice hand', h, 'lost', '42|pot_lost')
      );
    }
  });

  it('some horses never use emoji and some do, and every habit has more than one setting', () => {
    const styles = HORSES.map(voiceStyleFor);
    const never = styles.filter((s) => s.emojiMode === 'never').length;
    expect(never).toBeGreaterThan(300);
    expect(never).toBeLessThan(700);
    for (const key of ['caseMode', 'punct', 'shorthand', 'laugh', 'emojiMode'] as const) {
      expect(new Set(styles.map((s) => s[key])).size, key).toBeGreaterThan(2);
    }
    const chatty = styles.map((s) => s.chattiness);
    expect(Math.min(...chatty)).toBe(0.15);
    expect(Math.max(...chatty)).toBeLessThanOrEqual(0.95);
  });

  it('two horses with the same voice say different things', () => {
    const pool = LINES.pot_lost.needler.lines;
    const a = personalPool(HORSES[1], pool);
    const b = personalPool(HORSES[2], pool);
    expect(a).not.toEqual(b);
    // and nobody is left with nothing to say
    for (const h of HORSES) {
      for (const e of TALK_EVENTS) {
        for (const v of TALK_VOICES)
          expect(personalPool(h, LINES[e][v].lines).length).toBeGreaterThan(0);
      }
    }
  });

  it('the same moment reads differently across the fleet', () => {
    const typed = new Set(
      HORSES.slice(0, 200).map((h) => styleLine('nice hand', h, 'lost', '7|pot_lost'))
    );
    expect(typed.size).toBeGreaterThan(40);
  });
});

describe('what a styled line may carry', () => {
  it('every line in the pool, typed by 150 horses, passes the styled door', () => {
    const names = ['danny', 'plate4', 'gg_master', 'seat7'];
    let withEmoji = 0;
    for (const h of HORSES.slice(0, 150)) {
      for (const e of TALK_EVENTS) {
        for (const v of TALK_VOICES) {
          for (const template of LINES[e][v].lines) {
            const filled = fillLine(template, FILL);
            if (filled === null) continue;
            const typed = styleLine(filled, h, moodOf(e), `${template}|1`);
            const verdict = sanitizeStyledLine(typed, names);
            expect(verdict, `"${typed}" refused`).toEqual({ ok: true, line: typed.trim() });
            if (EMOJI_RANGE.test(typed)) {
              withEmoji++;
              for (const ch of [...typed].filter((c) => EMOJI_RANGE.test(c))) {
                expect(STYLE_EMOJI.has(ch), `${ch} is not a style emoji`).toBe(true);
              }
            }
          }
        }
      }
    }
    expect(withEmoji).toBeGreaterThan(0);
  });

  it('the styled door still refuses an emoji the style never writes', () => {
    expect(sanitizeStyledLine(`gg ${String.fromCodePoint(0x1f600)}`, []).ok).toBe(false);
    const allowed = [...STYLE_EMOJI][0];
    expect(sanitizeStyledLine(`gg ${allowed}`, [])).toEqual({ ok: true, line: `gg ${allowed}` });
    expect(sanitizeStyledLine(`gg danny ${allowed}`, ['danny']).ok).toBe(false);
  });

  it('chooseLine draws from the horse own share of the pool', () => {
    const counts = new Map<string, number>();
    for (let hand = 1; hand <= 400; hand++) {
      const c = chooseLine('pot_lost', 'friendly', HORSES[3], hand, FILL);
      if (c) counts.set(c.template, (counts.get(c.template) ?? 0) + 1);
    }
    const mine = personalPool(HORSES[3], LINES.pot_lost.friendly.lines);
    for (const t of counts.keys()) expect(mine).toContain(t);
  });
});

describe('emoji counts and typos (Dan 2026-10-22: "1-5 and always randomly choses, never ever always 3")', () => {
  it('a run is 1 to 5 emoji, every count occurs, fewer is likelier, and none dominates', () => {
    const favs = EMOJI_BY_MOOD.won.slice(0, 3);
    const byCount = new Map<number, number>();
    let mixed = 0;
    for (let i = 0; i < 4000; i++) {
      const run = [...emojiRun(favs, (w) => `k${i}|${w}`)];
      byCount.set(run.length, (byCount.get(run.length) ?? 0) + 1);
      if (new Set(run).size > 1) mixed++;
    }
    expect([...byCount.keys()].sort()).toEqual([1, 2, 3, 4, 5]);
    for (const [n, c] of byCount) expect(c / 4000, `count ${n}`).toBeLessThan(0.5);
    expect(byCount.get(1)!).toBeGreaterThan(byCount.get(5)!);
    expect(mixed).toBeGreaterThan(400);
    expect(EMOJI_COUNT_WEIGHTS.map(([n]) => n)).toEqual([1, 2, 3, 4, 5]);
  });

  it('most horses never typo; the ones that do, do it on a few lines', () => {
    const styles = HORSES.map(voiceStyleFor);
    const clean = styles.filter((s) => s.typoPct === 0).length;
    expect(clean).toBeGreaterThan(450);
    expect(clean).toBeLessThan(HORSES.length);
    for (const s of styles) expect(s.typoPct).toBeLessThanOrEqual(15);
  });
});
