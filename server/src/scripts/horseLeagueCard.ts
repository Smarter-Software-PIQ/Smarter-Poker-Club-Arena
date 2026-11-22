/**
 * Deal ONE league card from the command line and print its result block.
 *
 *   cd server
 *   npx tsx src/scripts/horseLeagueCard.ts --card=nlh_hu_postflop_balance --seed=20261120 --pairs=600
 *   npx tsx src/scripts/horseLeagueCard.ts --card=<name> --seed=1,2,3      (one full run per seed)
 *   npx tsx src/scripts/horseLeagueCard.ts --card=<name> --seed=1,2,3 --hydrate-solver-stores
 *   npx tsx src/scripts/horseLeagueCard.ts --list
 *
 * The card is looked up by exact name in LEAGUE_MATCHUPS, then in
 * DEVELOPMENT_LEAGUE_CARDS (cards the nightly never deals, e.g. the Omaha
 * development field's and Hold'em blanket-off candidates), and passed, as it
 * is declared, to the league's own runMatchup(matchup, pairs, seed): the
 * function the nightly compute worker calls for every card. An unknown name is
 * refused; a name in UNMEASURABLE_MATCHUPS is refused with its recorded reason.
 *
 * Development measurement only. Nothing is ever written to horse_league_results.
 * By default no database is contacted and the solver stores stay EMPTY (the
 * block prints their counts). Pass --hydrate-solver-stores (with SUPABASE_URL
 * and SUPABASE_SERVICE_ROLE_KEY in the environment) to hydrate GTO charts,
 * postflop and V31 stores read-only before dealing, matching
 * HorseLeagueComputeWorker.ts. The equity governor is off, as in the nightly
 * worker. Arguments, refusals and the block: ../benchmark/HorseLeagueCard.ts.
 */
process.env.EQUITY_GOVERNOR = 'off';
import { execFileSync } from 'node:child_process';
import {
  LeagueCardRefusal,
  formatLeagueCardResult,
  hydrateLeagueCardSolverStores,
  leagueCardPairs,
  leagueCardVerdict,
  parseLeagueCardArgs,
  pooledLeagueCardSeeds,
  resolveLeagueCard,
} from '../benchmark/HorseLeagueCard.js';

function engineRevision(): string {
  const fromEnv = process.env.GIT_COMMIT_SHA?.trim() || process.env.ENGINE_VERSION?.trim();
  if (fromEnv) return fromEnv;
  try {
    const git = (args: string[]): string =>
      execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const sha = git(['rev-parse', 'HEAD']);
    // Engine source only: a changed doc does not change what was measured.
    const dirty = git(['status', '--porcelain', '--', 'src']).length > 0;
    return dirty ? `${sha} +uncommitted changes under server/src` : sha;
  } catch {
    return 'UNKNOWN (not a git checkout and GIT_COMMIT_SHA is unset)';
  }
}

try {
  const args = parseLeagueCardArgs(process.argv.slice(2));
  if (args.hydrateSolverStores) {
    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key || url === 'https://supabase.invalid') {
      throw new LeagueCardRefusal(
        'REFUSED: --hydrate-solver-stores requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment'
      );
    }
  } else {
    process.env.SUPABASE_URL = 'https://supabase.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'horse-league-card-offline-placeholder';
  }
  const {
    LEAGUE_MATCHUPS,
    DEVELOPMENT_LEAGUE_CARDS,
    UNMEASURABLE_MATCHUPS,
    leagueResultConfig,
    runMatchup,
  } = await import('../benchmark/HorseLeague.js');
  if (args.list) {
    console.log(`dealable (${LEAGUE_MATCHUPS.length}):`);
    for (const m of LEAGUE_MATCHUPS) console.log(`  ${m.name}`);
    console.log(
      `development, dealt by name only, never nightly (${DEVELOPMENT_LEAGUE_CARDS.length}):`
    );
    for (const m of DEVELOPMENT_LEAGUE_CARDS) console.log(`  ${m.name}`);
    console.log(`refused, never dealt (${UNMEASURABLE_MATCHUPS.length}):`);
    for (const u of UNMEASURABLE_MATCHUPS) console.log(`  ${u.name}`);
    process.exit(0);
  }
  const matchup = resolveLeagueCard(
    args.card!,
    [...LEAGUE_MATCHUPS, ...DEVELOPMENT_LEAGUE_CARDS],
    UNMEASURABLE_MATCHUPS
  );
  const pairs = leagueCardPairs(matchup, args.pairs);
  const { prepareTournamentFutureHandFacts } =
    await import('../engine/HorseTournamentFutureHand.js');
  const { gtoChartCount } = await import('../engine/GtoCharts.js');
  const { gtoPostflopCount } = await import('../engine/GtoPostflop.js');
  const { gtoPostflopV31Count } = await import('../engine/GtoPostflopV31.js');
  if (args.hydrateSolverStores) {
    const { loadGtoCharts } = await import('../services/GtoChartLoader.js');
    const { loadGtoPostflop } = await import('../services/GtoPostflopLoader.js');
    const { loadGtoPostflopV31 } = await import('../services/GtoPostflopV31Loader.js');
    const hydrated = await hydrateLeagueCardSolverStores({
      loadCharts: loadGtoCharts,
      loadPostflop: loadGtoPostflop,
      loadPostflopV31: loadGtoPostflopV31,
      getCounts: () => ({
        charts: gtoChartCount(),
        postflop: gtoPostflopCount(),
        postflopV31: gtoPostflopV31Count(),
      }),
    });
    console.log(
      `solver stores hydrated: charts=${hydrated.charts} postflop=${hydrated.postflop} postflopV31=${hydrated.postflopV31}`
    );
  }
  // The nightly worker prepares these before it reports READY.
  prepareTournamentFutureHandFacts();
  const revision = engineRevision();
  const results = [];
  for (const seed of args.seeds) {
    const result = await runMatchup(matchup, pairs, seed);
    results.push(result);
    console.log(
      formatLeagueCardResult({
        matchup,
        configA: leagueResultConfig(matchup, 'a'),
        configB: leagueResultConfig(matchup, 'b'),
        pairs,
        seed,
        result,
        engineRevision: revision,
        solverStores: {
          charts: gtoChartCount(),
          postflop: gtoPostflopCount(),
          postflopV31: gtoPostflopV31Count(),
        },
        equityGovernor: process.env.EQUITY_GOVERNOR ?? 'unset',
      })
    );
    console.log(`RESULT_JSON ${JSON.stringify({ seed, pairs, engineRevision: revision, result })}`);
  }
  const pooled = pooledLeagueCardSeeds(results);
  if (pooled) {
    console.log(
      `=== SEEDS TOGETHER === card: ${matchup.name} seeds: ${args.seeds.join(',')} ` +
        `pairs each: ${pairs} mean bb/100: ${pooled.bb100.toFixed(2)} ` +
        `stderr: ${pooled.stderr.toFixed(2)} ` +
        `z: ${pooled.stderr > 0 ? (pooled.bb100 / pooled.stderr).toFixed(2) : 'n/a'} ` +
        `${leagueCardVerdict({ ...pooled, inert: false })} ` +
        '(mean of the per-seed figures; stderr from the per-seed stderrs, seeds independent)'
    );
  }
  process.exit(0);
} catch (error) {
  if (error instanceof LeagueCardRefusal) {
    console.error(error.message);
    process.exit(2);
  }
  throw error;
}
