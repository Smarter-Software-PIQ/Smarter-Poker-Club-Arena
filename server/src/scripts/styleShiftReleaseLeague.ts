/**
 * STYLE SHIFT RELEASE IS NOISE-AWARE (2026-11-21): the off-card measurements of the option
 * styleShiftReleaseIsNoiseAware (docs/horse-option-authority.d/styleShiftReleaseIsNoiseAware.md). The on-card ones
 * are horseLeagueCard.ts cards (flh_style_release_noise_aware_steal_vs_value_only_blinds,
 * human_nlh_style_release_noise_aware).
 *
 *   cd server
 *   npx tsx src/scripts/styleShiftReleaseLeague.ts --part=omaha --seed=20261120 --pairs=6000
 *   npx tsx src/scripts/styleShiftReleaseLeague.ts --part=gear --seed=20261120 --pairs=3000
 *
 * omaha: the PLO4 development field (HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID, kept off the nightly card by
 * HorseLeagueSpotConditioned.test.ts), six seats, the live cash Hybrid persona with the deal-seeded mood clock, a with
 * the option, b without, through the league's own runMatchup (a human-field card: one sandbox per arm, the process
 * switch set per pass by withLeagueProcessSwitches).
 *
 * gear: the harm control, opponents that really change gear (StyleReadLeagueField: lp_time_shifter alternates the
 * selective and the maniac shape every 200 of its hands; lp_tight_image is tight for 150 hands, then barrels and
 * raises rivers with air) through ExploiterLeague's cell against production Horses, the whole cell run once with the
 * process switch off and once on, same seed and deals. Reported: the opponent's bb/100 against the Horses in each run
 * (lower is better for the Horses) and the difference, with the standard error of two independent runs (the runs
 * share their deals, so this overstates the error), and the receipts of the noise-aware rule.
 *
 * Development measurement only: no database, no scheduler, no writer.
 */
process.env.EQUITY_GOVERNOR = 'off';
process.env.SUPABASE_URL = 'https://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'style-shift-release-offline-placeholder';

const args = new Map(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string])
);
const part = args.get('part');
const seed = Number(args.get('seed') ?? 20261120);
const pairs = Number(args.get('pairs') ?? 1000);
if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(pairs) || pairs < 1)
  throw new Error('--seed and --pairs are whole numbers');

const z = (m: number, se: number) => (se > 0 ? (m / se).toFixed(2) : 'n/a');

if (part === 'omaha') {
  const { runMatchup } = await import('../benchmark/HorseLeague.js');
  const { HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID } =
    await import('../benchmark/HorseLeagueHumanField.js');
  const r = await runMatchup(
    {
      name: 'plo4_style_release_noise_aware_vs_omaha_dev_field',
      variant: 'plo4',
      seats: 6,
      pairs,
      hybridBaseline: true,
      moodClock: 'deal_seed',
      a: { styleShiftReleaseIsNoiseAware: true },
      b: {},
      opponentPopulation: HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID,
    },
    pairs,
    seed
  );
  console.log(
    `omaha seed=${seed} pairs=${pairs} bb100=${r.bb100.toFixed(2)} stderr=${r.stderr.toFixed(2)} ` +
      `z=${z(r.bb100, r.stderr)} diverged=${r.divergentPairs} illegal=${r.illegalActions}`
  );
  console.log(`RESULT_JSON ${JSON.stringify({ part, seed, pairs, result: r })}`);
} else if (part === 'gear') {
  const { runExploiterCell } = await import('../benchmark/ExploiterLeague.js');
  const { styleLeagueField } = await import('../benchmark/StyleReadLeagueField.js');
  const { HorseMind } = await import('../engine/HorseMind.js');
  const BT = await import('../engine/BrainTelemetry.js');
  BT.enableBrainTelemetry();
  for (const name of ['lp_time_shifter', 'lp_tight_image']) {
    const runs: Record<string, { bb100: number; se: number; fires: Record<string, number> }> = {};
    for (const on of [false, true]) {
      BT.drainFires();
      HorseMind.setStyleShiftReleaseIsNoiseAware(on);
      try {
        const r = await runExploiterCell({
          exploiter: 'reg_tag',
          variant: 'nlh',
          seats: 6,
          stackBB: 100,
          pairs,
          seed,
          memory: 'on',
          horseOpts: {},
          policy: styleLeagueField()[name],
        });
        const fires: Record<string, number> = {};
        for (const f of BT.drainFires())
          if (f.feature.startsWith('style_shift_noise_aware')) fires[f.feature] = f.fires;
        runs[on ? 'on' : 'off'] = { bb100: r.exploiterBb100, se: r.exploiterSe, fires };
      } finally {
        HorseMind.setStyleShiftReleaseIsNoiseAware(false);
      }
    }
    const d = runs.on!.bb100 - runs.off!.bb100;
    const se = Math.hypot(runs.on!.se, runs.off!.se);
    console.log(
      `gear ${name} seed=${seed} pairs=${pairs} opponent bb/100 off=${runs.off!.bb100.toFixed(2)} +/- ` +
        `${runs.off!.se.toFixed(2)} on=${runs.on!.bb100.toFixed(2)} +/- ${runs.on!.se.toFixed(2)} ` +
        `on-off=${d.toFixed(2)} +/- ${se.toFixed(2)} z=${z(d, se)} receipts(on)=${JSON.stringify(runs.on!.fires)}`
    );
  }
} else {
  throw new Error('--part=omaha or --part=gear');
}
process.exit(0);
export {};
