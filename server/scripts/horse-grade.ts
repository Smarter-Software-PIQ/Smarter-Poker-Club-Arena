/**
 * The honest grading harness from the command line (src/benchmark/HorseGradeHarness.ts). Run from server/:
 *   npx tsx scripts/horse-grade.ts mirror <variant> <seats> <stackBB> <pairs> <seed> <onJson>
 *   npx tsx scripts/horse-grade.ts probe <kind> <variant> <seats> <stackBB> <deals> <seed> <onJson>
 * kinds: caller (calls every postflop bet, never bets), neverfold (the production Horse that never folds postflop),
 *        people (people-calibrated PLO answers), nobluff | balanced | overbluff | folder (turn/river opener),
 *        flop-nobluff | flop-balanced | flop-overbluff | flop-folder (flop opener)
 * env: OPTS_FILE = JSON {"opts": {...}} the base options (the live switch rows; default none), FORK=0 (probe: two
 *      persistent worlds instead of the fork), NOOP=0 (no same-seed no-op arm), MEMORY=off, FRAC, VALUE, PLAYERS=hu|mw|any.
 * Prints one line: RESULT {json}. Every grade is read as onMinusNoop.
 */
import { readFileSync } from 'node:fs';
process.env.EQUITY_GOVERNOR ??= 'off';
// Offline: the grade never touches a database. The engine modules refuse to load without these, so an unset
// environment gets an unreachable URL and a placeholder that is not a key.
process.env.SUPABASE_URL ??= 'https://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'offline-grading-no-database';
const G = await import('../src/benchmark/HorseGradeHarness.js');
const base = process.env.OPTS_FILE
  ? JSON.parse(readFileSync(process.env.OPTS_FILE, 'utf8')).opts
  : {};
const [mode, ...a] = process.argv.slice(2);
const t0 = Date.now();
const progress = (n: number) => console.error(n, `${((Date.now() - t0) / n).toFixed(1)} ms/unit`);
const noop = process.env.NOOP !== '0';
const memory = process.env.MEMORY !== 'off';
let out: unknown;
if (mode === 'mirror') {
  const [variant, seats, stack, pairs, seed, on] = a;
  out = await G.gradeMirror({
    variant: variant!,
    seats: +seats!,
    stackBB: +stack!,
    pairs: +pairs!,
    seed: +seed!,
    base,
    on: JSON.parse(on!),
    noop,
    memory,
    onProgress: progress,
  });
  out = {
    mode,
    variant,
    seats: +seats!,
    stackBB: +stack!,
    seed: +seed!,
    option: JSON.parse(on!),
    ...(out as object),
  };
} else if (mode === 'probe') {
  const [kind, variant, seats, stack, deals, seed, on] = a;
  const num = (k: string) => (process.env[k] ? Number(process.env[k]) : undefined);
  const flop = kind!.startsWith('flop-');
  const k = kind!.replace(/^flop-/, '');
  const policy =
    k === 'caller'
      ? G.gradePassiveCallerPolicy(base)
      : k === 'neverfold'
        ? G.gradeCallerPolicy(base)
        : k === 'people'
          ? G.gradePeoplePloPolicy(base, variant as 'plo4' | 'plo5')
          : G.gradeOpenerPolicy({
              base,
              kind: k as never,
              streets: flop ? 'flop' : 'turn_river',
              frac: num('FRAC'),
              value: num('VALUE'),
              players: (process.env.PLAYERS as never) ?? undefined,
            });
  const r = await G.gradeProbe({
    variant: variant!,
    seats: +seats!,
    stackBB: +stack!,
    deals: +deals!,
    seed: +seed!,
    base,
    on: JSON.parse(on!),
    policy,
    fork: process.env.FORK !== '0',
    noop,
    memory,
    onProgress: progress,
  });
  out = {
    mode,
    kind,
    variant,
    seats: +seats!,
    stackBB: +stack!,
    seed: +seed!,
    option: JSON.parse(on!),
    fork: process.env.FORK !== '0',
    ...r,
  };
} else {
  throw new Error('usage: mirror|probe ... (see the header)');
}
console.log('RESULT', JSON.stringify({ ...(out as object), ms: Date.now() - t0 }));
process.exit(0);
