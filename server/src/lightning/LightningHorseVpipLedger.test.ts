import { describe, expect, it } from 'vitest';
import {
  LightningHorseVpipLedger,
  lightningHandWasEntered,
  lightningHorseVpipFloorInput,
} from './LightningHorseVpipLedger.js';

const forced = (userId: string, action: string, dead = false) => ({
  userId,
  action,
  stage: 'preflop',
  origin: 'forced',
  dead,
});
const act = (userId: string, action: string, stage = 'preflop') => ({ userId, action, stage });

describe('lightningHandWasEntered (the ca_hand_facts definition of VPIP)', () => {
  it('a call, a bet, a raise or an all-in preflop enters the hand; a limp that folds still entered', () => {
    for (const a of ['call', 'bet', 'raise', 'all_in'])
      expect(lightningHandWasEntered('h', [act('h', a)])).toBe(true);
    expect(
      lightningHandWasEntered('h', [act('h', 'call'), act('x', 'raise'), act('h', 'fold')])
    ).toBe(true);
  });
  it('blinds, the ante, a big blind check, a fold and a later-street action do not', () => {
    expect(
      lightningHandWasEntered('h', [
        forced('h', 'bb'),
        forced('h', 'ante', true),
        act('h', 'check'),
      ])
    ).toBe(false);
    expect(lightningHandWasEntered('h', [forced('h', 'sb'), act('h', 'fold')])).toBe(false);
    expect(lightningHandWasEntered('h', [act('h', 'bet', 'flop')])).toBe(false);
    expect(lightningHandWasEntered('h', [act('other', 'raise')])).toBe(false);
  });
});

describe('LightningHorseVpipLedger', () => {
  const horse = (playerId: string, poolSessionId: string) => ({
    playerId,
    poolSessionId,
    isHorse: true,
  });
  it('counts every dealt hand of a Horse per pool sitting, and no person', () => {
    const l = new LightningHorseVpipLedger();
    const people = { playerId: 'p', poolSessionId: 'sp', isHorse: false };
    l.record(
      [horse('a', 's1'), horse('b', 's2'), people],
      [act('a', 'call'), act('p', 'raise'), act('a', 'fold')]
    );
    l.record([horse('a', 's1'), horse('b', 's2'), people], [forced('b', 'bb'), act('b', 'check')]);
    expect(l.read('s1')).toEqual({ hands: 2, vpipHands: 1 });
    expect(l.read('s2')).toEqual({ hands: 2, vpipHands: 0 });
    expect(l.read('sp')).toEqual({ hands: 0, vpipHands: 0 });
    expect(l.read(undefined)).toEqual({ hands: 0, vpipHands: 0 });
    // a new sitting of the same Horse starts again
    l.record([horse('a', 's9')], [act('a', 'raise')]);
    expect(l.read('s9')).toEqual({ hands: 1, vpipHands: 1 });
    expect(l.read('s1')).toEqual({ hands: 2, vpipHands: 1 });
  });
  it('is bounded: the sitting dealt longest ago leaves first', () => {
    const l = new LightningHorseVpipLedger(2);
    l.record([horse('a', 's1')], []);
    l.record([horse('b', 's2')], []);
    l.record([horse('a', 's1')], []);
    l.record([horse('c', 's3')], []);
    expect(l.size()).toBe(2);
    expect(l.read('s2')).toEqual({ hands: 0, vpipHands: 0 });
    expect(l.read('s1')).toEqual({ hands: 2, vpipHands: 0 });
  });
  it('never throws on a malformed log', () => {
    const l = new LightningHorseVpipLedger();
    expect(() => l.record([horse('a', 's1')], [null as never, 5 as never])).not.toThrow();
    expect(l.read('s1').hands).toBe(1);
  });
});

describe('lightningHorseVpipFloorInput', () => {
  const own = { hands: 12, vpipHands: 3 };
  it('reads the floor as the table engine reads it', () => {
    expect(
      lightningHorseVpipFloorInput(
        { nit_game: true, maintain_percent_min: 40, maintain_hands: 10 },
        own
      )
    ).toEqual({
      floor: 40,
      windowHands: 10,
      own,
    });
    expect(
      lightningHorseVpipFloorInput({ nit_game: true, maintain_percent_min: 40 }, own)?.windowHands
    ).toBe(10);
  });
  it('is null in an unfloored pool', () => {
    expect(
      lightningHorseVpipFloorInput({ nit_game: false, maintain_percent_min: 40 }, own)
    ).toBeNull();
    expect(
      lightningHorseVpipFloorInput({ nit_game: true, maintain_percent_min: 0 }, own)
    ).toBeNull();
    expect(lightningHorseVpipFloorInput({ nit_game: true }, own)).toBeNull();
    expect(lightningHorseVpipFloorInput(null, own)).toBeNull();
  });
});
