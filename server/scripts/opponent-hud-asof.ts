/**
 * OPPONENT HUD AS OF A HAND (offline; replay harness and sparring; lane OPPONENT-HUD 2026-11-20).
 *
 *   npx tsx server/scripts/opponent-hud-asof.ts --from-jsonl ROWS.jsonl --hand <hand-uuid> --family plo5 \
 *       [--users u1,u2] [--packet --street flop --at <epoch ms> --priors population.json] --out FILE
 *
 * ROWS.jsonl: hand_history rows (public projection of fn_opponent_hud_hands_page, or full rows: cards are never read).
 * Writes the profiles as they stood before that hand (OpponentHudAsOf.profilesBefore), or with --packet the decision
 * packet production would attach (packetBefore). Same structure the engine reads. Operators and lanes only.
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { OpponentHudAsOf } from '../src/engine/opponentHud/OpponentHudAsOf.js';
import { parseHudPopulation, priorsForStake } from '../src/engine/opponentHud/OpponentHud.js';
import {
  familyForVariant,
  type HudFamily,
  type HudStreet,
} from '../src/engine/opponentHud/OpponentHudProfile.js';

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main(): Promise<void> {
  const file = opt('--from-jsonl');
  const hand = opt('--hand');
  const out = opt('--out');
  if (!file || !hand || !out) throw new Error('--from-jsonl, --hand and --out are required');
  const family: HudFamily = familyForVariant(opt('--family')) ?? 'plo5';
  const users = opt('--users')?.split(',').filter(Boolean);
  const rows: unknown[] = [];
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) rows.push(JSON.parse(line));
  const b = new OpponentHudAsOf(rows);
  let result: unknown;
  if (args.includes('--packet')) {
    const pop = opt('--priors')
      ? parseHudPopulation(JSON.parse(readFileSync(opt('--priors')!, 'utf8')))
      : null;
    const bb = Number(opt('--bb') ?? NaN);
    result = b.packetBefore(
      hand,
      family,
      users ?? [],
      pop ? priorsForStake(pop, Number.isFinite(bb) ? bb : null) : {},
      Number(opt('--at') ?? Date.now()),
      (opt('--street') ?? 'preflop') as HudStreet
    );
  } else result = b.profilesBefore(hand, family, users);
  if (result === null) throw new Error('the hand is not in the rows');
  writeFileSync(out, JSON.stringify(result), { mode: 0o600 });
  console.log(`wrote ${out} (${b.size} hands known)`);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
