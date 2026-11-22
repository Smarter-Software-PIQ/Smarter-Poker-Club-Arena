/**
 * LAW (lane CORE-POOLED, owner 9:52 AM Nov 20 2026: "THE SAME CORRECTIONS... AGAINST ALL PLAYERS, REGARDLESS IF
 * THEY ARE HUMAN OR HORSES. ALL PLAY AND DECISIONS SHOULD BE THE SAME ACROSS THE BOARD, THEY SHOULDN'T CHANGE OR
 * BE SPECIFIC TO ONE PLAYER."): the PLO math core is identity-free.
 *  1. No core source (comments stripped) accepts or derives a person/Horse label or a user id: no person / isHorse /
 *     humanUserIds / user_id read, no actor / responder / bettor kind, no 'person' or 'horse' key segment, no
 *     per-user table section.
 *  2. No table the core loads has a person/Horse or table-composition key segment, a per-user section or a user-id key.
 *  3. Behaviour: the core's state and decision for a recorded spot are byte-identical whatever the persons list and
 *     whatever the user ids at the table.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stateAt } from '../HorseComplaintReplay.js';
import {
  RECORDED_FLOP_FACING_BETS,
  expandFlop,
} from '../HorseOmahaFlopFacingBetEv.test-support.js';
import { decideOmahaMathCore } from './OmahaMathCore.js';
import { omahaMathCoreState } from './OmahaMathCoreRule.js';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const SOURCES = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
const TABLES = readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.includes('fixture'));

/** Source text without comments or the contents of string literals that are only receipts (kept: quotes). */
function code(f: string): string {
  return readFileSync(DIR + f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

describe('LAW: the PLO math core is identity-free (no person/Horse, no user-id key)', () => {
  it('no core source reads or derives a person/Horse label or a user id', () => {
    const banned: [RegExp, string][] = [
      [/\.person\b/, '.person'],
      [/\bperson\s*:/, 'person:'],
      [/\bisHorse\b|\bis_horse\b|\bisHuman\b/, 'isHorse / isHuman'],
      [/humanUserIds|horseUserIds|user_id/, 'person list / user_id'],
      [/\.user\b|\buser\s*:/, '.user / user:'],
      [/\bActor\b|\bactorOf\b|\bOppActor\b/, 'Actor kind'],
      [/\bresponder\s*:|\bbettor\s*:|\bvs\s*:/, 'responder / bettor / vs kind'],
      [/'person'|'horse'|"person"|"horse"/, "'person' / 'horse' literal"],
      [
        /\|person\b|\|horse\b|vs_horse|vs_person|horse_present|persons_only/,
        'identity key segment',
      ],
      [
        /\.persons\b|\bpersons\s*:|\bopponents\?*\.\[|personFoldRate|personShares|horseDefenceFold/,
        'per-user / per-kind rows',
      ],
    ];
    const hits: string[] = [];
    for (const f of SOURCES) {
      const c = code(f);
      for (const [re, what] of banned) if (re.test(c)) hits.push(`${f}: ${what}`);
    }
    expect(hits).toEqual([]);
  });

  it('no table the core loads carries an identity key, a per-user section or a user-id key', () => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const seg =
      /(^|\|)(person|horse|persons|horses|mixed|vs_horse|vs_person|horse_present|persons_only)(\||$)/;
    const bad: string[] = [];
    const walk = (f: string, path: string, v: unknown, depth: number) => {
      if (!v || typeof v !== 'object' || Array.isArray(v) || depth > 3) return;
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (seg.test(k) || uuid.test(k) || /^(persons|opponents|users)$/.test(k))
          bad.push(`${f}:${path}${k}`);
        walk(f, `${path}${k}.`, x, depth + 1);
      }
    };
    for (const f of TABLES) walk(f, '', JSON.parse(readFileSync(DIR + f, 'utf8')), 0);
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it('the core state and decision are identical whatever the persons list and the user ids', () => {
    let checked = 0;
    for (const r of RECORDED_FLOP_FACING_BETS.slice(0, 4)) {
      const { fx, node } = expandFlop(r);
      const st = stateAt(fx, node);
      const players = (st.gs.players ?? []) as { user_id: string; seat: number }[];
      const ids = players.map((p) => p.user_id);
      const variants = [
        { ...st.gs, humanUserIds: [] },
        { ...st.gs, humanUserIds: ids },
        {
          ...st.gs,
          humanUserIds: ids.slice(0, 1),
          players: players.map((p) => ({ ...p, user_id: `renamed-${p.seat}` })),
        },
      ];
      const states = variants.map((gs) => omahaMathCoreState(st.hero, gs as never));
      for (const s of states.slice(1)) expect(JSON.stringify(s)).toBe(JSON.stringify(states[0]));
      const now = (() => {
        let t = 0;
        return () => (t += 0.001);
      })();
      const a = decideOmahaMathCore(states[0], { now }).receipt;
      const b = decideOmahaMathCore(states[2], { now }).receipt;
      expect(a.choice).toEqual(b.choice);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
