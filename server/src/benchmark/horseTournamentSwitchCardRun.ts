/**
 * One shard of a whole-tournament switch card (HorseTournamentSwitchCard.ts),
 * in this process. Measurement only: it writes one result file and activates
 * nothing. From server/:
 *
 *   nice -n 15 npx tsx src/benchmark/horseTournamentSwitchCardRun.ts \
 *     --card=<card.json> --objective=mtt|sng|spin|satellite|pko|mystery \
 *     --seed=<int> --first-pair=<int> --pairs=<1..1024> --field=horse|human \
 *     --out=<result.json>
 *
 * card.json: { "name", "variant": "nlh"|"plo4"|"plo5", "flag", "candidateValue"?,
 * "startingStacks"?: "equal"|"uneven", and either "base" (option -> boolean map,
 * entries or an arms.json object) or "basePath" (a file holding one of those) }.
 * The output file must not exist (opened wx).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
process.env.EQUITY_GOVERNOR = 'off';
process.env.SUPABASE_URL ??= 'https://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'tournament-switch-card-offline-placeholder';

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const m = /^--(card|objective|seed|first-pair|pairs|field|out)=(.+)$/.exec(arg);
  if (!m || args.has(m[1]!)) throw Error(`Unknown or duplicate argument: ${arg}`);
  args.set(m[1]!, m[2]!);
}
for (const key of ['card', 'objective', 'seed', 'pairs', 'out'])
  if (!args.has(key)) throw Error('Missing --' + key);
const int = (k: string, d?: number) => {
  const v = args.has(k) ? Number(args.get(k)) : d;
  if (!Number.isSafeInteger(v)) throw Error(`--${k} must be an integer`);
  return v!;
};
const cardPath = resolve(args.get('card')!);
const raw = JSON.parse(await readFile(cardPath, 'utf8')) as Record<string, unknown>;
const base =
  raw.basePath !== undefined
    ? JSON.parse(await readFile(resolve(String(raw.basePath)), 'utf8'))
    : raw.base;
const field = args.get('field') ?? 'horse';
if (field !== 'horse' && field !== 'human') throw Error('--field must be horse or human');
const { runTournamentLeague, TOURNAMENT_LEAGUE_OBJECTIVES } =
  await import('./HorseTournamentLeague.js');
const { HUMAN_CALIBRATED_POPULATION_ID } = await import('./HumanCalibratedPopulation.js');
const objective = args.get('objective') as (typeof TOURNAMENT_LEAGUE_OBJECTIVES)[number];
if (!TOURNAMENT_LEAGUE_OBJECTIVES.includes(objective)) throw Error('Unknown --objective');
const started = new Date().toISOString();
const result = await runTournamentLeague({
  objective,
  seed: int('seed'),
  firstPair: int('first-pair', 0),
  pairs: int('pairs'),
  switchCard: {
    name: String(raw.name),
    variant: raw.variant as never,
    flag: String(raw.flag),
    base,
    ...(raw.candidateValue !== undefined ? { candidateValue: raw.candidateValue as boolean } : {}),
    ...(raw.startingStacks !== undefined ? { startingStacks: raw.startingStacks as never } : {}),
  },
  ...(field === 'human' ? { opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID } : {}),
});
await writeFile(
  resolve(args.get('out')!),
  JSON.stringify(
    {
      schema: 'horse-tournament-switch-result-v1',
      started,
      finished: new Date().toISOString(),
      cardFile: cardPath,
      field,
      result,
    },
    null,
    1
  ) + '\n',
  { flag: 'wx' }
);
const s = result.switchSummary!;
console.log(
  `[switch-card] ${result.switchCard!.name} ${objective} ${field} seed ${result.seed} pairs ${result.pairs}/${result.requestedPairs}: ` +
    `funded return A-B ${s.fundedReturn.mean.toFixed(5)} (se ${s.fundedReturn.standardError.toFixed(5)}), ` +
    `prize share ${s.prizeShare.mean.toFixed(5)} (se ${s.prizeShare.standardError.toFixed(5)}), ` +
    `changed ${s.changedDecisions}/${s.decisionsCompared}; illegal ${result.illegalActions}, ` +
    `conservation ${result.conservationErrors}, truncated ${result.truncatedHands}`
);
process.exit(0);
