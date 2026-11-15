/**
 * Hold'em and Omaha fixed-input full-hand replay against main, option off and
 * on (owner D3 option C: "replay vs main for Hold'em and Omaha"). The fixture
 * holds one fingerprint per hand recorded from main (see the test-support
 * header). Option absent or false: every hand of every cell equals main.
 * Option on: every Omaha hand equals main, and every hold'em hand in which no
 * persona comparison changed an answer equals main; a hand may differ only
 * after a persona comparison changed its answer.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPLAY_CELLS, replayFingerprints } from './HoldemPersonaReplayVsMain.test-support.js';

const FIXTURE = resolve(__dirname, 'fixtures/holdem-persona-replay-vs-main.json');
const PRINT = process.env.HOLDEM_REPLAY_PRINT === '1';

interface Recorded {
  recordedFrom: string;
  cells: Record<string, string[]>;
}

const CHANGED = /^holdem_persona_.*_changed_seen$/;
/** holdemPersonaPreflop also moves bars: a shifted bar may change a hand. */
const CHANGED_OR_SHIFTED = /^holdem_persona_(.*_changed|open_shift|continue_shift)_seen$/;

describe("Hold'em and Omaha full-hand replay against main", () => {
  if (process.env.HOLDEM_REPLAY_RECORD) {
    it('records main (run from a main archive, see the test-support header)', () => {
      const run = replayFingerprints({});
      const out: Recorded = {
        recordedFrom: process.env.HOLDEM_REPLAY_FROM ?? 'unstated',
        cells: Object.fromEntries(
          Object.entries(run).map(([k, v]) => [k, v.map((h) => h.fingerprint)])
        ),
      };
      writeFileSync(process.env.HOLDEM_REPLAY_RECORD!, JSON.stringify(out));
      expect(Object.keys(out.cells).length).toBe(REPLAY_CELLS.length);
    }, 600_000);
    return;
  }
  const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Recorded;

  for (const [label, extra] of [
    ['absent', {}],
    ['false', { holdemPersonaReRaiseMix: false }],
    ['holdemPersonaPreflop false', { holdemPersonaPreflop: false }],
  ] as const) {
    it(`option ${label}: every hand of every hold'em and Omaha cell equals main`, () => {
      const run = replayFingerprints(extra);
      let hands = 0;
      let decisions = 0;
      for (const cell of REPLAY_CELLS) {
        const main = recorded.cells[cell.name];
        expect(main.length, cell.name).toBe(cell.hands);
        run[cell.name].forEach((h, i) => {
          if (h.fingerprint !== main[i])
            throw new Error(`${cell.name} hand ${i}: differs from main`);
          decisions += h.decisions;
        });
        hands += cell.hands;
      }
      if (PRINT)
        console.log(`option ${label}: ${hands} hands, ${decisions} decisions, all equal main`);
      expect(hands).toBe(5800);
    }, 600_000);
  }

  for (const [option, mark] of [
    ['holdemPersonaReRaiseMix', CHANGED],
    ['holdemPersonaPreflop', CHANGED_OR_SHIFTED],
  ] as const)
    it(`${option} on: Omaha equals main; a hold'em hand differs only after a persona comparison changed or a persona bar moved`, () => {
      const run = replayFingerprints({ [option]: true }, true);
      let holdemChanged = 0;
      let holdemDiffer = 0;
      for (const cell of REPLAY_CELLS) {
        const main = recorded.cells[cell.name];
        let changedHands = 0;
        let differ = 0;
        run[cell.name].forEach((h, i) => {
          const changed = h.fires.some((f) => mark.test(f));
          if (cell.family === 'omaha') {
            expect(
              h.fires.filter((f) => f.startsWith('holdem_persona_')),
              `${cell.name} ${i}`
            ).toEqual([]);
            if (h.fingerprint !== main[i])
              throw new Error(`${cell.name} hand ${i}: Omaha differs from main`);
            return;
          }
          if (changed) changedHands++;
          if (h.fingerprint !== main[i]) {
            differ++;
            if (!changed) throw new Error(`${cell.name} hand ${i}: differs with no persona change`);
          }
        });
        if (PRINT)
          console.log(
            `${option} on: ${cell.name}: ${cell.hands} hands, persona changed an answer or moved a bar in ${changedHands}, differ from main ${differ}`
          );
        holdemChanged += changedHands;
        holdemDiffer += differ;
      }
      // Not vacuous: the option does change hold'em hands.
      expect(holdemChanged).toBeGreaterThan(0);
      expect(holdemDiffer).toBeGreaterThan(0);
    }, 600_000);
});
