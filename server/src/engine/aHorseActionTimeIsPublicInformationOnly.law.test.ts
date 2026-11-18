/**
 * LAW: THE TIME A HORSE TAKES IS PUBLIC INFORMATION ONLY (owner order
 * 2026-11-15, "there is a timing tell ... fix that globally").
 *
 * With `horseActionTimeIsPublicOnly` on, a think time has ONE producer,
 * horsePublicActionTimeMs, fed by HorseLogic.publicTimingSpot. This law reads
 * the source, so a later edit that hands either of them a hole card, an
 * equity, the private difficulty hint or the strategy random stream, or that
 * gives some branch a think time of its own, fails here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HORSE_PUBLIC_THINK_TIMEBANK_SENTINEL } from './horsePublicActionTime.js';

const ENGINE = join(process.cwd(), 'src', 'engine');
const read = (name: string) => readFileSync(join(ENGINE, name), 'utf8');
/** Source without comments (block and line), so prose cannot satisfy or break a rule. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const LOGIC = code(read('HorseLogic.ts'));
const PACING = code(read('horsePublicActionTime.ts'));

function body(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `${start} not found`).toBeGreaterThan(-1);
  const to = source.indexOf(end, from + start.length);
  expect(to, `${end} not found after ${start}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

/** Names that carry private state or say which internal path decided. */
const PRIVATE =
  /fastRandom|difficultyHint|v87HollywoodEligible|madeCategory|equity|holeCards|\.cards\b|player\.|preflopAuthority|policyOwnership|policyFallback|omahaNut|hasRiverNuts|strength/;

describe('a Horse action time is public information only', () => {
  it('the pacing module reads no private name and no strategy random stream', () => {
    expect(PACING).not.toMatch(PRIVATE);
    expect(PACING).not.toMatch(/from '\.\/HorseEval\.js'|from '\.\/HorseLogic\.js'/);
    // Its only imports: the pure gravity, the public board texture, the persona hash, the OS seed.
    const imports = [...PACING.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual([
      '../types.js',
      './HorseMind.js',
      './HorsePersona.js',
      './horseDecisionGravity.js',
      'node:crypto',
    ]);
    expect(PACING).toMatch(/HorseMind\.texture\(spot\.board/);
    expect((PACING.match(/HorseMind\.\w+\(/g) ?? []).length).toBe(1);
  });

  it('the spot handed to it is built from the public state alone', () => {
    const spot = body(LOGIC, 'static publicTimingSpot(', 'static readonly THINK_TIMEBANK_SENTINEL');
    expect(spot).not.toMatch(PRIVATE);
    // The only "cards" it may name are the community cards.
    const cardWords = spot.match(/\b\w*[cC]ards\w*\b/g) ?? [];
    expect(cardWords.filter((w) => !/^communityCards[23]?$/.test(w))).toEqual([]);
    // It takes the seat's id, never the seat's private player object.
    expect(spot).toMatch(/seatUserId: string/);
    expect(spot).not.toMatch(/SeatPlayer/);
  });

  it('with the option on, the timing step has one producer and reads no private stash', () => {
    const step = body(
      LOGIC,
      "graph.run('timing'",
      'decision.policyOwnership = horsePolicyOwnership('
    );
    const on = body(
      step,
      'if (opts.horseActionTimeIsPublicOnly === true) {',
      'return { decision };'
    );
    expect(on).toMatch(
      /decision\.thinkTime = horsePublicActionTimeMs\(\s*HorseLogic\.publicTimingSpot\(/
    );
    expect(on).not.toMatch(/computeThinkTime/);
    // The private stashes are cleared, never read; the strategy stream is only advanced.
    expect(on).toMatch(/difficultyHint = 0;/);
    expect(on).toMatch(/v87HollywoodEligible = false;/);
    expect(on.replace(/difficultyHint = 0;|v87HollywoodEligible = false;/g, '')).not.toMatch(
      /difficultyHint|v87HollywoodEligible/
    );
    expect(on).not.toMatch(/=\s*fastRandom\(\)|fastRandom\(\)\s*[*+\-/<>]/);
    expect(on).not.toMatch(/player\.cards|madeCategory|equity/);
    // The option is opt-in, read exactly as `=== true`, everywhere.
    const reads = LOGIC.match(/opts\.horseActionTimeIsPublicOnly[^;\n]*/g) ?? [];
    expect(reads.length).toBe(2);
    for (const r of reads) expect(r).toMatch(/^opts\.horseActionTimeIsPublicOnly === true/);
  });

  it('timing is the last step of a decision: nothing after it sets a think time', () => {
    const decide = body(
      LOGIC,
      'private static decideInternal(',
      'private static decidePreflopV7Glue('
    );
    const after = decide.slice(decide.lastIndexOf("graph.run('timing'"));
    expect(after.match(/graph\.run\(/g)?.length).toBe(1);
    const tail = after.slice(after.indexOf('decision.policyOwnership = horsePolicyOwnership('));
    expect(tail).not.toMatch(/thinkTime/);
  });

  it('no branch of HorseLogic carries a think time of its own', () => {
    // Every `thinkTime:` in the brain is the 0 placeholder the timing step
    // overwrites, a pass-through of another decision's value, or the safety
    // net's value (the public function when the option is on).
    const literals = LOGIC.match(/thinkTime:\s*[^,}\n]+/g) ?? [];
    expect(literals.length).toBeGreaterThan(100);
    const odd = literals.filter(
      (l) =>
        !/^thinkTime:\s*0\s*$/.test(l) &&
        !/^thinkTime:\s*[A-Za-z0-9_]+\.thinkTime\s*$/.test(l) &&
        !/^thinkTime:\s*netThinkTime\s*$/.test(l) &&
        !/^thinkTime:\s*number;?\s*$/.test(l)
    );
    expect(odd).toEqual([]);
    // Assignments: the timing step's two arms and nothing else.
    const assigns = LOGIC.match(/\.thinkTime\s*=[^=][^;\n]*/g) ?? [];
    expect(assigns.map((a) => a.replace(/\s+/g, ' ').slice(0, 60)).sort()).toEqual([
      '.thinkTime = horsePublicActionTimeMs(',
      '.thinkTime = this.computeThinkTime(',
    ]);
    // The safety net: the public function when the option is on.
    const net = body(LOGIC, 'let netThinkTime = 1500;', "policyFallback: 'brain_exception' }");
    expect(net).toMatch(/if \(opts\.horseActionTimeIsPublicOnly === true\)/);
    expect(net).toMatch(
      /netThinkTime = horsePublicActionTimeMs\(\s*HorseLogic\.publicTimingSpot\(/
    );
  });

  it('no other policy owner invents a think time', () => {
    // The later owners and the wager rules pass a think time through or use
    // the 0 placeholder; none holds a duration of its own.
    for (const file of [
      'plo4/Plo4LivePolicy.ts',
      'omaha/OmahaVariantLivePolicy.ts',
      'remainingVariants/RemainingVariantLivePolicy.ts',
      'multiway/JointLivePolicy.ts',
      'multiway/JointStreetBetting.ts',
      'HorseRiverNuts.ts',
      'HorseOmahaCurrentNuts.ts',
      'HorseHeadsUpCommitment.ts',
      'HorseV31CertifiedPolicy.ts',
      'HorseTournamentUtility.ts',
      'HorseTournamentPostflop.ts',
    ]) {
      const src = code(read(file));
      const odd = (src.match(/thinkTime:\s*[^,}\n]+/g) ?? []).filter(
        (l) =>
          !/^thinkTime:\s*0\s*$/.test(l) &&
          !/^thinkTime:\s*[A-Za-z0-9_]+\.thinkTime\s*$/.test(l) &&
          !/^thinkTime:\s*number;?\s*$/.test(l)
      );
      expect(odd, file).toEqual([]);
      expect(src.match(/\.thinkTime\s*=[^=]/g) ?? [], file).toEqual([]);
    }
  });

  it("the time-bank sentinel is the brain's own", () => {
    expect(HORSE_PUBLIC_THINK_TIMEBANK_SENTINEL).toBe(HorseLogic.THINK_TIMEBANK_SENTINEL);
  });
});
