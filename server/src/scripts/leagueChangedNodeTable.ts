/**
 * Deal ONE human-field league card with the per-node collector attached and
 * print the table of changed decisions (benchmark/LeagueChangedNodeTable.ts)
 * next to the card's own result.
 *
 *   cd server
 *   npx tsx src/scripts/leagueChangedNodeTable.ts --card=<name> --seed=20261120 --pairs=15000
 *
 * Development measurement only: no database, empty solver stores, the equity
 * governor off, exactly as src/scripts/horseLeagueCard.ts. The observer is
 * read-only, so the card's result is the result horseLeagueCard.ts prints for
 * the same card, seed and size.
 */
export {};
process.env.EQUITY_GOVERNOR = 'off';
process.env.SUPABASE_URL = 'https://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'horse-league-card-offline-placeholder';

const arg = (k: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const card = arg('card');
const seed = Number(arg('seed'));
const pairs = Number(arg('pairs'));
if (!card || !Number.isSafeInteger(seed) || !Number.isSafeInteger(pairs) || pairs <= 0) {
  console.error('usage: leagueChangedNodeTable.ts --card=<name> --seed=<int> --pairs=<int>');
  process.exit(2);
}
const { LEAGUE_MATCHUPS, HUMAN_FIELD_HERO_SEAT, runMatchup } =
  await import('../benchmark/HorseLeague.js');
const { createChangedNodeCollector, formatChangedNodeTable } =
  await import('../benchmark/LeagueChangedNodeTable.js');
const { prepareTournamentFutureHandFacts } = await import('../engine/HorseTournamentFutureHand.js');
prepareTournamentFutureHandFacts();
const matchup = LEAGUE_MATCHUPS.find((m) => m.name === card);
if (!matchup || matchup.opponentPopulation === undefined) {
  console.error(`not a dealable human-field card: ${card}`);
  process.exit(2);
}
const c = createChangedNodeCollector(HUMAN_FIELD_HERO_SEAT);
const r = await runMatchup(matchup, pairs, seed, () => true, c.observer);
const t = c.table();
console.log(
  `card ${card} seed ${seed} pairs ${pairs}: bb/100 ${r.bb100.toFixed(4)} +/- ${r.stderr.toFixed(4)}` +
    `, divergent ${r.divergentPairs}, illegal ${r.illegalActions}, truncated ${r.truncatedStreets}` +
    `, fallbacks ${r.brainExceptionFallbacks}`
);
console.log(formatChangedNodeTable(t));
console.log(
  `JSON ${JSON.stringify({ card, seed, pairs, bb100: r.bb100, stderr: r.stderr, divergentPairs: r.divergentPairs, table: t })}`
);
process.exit(0);
