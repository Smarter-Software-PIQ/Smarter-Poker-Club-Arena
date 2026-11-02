import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const native = parse(readFileSync('.github/workflows/component-fixture-native-smoke.yml', 'utf8'));
const trusted =
  "github.repository_owner == 'Smarter-Software-PIQ' && github.repository_id == '1132369872'";
const recovery = " && vars.CA_REQUIRED_NATIVE_PROFILE == 'large'";
const expression = (standard: string) =>
  '$' + '{{ ' + trusted + recovery + " && 'ca-linux-8core' || '" + standard + "' }}";
const accountingRoute = '$' + "{{ matrix.shard == 2 && 'ubuntu-24.04' || 'ubuntu-latest' }}";
const jobs = [
  ['accounting_postgres', ci.jobs.accounting_postgres, accountingRoute],
  ['server_shards', ci.jobs.server_shards, 'ubuntu-latest'],
  ['native-smoke', native.jobs['native-smoke'], 'ubuntu-24.04'],
] as const;

const frameCoverSteps = [
  {
    name: 'Weekly cash boundaries keep original rows and use the frame cover',
    if: 'matrix.shard == 2',
    env: { PG_BIN: '/usr/lib/postgresql/17/bin' },
    run: 'python3 -B scripts/ci/test-weekly-pending-funding-index-postgres.py --pg-bin "$PG_BIN" --scratch "${{ runner.temp }}" --candidate supabase/migrations/20261031081522_cover_original_cash_boundary_transaction_frames.sql --output "${{ runner.temp }}/weekly-pending-funding-index.json"',
  },
  {
    name: 'Retain weekly pending funding index qualification',
    if: 'always() && matrix.shard == 2',
    uses: 'actions/upload-artifact@v4',
    with: {
      name: 'weekly-pending-funding-index-${{ github.run_id }}-${{ github.run_attempt }}',
      path: '${{ runner.temp }}/weekly-pending-funding-index.json',
      'if-no-files-found': 'error',
    },
  },
];

const normalizeFrameCoverAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const start = job.steps.findIndex((step) => step.name === frameCoverSteps[0].name);
  for (const step of frameCoverSteps) {
    expect(job.steps.filter((actual) => actual.name === step.name)).toHaveLength(1);
  }
  expect(job.steps[start - 1]?.name).toBe(
    'Weekly linked proofs preserve original windows and paid books'
  );
  expect(job.steps.slice(start, start + 2)).toStrictEqual(frameCoverSteps);
  expect(job.steps[start + 2]?.name).toBe(
    'Cash horses use bankroll eligibility and table closure preserves seats'
  );
  // Strip only the exact, separately enforced addition; retain every prior pin.
  job.steps.splice(start, 2);
};

const postpaidQualityStep = {
  name: 'Paid weekly books qualify statements before replaying cash checks',
  if: 'matrix.shard == 1',
  run: 'set -o pipefail\nmkdir -p artifacts/weekly-payout-owned-pause\npython3 -B scripts/ci/test-weekly-postpaid-quality-postgres.py --repo . --candidate-source scripts/ci/fixtures/weekly-postpaid-quality/after-scope.json --before-source scripts/ci/fixtures/weekly-postpaid-quality/before-scope.json --prepare-source scripts/ci/fixtures/weekly-postpaid-quality/prepare.sql --catalog scripts/ci/fixtures/weekly-postpaid-quality/actual-owners.json --pg-bin /usr/lib/postgresql/17/bin --scratch "$RUNNER_TEMP" --output artifacts/weekly-payout-owned-pause/postpaid-quality.json\npython3 -B scripts/ci/test-weekly-postpaid-discovery-postgres.py --repo . --before-scope scripts/ci/fixtures/weekly-postpaid-quality/before-scope.json --after-scope scripts/ci/fixtures/weekly-postpaid-quality/after-scope.json --before-eligible scripts/ci/fixtures/weekly-postpaid-quality/before-discovery.sql --after-eligible scripts/ci/fixtures/weekly-postpaid-quality/after-discovery.sql --pg-bin /usr/lib/postgresql/17/bin --scratch "$RUNNER_TEMP" --output artifacts/weekly-payout-owned-pause/postpaid-discovery.json\npython3 -B scripts/ci/test-weekly-postpaid-migration-postgres.py --candidate supabase/migrations/20261031162838_qualify_paid_weekly_statement_evidence_before_replaying_cash.sql --owners scripts/ci/fixtures/weekly-postpaid-quality/actual-owners.json --discovery scripts/ci/fixtures/weekly-postpaid-quality/actual-discovery-owners.json --pg-bin /usr/lib/postgresql/17/bin --scratch "$RUNNER_TEMP" --output artifacts/weekly-payout-owned-pause/postpaid-migration.json\n',
};

const normalizePostpaidQualityAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const start = job.steps.findIndex((step) => step.name === postpaidQualityStep.name);
  expect(job.steps.filter((step) => step.name === postpaidQualityStep.name)).toHaveLength(1);
  expect(job.steps[start - 1]?.name).toBe(
    'Original weekly financial rounds wait for the concurrent physical fleet ACK'
  );
  // Exact shape rejects added env/continue-on-error as well as changed commands.
  expect(job.steps[start]).toStrictEqual(postpaidQualityStep);
  expect(job.steps[start + 1]?.name).toBe('Preserve original weekly payout qualification evidence');
  job.steps.splice(start, 1);
};

const mysteryAwardOrderStep = {
  name: 'Mystery award pages retain every tied reveal exactly once',
  if: 'matrix.shard == 2',
  env: { PG_BIN: '/usr/lib/postgresql/17/bin' },
  run: 'python3 -B scripts/ci/test-mystery-award-page-order.py --pg-bin "$PG_BIN" --scratch "${{ runner.temp }}"',
};

const normalizeMysteryAwardOrderAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const start = job.steps.findIndex((step) => step.name === mysteryAwardOrderStep.name);
  expect(job.steps.filter((step) => step.name === mysteryAwardOrderStep.name)).toHaveLength(1);
  expect(job.steps[start]).toStrictEqual(mysteryAwardOrderStep);
  expect(job.steps[start + 1]?.name).toBe(
    'Weekly linked proofs preserve original windows and paid books'
  );
  // Enforce the exact new gate before retaining all historical workflow pins.
  job.steps.splice(start, 1);
};

const scheduleRequestStep = {
  name: 'Schedule creates retain their original request receipt',
  if: 'matrix.shard == 3',
  env: { PG_BIN: '/usr/lib/postgresql/17/bin' },
  run: 'python3 -B scripts/ci/test-schedule-request.py --work-root "${{ runner.temp }}" --output artifacts/schedule-request',
};
const normalizeScheduleRequestAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const index = job.steps.findIndex((step) => step.name === scheduleRequestStep.name);
  expect(job.steps.filter((step) => step.name === scheduleRequestStep.name)).toHaveLength(1);
  expect(job.steps[index - 1]?.name).toBe('A schedule keeps its time zone across daylight saving');
  expect(job.steps[index]).toStrictEqual(scheduleRequestStep);
  expect(job.steps[index + 1]?.name).toBe('Every Diamond SQL acceptance runner is listed');
  job.steps.splice(index, 1);
};

const tournamentCreateRequestStep = {
  name: 'Tournament creates retain their original request receipt',
  if: 'matrix.shard == 3',
  env: { PG_BIN: '/usr/lib/postgresql/17/bin' },
  run: 'python3 -B scripts/ci/test-tournament-create-request.py --work-root "${{ runner.temp }}" --output artifacts/tournament-create-request',
};
const normalizeTournamentCreateRequest = (job: { steps: Array<Record<string, unknown>> }) => {
  const index = job.steps.findIndex((step) => step.name === tournamentCreateRequestStep.name);
  expect(job.steps.filter((step) => step.name === tournamentCreateRequestStep.name)).toHaveLength(
    1
  );
  expect(job.steps[index - 1]?.name).toBe(
    'Diamond own hand history admits automatic membership and stays private'
  );
  expect(job.steps[index]).toStrictEqual(tournamentCreateRequestStep);
  expect(job.steps[index + 1]?.name).toBe('A schedule keeps its time zone across daylight saving');
  job.steps.splice(index, 1);
};

const cashDecisionGate = {
  name: 'Cash street decision and board image gate',
  if: "matrix.partition == 'general' && matrix.shard == 1",
  env: { LIVE_TURN_DIST: 'dist' },
  run: 'npx playwright test -c playwright.live-turn.config.ts tests/live-turn/cash-street-decision.pw.ts',
};

const normalizeCashDecisionAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const start = job.steps.findIndex((step) => step.name === cashDecisionGate.name);
  expect(job.steps.filter((step) => step.name === cashDecisionGate.name)).toHaveLength(1);
  expect(job.steps[start - 1]?.name).toBe('Push enrollment opt-in browser gate');
  expect(job.steps[start]).toStrictEqual(cashDecisionGate);
  expect(job.steps[start + 1]?.name).toBe('Stop the shared preview');
  // Validate the exact new browser gate, retaining every historical job hash.
  job.steps.splice(start, 1);
};

const stallProgressStep = {
  name: 'Stall closure requires an exact recorded hand',
  if: 'matrix.shard == 7',
  env: { PG_BIN: '/usr/lib/postgresql/17/bin' },
  run: 'python3 -B scripts/ci/test-stall-progress-proof.py',
};
const normalizeStallProgressAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const index = job.steps.findIndex((step) => step.name === stallProgressStep.name);
  expect(job.steps.filter((step) => step.name === stallProgressStep.name)).toHaveLength(1);
  expect(job.steps[index - 1]?.name).toBe('Retain original Breakfast witness qualification');
  expect(job.steps[index]).toStrictEqual(stallProgressStep);
  expect(job.steps[index + 1]?.name).toBe('Certified V31 PostgreSQL 17 behavior gate');
  // Enforce the exact additional gate, preserving every historical job fingerprint.
  job.steps.splice(index, 1);
};

describe('required CI uses a closed standard hosted capacity recovery', () => {
  for (const [name, job, standard] of jobs) {
    it(name + ' permits only its fixed standard hosted OS', () => {
      expect(job['runs-on']).toBe(standard);
      expect(job['runs-on']).not.toMatch(/ca-linux|self-hosted|vars\./);
    });
  }

  it('preserves all other CI commands, gates, budgets, permissions and client partitions', () => {
    const normalized = structuredClone(ci);
    normalizeStallProgressAddition(normalized.jobs.accounting_postgres);
    // Enforce the exact new reporting regression before retaining all prior job hashes.
    const chicagoStep = {
      name: 'Member statistics use Chicago dates across daylight saving transitions',
      if: 'matrix.shard == 4',
      env: { PG_BIN: '/usr/lib/postgresql/17/bin' },
      run: 'python3 -B scripts/ci/test-member-stats-chicago.py --scratch "$RUNNER_TEMP" --migration supabase/migrations/20261101061213_member_statistics_use_chicago_calendar_boundaries.sql',
    };
    const chicagoSteps = normalized.jobs.accounting_postgres.steps;
    const chicagoIndex = chicagoSteps.findIndex(
      (step: { name: string }) => step.name === chicagoStep.name
    );
    expect(
      chicagoSteps.filter((step: { name: string }) => step.name === chicagoStep.name)
    ).toHaveLength(1);
    expect(chicagoSteps[chicagoIndex]).toStrictEqual(chicagoStep);
    expect(chicagoSteps[chicagoIndex + 1]?.name).toBe(
      'Roster cash preserves funded boundaries and computes each total once'
    );
    chicagoSteps.splice(chicagoIndex, 1);

    normalizeTournamentCreateRequest(normalized.jobs.accounting_postgres);
    // Review the added tournament gate exactly, then retain every existing job pin.
    for (const tournamentStep of [
      {
        name: 'Add-ons wait for the last late-entry level at transition and purchase',
        if: 'matrix.shard == 4',
        env: { PG_BIN: '/usr/lib/postgresql/17/bin' },
        run: 'python3 -B scripts/ci/test-addon-after-entry-levels.py',
      },
      {
        name: 'Only highlighted tournaments may use ten-minute levels',
        if: 'matrix.shard == 4',
        env: { PG_BIN: '/usr/lib/postgresql/17/bin' },
        run: 'python3 -B scripts/ci/test-highlighted-level-clock.py',
      },
    ]) {
      const tournamentSteps = normalized.jobs.accounting_postgres.steps;
      const tournamentIndex = tournamentSteps.findIndex(
        (entry: Record<string, unknown>) => entry.name === tournamentStep.name
      );
      expect(tournamentIndex).toBeGreaterThanOrEqual(0);
      expect(
        tournamentSteps.filter(
          (entry: Record<string, unknown>) => entry.name === tournamentStep.name
        )
      ).toHaveLength(1);
      expect(tournamentSteps[tournamentIndex]).toStrictEqual(tournamentStep);
      tournamentSteps.splice(tournamentIndex, 1);
    }

    const accounting = normalized.jobs.accounting_postgres;
    expect(accounting.strategy).toEqual({
      'fail-fast': false,
      matrix: { shard: [1, 2, 3, 4, 5, 6, 7] },
    });
    expect(accounting.name).toBe(
      'Accounting transactions (PostgreSQL 17) shard $' + '{{ matrix.shard }}/7'
    );
    accounting.strategy.matrix.shard = [1, 2, 3, 4];
    accounting.name = 'Accounting transactions (PostgreSQL 17) shard $' + '{{ matrix.shard }}/4';
    for (const [name, from, to] of [
      ['Weekly recompute commits bounded parts and preserves real payouts', 2, 5],
      ['Retain exact weekly recompute qualification', 2, 5],
      ['Full weekly accounting activation, rollback and concurrent authority', 2, 6],
      ['Preserve weekly accounting qualification evidence', 2, 6],
      ['Certified V31 PostgreSQL 17 behavior gate', 4, 7],
    ] as const) {
      const selected = accounting.steps.filter((step: { name: string }) => step.name === name);
      expect(selected).toHaveLength(1);
      expect(selected[0].if.match(/matrix\.shard == \d/g)).toEqual(['matrix.shard == ' + to]);
      selected[0].if = selected[0].if.replace('matrix.shard == ' + to, 'matrix.shard == ' + from);
    }
    const installers = accounting.steps.filter(
      (step: { name: string }) =>
        step.name === 'Install PostgreSQL 17 tools without a default database service'
    );
    expect(installers).toHaveLength(1);
    expect(createHash('sha256').update(JSON.stringify(installers[0])).digest('hex')).toBe(
      'b0961ac4782f86fbf4158a3eb0d3d3a6d650ae86d662a4bd4d73b552849d37dd'
    );
    const newInstallCase =
      '  5|6|7)\n    # Isolated weekly recompute, full weekly activation and V31 use\n    # the common PG17 tools; no native compiler or fixture builder.\n    # The shared install/readiness check below retains pg_cron,\n    # including the full weekly activation fixture on shard 6.\n    ;;\n';
    expect(installers[0].run.split(newInstallCase)).toHaveLength(2);
    installers[0].run = installers[0].run.replace(newInstallCase, '');
    // Normalize only reviewed routing changes; the existing whole-job hashes
    // still enforce every command, assertion, timeout, artifact and ordering.
    const remappedSteps = [
      ['Backed payout discovery preserves every conservation term', 'matrix.shard == 4'],
      ['Every Diamond SQL acceptance runner is listed', 'matrix.shard == 3'],
      ['Diamond Arena SQL acceptance on the isolated fixture', 'matrix.shard == 3'],
      [
        'Retain Diamond SQL acceptance evidence',
        'always() && matrix.shard == 3 && contains(fromJSON(["success", "failure", "cancelled"]), steps.diamond_sql_acceptance.outcome)',
      ],
    ];
    for (const [name, previous] of remappedSteps) {
      const selected = normalized.jobs.accounting_postgres.steps.filter(
        (s: { name: string }) => s.name === name
      );
      expect(selected).toHaveLength(1);
      const oldCondition =
        name === 'Retain Diamond SQL acceptance evidence'
          ? `always() && matrix.shard == 3 && contains(fromJSON('["success", "failure", "cancelled"]'), steps.diamond_sql_acceptance.outcome)`
          : previous;
      expect(selected[0].if).toBe(
        oldCondition.replace(
          /matrix.shard == [34]/,
          name === 'Backed payout discovery preserves every conservation term'
            ? 'matrix.shard == 3'
            : 'matrix.shard == 2'
        )
      );
      selected[0].if = oldCondition;
    }
    for (const name of [
      'Chip journal transactions survive failures and replays',
      'Evaluate fleet throughput against live dealing capacity',
    ]) {
      const selected = normalized.jobs.typecheck_compile.steps.filter(
        (s: { name: string }) => s.name === name
      );
      expect(selected).toHaveLength(1);
      const previous = name.startsWith('Chip journal')
        ? "steps.compile_scope.outputs.instructions_only != 'true' && steps.compile_scope.outputs.presentation_only != 'true'"
        : "steps.compile_scope.outputs.presentation_only != 'true'";
      expect(selected[0].if).toBe(
        previous.replace('presentation_only', 'isolated_simulations_unchanged')
      );
      selected[0].if = previous;
    }
    // Pin the entire reviewed producer and transfer pair before reconstructing
    // the former browser shape. The historical job hash still protects every
    // original build command, browser assertion, timeout and step ordering.
    const browserBuild = normalized.jobs['css-beats-build'];
    const browserJob = normalized.jobs['css-beats-e2e'];
    normalizeCashDecisionAddition(browserJob);
    const exactHash = (value: unknown) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex');
    expect(exactHash(browserBuild)).toBe(
      '1d75a0c1c211190a532d247c4f6009f2c876ffe0f0775465ab0732f4005462bc'
    );
    expect(browserJob.needs).toEqual(['changes', 'css-beats-build']);
    browserJob.needs = 'changes';
    const transferNames = ["Download this run's browser build", "Verify this run's browser build"];
    for (const name of transferNames)
      expect(browserJob.steps.filter((step: { name: string }) => step.name === name)).toHaveLength(
        1
      );
    const transferStart = browserJob.steps.findIndex(
      (step: { name: string }) => step.name === transferNames[0]
    );
    expect(
      browserJob.steps
        .slice(transferStart, transferStart + 2)
        .map((step: { name: string }) => step.name)
    ).toEqual(transferNames);
    expect(exactHash(browserJob.steps.slice(transferStart, transferStart + 2))).toBe(
      'ff193edb18cbf4c4ddc745ada4cac0d08e589b177afc226b5e40b0b647aadc15'
    );
    browserJob.steps.splice(transferStart, 2);
    for (const name of ['Cache optimized dist media', 'Build this commit']) {
      const selected = browserJob.steps.filter((step: { name: string }) => step.name === name);
      expect(selected).toHaveLength(1);
      expect(selected[0].if).toBe("needs.changes.outputs.server != 'true'");
      delete selected[0].if;
    }
    delete normalized.jobs['css-beats-build'];
    normalizeScheduleRequestAddition(normalized.jobs.accounting_postgres);
    normalizeMysteryAwardOrderAddition(normalized.jobs.accounting_postgres);
    normalizeFrameCoverAddition(normalized.jobs.accounting_postgres);
    normalizePostpaidQualityAddition(normalized.jobs.accounting_postgres);
    const formerClientRoute = '$' + '{{ ' + trusted + " && 'ca-linux-4core' || 'ubuntu-latest' }}";
    const intendedRoutes = {
      typecheck: 'ubuntu-latest',
      unit: 'ubuntu-latest',
      server: 'ubuntu-latest',
      verdict: 'ubuntu-latest',
      'css-beats-gate': 'ubuntu-latest',
      'css-beats-e2e': 'ubuntu-24.04',
      'diamond-playfield-e2e': 'ubuntu-24.04',
    };
    // Assert each authorized route before normalizing just that field. The
    // exhaustive sectional fingerprints protect every command and financial gate.
    for (const [name, route] of Object.entries(intendedRoutes)) {
      expect(normalized.jobs[name]['runs-on'], name).toBe(route);
      normalized.jobs[name]['runs-on'] = formerClientRoute;
    }
    for (const name of ['typecheck_compile', 'unit_shards', 'build']) {
      expect(normalized.jobs[name]['runs-on']).toBe(
        name === 'build' ? 'ubuntu-24.04' : 'ubuntu-latest'
      );
      normalized.jobs[name]['runs-on'] = formerClientRoute;
    }
    for (const name of ['changes', 'source_windows', 'stub_gate']) {
      expect(normalized.jobs[name]['runs-on']).toBe('ubuntu-latest');
      normalized.jobs[name]['runs-on'] = formerClientRoute;
    }
    for (const name of ['live-e2e', 'post-deploy-check']) {
      expect(normalized.jobs[name]['runs-on']).toBe(
        name === 'live-e2e' ? 'ubuntu-24.04' : 'ubuntu-latest'
      );
      normalized.jobs[name]['runs-on'] = formerClientRoute.replace('4core', '8core');
    }
    for (const name of ['accounting_postgres', 'server_shards']) {
      expect(normalized.jobs[name]['runs-on']).toBe(
        name === 'accounting_postgres' ? accountingRoute : 'ubuntu-latest'
      );
      normalized.jobs[name]['runs-on'] = expression('ubuntu-latest');
    }
    expect(normalized.jobs.unit_shards.env.VITEST_MAX_THREADS).toBe(8);
    normalized.jobs.unit_shards.env.VITEST_MAX_THREADS = 4;
    // Ordered inventories plus all non-job fields and every whole job cover the
    // complete reviewed workflow. Unrelated job edits update only their own pin.
    const fingerprint = (value: unknown) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex');
    expect(Object.keys(normalized)).toEqual(['name', 'on', 'concurrency', 'jobs']);
    expect(
      fingerprint(Object.fromEntries(Object.entries(normalized).filter(([key]) => key !== 'jobs')))
    ).toBe('bf371889e58c11a6f6178fd7405b0cb3a484ed6016b88629bc790f4b4ed83d0e');
    const expectedJobs = {
      changes: 'f9d317d1503f4dc8a8945bb2b9238bcfa89b2ea551a970dd23ddb3d531f4a481',
      source_windows: 'a9830648dfc81b5558d0e9a45d75307210fa1535926da65e087f6647e1fa4189',
      stub_gate: '166528cc83e7d0c075c59b6facb1a6782f3e2eda6c334f9608b933319aca9c80',
      fixture_native: '8949ac7f86b74f267efb996eecddb67f8c59f93d3e40a8bc407530ec3b1644ec',
      typecheck: '07758ff6fff680beb77a9e38725eecc5776b94db14cdc3499783c049ce771750',
      typecheck_compile: '88a03bf85dc749608900101f598720ad93c957e5b5bf75791c589c9e25228168',
      unit_shards: 'a694772adb1e9b9c9cf9e8ff24d9a655deb26d18b5d1f191b120ac3b4516c474',
      unit: '69c8c0e64dddf305dd3336a22d977be302c177d26adb4f19a9928efd40fe42a0',
      // Retain both original top-up receipt and funded satellite qualifications.
      // Every other normalized job and prior accounting command is unchanged.
      accounting_postgres: '8fe0309bc5f9c00d2987d02020e9ef6aa0a13eb2dcbcd16ae69e21274d5735a3',
      server_shards: '9b89b7ee75080d4d8b5aafd55d35adf888bd49c30720aa96ad2225bad240ee41',
      server: '086cab96ac6e24b0ced5ab9407a2c406eddfa451de33d6b614953b1f9f94bd1d',
      verdict: 'cbcc5b069cdc625a6fb5a5c23b6a5c6a4ed2c3669f37bf74163c3eea6c5fbd0f',
      build: '1b0ed1fea04c1e6ef74fcde68387787cf36b0fe589539caf71cdfe7e314fa76b',
      'live-e2e': 'fae9db0fd7b5ad3a502a34981574aa5ac43c01d763d2a0c518a7d98572ae796d',
      'post-deploy-check': '86936192ff526aab46d57a6e263e27475c3e60da754b0f04f4948ec40b8b4fcd',
      'css-beats-e2e': '4fc89c871e60dd6d303d87c79e32a25022dc944a772de6b69c919f623f208bbf',
      'diamond-playfield-e2e': '2802fb1377e89b20cfd5dfd89155194bd41921da2b014220040728d27e4d690d',
      'css-beats-gate': '71e08443dc0eee58fbb9055054e02643edbe532aeae3c3073fcf04ae8e35a944',
    };
    expect(Object.keys(normalized.jobs)).toEqual(Object.keys(expectedJobs));
    expect(
      Object.fromEntries(
        Object.entries(normalized.jobs).map(([name, job]) => [name, fingerprint(job)])
      )
    ).toEqual(expectedJobs);
  });
  it('rejects missing, duplicate, displaced or weakened cash decision browser qualification', () => {
    const mutations = [
      (steps: Array<Record<string, unknown>>, start: number) => steps.splice(start, 1),
      (steps: Array<Record<string, unknown>>, start: number) =>
        steps.push(structuredClone(steps[start])),
      (steps: Array<Record<string, unknown>>, start: number) => {
        [steps[start - 1], steps[start]] = [steps[start], steps[start - 1]];
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start].if = "matrix.partition == 'portrait' && matrix.shard == 1";
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start].env = { LIVE_TURN_DIST: 'other-dist' };
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start].run = String(steps[start].run) + ' || true';
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start]['continue-on-error'] = true;
      },
    ];
    for (const mutate of mutations) {
      const job = structuredClone(ci.jobs['css-beats-e2e']);
      const start = job.steps.findIndex(
        (step: Record<string, unknown>) => step.name === cashDecisionGate.name
      );
      mutate(job.steps, start);
      expect(() => normalizeCashDecisionAddition(job)).toThrow();
    }
  });

  it('rejects missing, duplicate, displaced or weakened stall progress qualification', () => {
    const mutations = [
      (steps: Array<Record<string, unknown>>, index: number) => steps.splice(index, 1),
      (steps: Array<Record<string, unknown>>, index: number) =>
        steps.push(structuredClone(steps[index])),
      (steps: Array<Record<string, unknown>>, index: number) => {
        [steps[index], steps[index + 1]] = [steps[index + 1], steps[index]];
      },
      (steps: Array<Record<string, unknown>>, index: number) => {
        steps[index].if = 'false';
      },
      (steps: Array<Record<string, unknown>>, index: number) => {
        steps[index].run = String(steps[index].run) + ' || true';
      },
      (steps: Array<Record<string, unknown>>, index: number) => {
        steps[index]['continue-on-error'] = true;
      },
      (steps: Array<Record<string, unknown>>, index: number) => {
        steps[index].env = { PG_BIN: '/wrong' };
      },
    ];
    for (const mutate of mutations) {
      const job = structuredClone(ci.jobs.accounting_postgres);
      const index = job.steps.findIndex(
        (step: Record<string, unknown>) => step.name === stallProgressStep.name
      );
      mutate(job.steps, index);
      expect(() => normalizeStallProgressAddition(job)).toThrow();
    }
  });

  it('rejects missing, duplicate, displaced or weakened frame cover qualification steps', () => {
    const mutations = [
      (steps: Array<Record<string, unknown>>, start: number) => steps.splice(start, 1),
      (steps: Array<Record<string, unknown>>, start: number) =>
        steps.push(structuredClone(steps[start])),
      (steps: Array<Record<string, unknown>>, start: number) => {
        [steps[start - 1], steps[start]] = [steps[start], steps[start - 1]];
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start].if = 'matrix.shard == 1';
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start].run = String(steps[start].run) + ' || true';
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        (steps[start + 1].with as Record<string, unknown>)['if-no-files-found'] = 'ignore';
      },
    ];
    for (const mutate of mutations) {
      const job = structuredClone(ci.jobs.accounting_postgres);
      const start = job.steps.findIndex(
        (step: Record<string, unknown>) => step.name === frameCoverSteps[0].name
      );
      mutate(job.steps, start);
      expect(() => normalizeFrameCoverAddition(job)).toThrow();
    }
  });
  it('rejects missing, duplicate, displaced or weakened paid-book qualification', () => {
    const mutations = [
      (steps: Array<Record<string, unknown>>, start: number) => steps.splice(start, 1),
      (steps: Array<Record<string, unknown>>, start: number) =>
        steps.push(structuredClone(steps[start])),
      (steps: Array<Record<string, unknown>>, start: number) => {
        [steps[start - 1], steps[start]] = [steps[start], steps[start - 1]];
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start].if = 'false';
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start].env = { SKIP: 'true' };
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start]['continue-on-error'] = true;
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start].run = String(steps[start].run).replace(
          'postpaid-discovery-postgres.py',
          'wrong.py'
        );
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start].run = String(steps[start].run) + 'true\n';
      },
    ];
    for (const mutate of mutations) {
      const job = structuredClone(ci.jobs.accounting_postgres);
      const start = job.steps.findIndex(
        (step: Record<string, unknown>) => step.name === postpaidQualityStep.name
      );
      mutate(job.steps, start);
      expect(() => normalizePostpaidQualityAddition(job)).toThrow();
    }
  });
  it('rejects missing, duplicate, displaced or weakened mystery award qualification', () => {
    const mutations = [
      (steps: Array<Record<string, unknown>>, start: number) => steps.splice(start, 1),
      (steps: Array<Record<string, unknown>>, start: number) =>
        steps.push(structuredClone(steps[start])),
      (steps: Array<Record<string, unknown>>, start: number) => {
        [steps[start], steps[start + 1]] = [steps[start + 1], steps[start]];
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start].if = 'false';
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start].run = String(steps[start].run) + ' || true';
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start]['continue-on-error'] = true;
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start].env = { PG_BIN: '/wrong' };
      },
    ];
    for (const mutate of mutations) {
      const job = structuredClone(ci.jobs.accounting_postgres);
      const start = job.steps.findIndex(
        (step: Record<string, unknown>) => step.name === mysteryAwardOrderStep.name
      );
      mutate(job.steps, start);
      expect(() => normalizeMysteryAwardOrderAddition(job)).toThrow();
    }
  });
  it('rejects missing, duplicate, moved or weakened tournament request qualification', () => {
    const mutations = [
      (steps: Array<Record<string, unknown>>, index: number) => steps.splice(index, 1),
      (steps: Array<Record<string, unknown>>, index: number) =>
        steps.push(structuredClone(steps[index])),
      (steps: Array<Record<string, unknown>>, index: number) => {
        steps[index].if = 'false';
      },
      (steps: Array<Record<string, unknown>>, index: number) => {
        steps[index]['continue-on-error'] = true;
      },
      (steps: Array<Record<string, unknown>>, index: number) => {
        steps[index].run = String(steps[index].run) + ' || true';
      },
      (steps: Array<Record<string, unknown>>, index: number) => {
        [steps[index], steps[index + 1]] = [steps[index + 1], steps[index]];
      },
    ];
    for (const mutate of mutations) {
      const job = structuredClone(ci.jobs.accounting_postgres);
      const index = job.steps.findIndex(
        (step: Record<string, unknown>) => step.name === tournamentCreateRequestStep.name
      );
      mutate(job.steps, index);
      expect(() => normalizeTournamentCreateRequest(job)).toThrow();
    }
  });
  it('rejects a missing, duplicate, moved or weakened schedule request qualification', () => {
    const mutations = [
      (steps: Array<Record<string, unknown>>, index: number) => steps.splice(index, 1),
      (steps: Array<Record<string, unknown>>, index: number) =>
        steps.push(structuredClone(steps[index])),
      (steps: Array<Record<string, unknown>>, index: number) => {
        [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]];
      },
      (steps: Array<Record<string, unknown>>, index: number) => {
        steps[index].if = 'false';
      },
      (steps: Array<Record<string, unknown>>, index: number) => {
        steps[index].run = String(steps[index].run) + ' || true';
      },
      (steps: Array<Record<string, unknown>>, index: number) => {
        steps[index]['continue-on-error'] = true;
      },
    ];
    for (const mutate of mutations) {
      const job = structuredClone(ci.jobs.accounting_postgres);
      const index = job.steps.findIndex(
        (step: Record<string, unknown>) => step.name === scheduleRequestStep.name
      );
      mutate(job.steps, index);
      expect(() => normalizeScheduleRequestAddition(job)).toThrow();
    }
  });
  it('preserves every native qualification stage and cleanup requirement', () => {
    const normalized = structuredClone(native);
    expect(normalized.jobs['native-smoke']['runs-on']).toBe('ubuntu-24.04');
    expect(normalized.on.workflow_call.inputs.connected_ui_observations.default).toBe(false);
    expect(ci.jobs.fixture_native.permissions).toEqual({ contents: 'read', actions: 'read' });
    expect(ci.jobs.fixture_native.secrets).toBeUndefined();
    const job = normalized.jobs['native-smoke'];
    expect(job['timeout-minutes']).toBe('${{ inputs.connected_ui_observations && 120 || 55 }}');
    const budget = new Function('inputs', `return (${job['timeout-minutes'].slice(3, -2)});`);
    expect(budget({ connected_ui_observations: false })).toBe(55);
    expect(budget({})).toBe(55);
    expect(budget({ connected_ui_observations: true })).toBe(120);
    expect(job.steps[1]).toStrictEqual({
      name: 'Admit the fixed unpublished original-input carrier read-only',
      if: 'inputs.connected_ui_observations',
      env: { GH_TOKEN: '${{ github.token }}' },
      run: 'python3 -B operations/release/native/original-web-retention.py --admit',
    });
    const defaultSteps = job.steps.filter(
      (step: { if?: string }) =>
        !step.if ||
        new Function(
          'inputs',
          'always',
          `return (${step.if.replace(/^\$\{\{\s*|\s*\}\}$/g, '')});`
        )({ connected_ui_observations: false }, () => true)
    );
    expect(defaultSteps).toHaveLength(10);
    expect(defaultSteps.slice(2).map((step: { name: string }) => step.name)).toEqual([
      'Native alert intake survives actual process death without duplicate queue submission',
      'Install locked fixture test dependencies on the disposable CI runner',
      'Compile the actual engine for isolated EV actors',
      'Build and qualify logging-only native schema export diagnostics',
      'Check financial route and fixture ownership boundaries',
      'Build exact committed fixture and smoke native services',
      'Preserve sanitized native smoke and cleanup observations',
      "Remove only this job's qualified native diagnostic tool",
    ]);
    // Whole reviewed native workflow identity now includes the guarded manual
    // private-capture branch; every default stage and55m budget is asserted above.
    normalized.jobs['native-smoke']['runs-on'] = expression('ubuntu-24.04');
    expect(createHash('sha256').update(JSON.stringify(normalized)).digest('hex')).toBe(
      '2afca84ef23b1d706aee8fcad336aa6b5f3ddaf4286b4e4dd7179d7d0ad0226c'
    );
  });
});
