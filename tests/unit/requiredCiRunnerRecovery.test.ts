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

const retainedWrapper = 'src/engine/RetainedHistoricalCheckpointQualification.test.ts';
const retainedStep = {
  name: 'Exact retained historical owners qualify before competing workloads',
  if: 'matrix.shard == 1',
  run: `npm test -- ${retainedWrapper}`,
};
const normalizeRetainedOwnerScheduling = (job: { steps: Array<Record<string, unknown>> }) => {
  const index = job.steps.findIndex((step) => step.name === retainedStep.name);
  expect(job.steps.filter((step) => step.name === retainedStep.name)).toHaveLength(1);
  expect(job.steps[index]).toStrictEqual(retainedStep);
  const full = job.steps[index + 1];
  expect(full?.name).toBe('Full server test suite');
  expect(full.run).toBe(
    `[[ "$SERVER_TEST_SHARD" =~ ^[1-4]$ ]]\nnpm test -- --exclude ${retainedWrapper} --shard="$SERVER_TEST_SHARD/4"\n`
  );
  full.run = '[[ "$SERVER_TEST_SHARD" =~ ^[1-4]$ ]]\nnpm test -- --shard="$SERVER_TEST_SHARD/4"\n';
  job.steps.splice(index, 1);
};

const backupSequenceStep = {
  name: 'Backup restore aligns standalone sequence owners',
  if: 'matrix.shard == 4',
  run: 'python3 -B scripts/verification-harness/standby-sequence-owners.py --pg-bin /usr/lib/postgresql/17/bin --scratch-root "${{ runner.temp }}"',
};
const rootInstallStep = {
  name: 'Install root test dependencies',
  run: 'npm ci --ignore-scripts',
};
const normalizeRootInstallAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const index = job.steps.findIndex((step) => step.name === rootInstallStep.name);
  expect(job.steps.filter((step) => step.name === rootInstallStep.name)).toHaveLength(1);
  expect(job.steps[index]).toStrictEqual(rootInstallStep);
  expect(job.steps[index - 1]?.name).toBe('Install server test dependencies');
  // Common setup since 2026-11-07; every other command stays fingerprinted.
  job.steps.splice(index, 1);
};
const normalizeBackupSequenceAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const index = job.steps.findIndex((step) => step.name === backupSequenceStep.name);
  expect(job.steps.filter((step) => step.name === backupSequenceStep.name)).toHaveLength(1);
  expect(job.steps[index]).toStrictEqual(backupSequenceStep);
  expect(job.steps[index + 1]?.name).toBe(
    'Runtime privilege changes preserve the schema DDL boundary'
  );
  // Pin the complete new gate while retaining every prior job fingerprint.
  job.steps.splice(index, 1);
};

const cashQueueFeedbackStep = {
  name: 'Cash queues explain their authoritative admission state',
  if: 'matrix.shard == 1',
  env: { PG_BIN: '/usr/lib/postgresql/17/bin', TMPDIR: '${{ runner.temp }}' },
  run: 'python3 -B scripts/ci/test-cash-queue-feedback-postgres.py',
};
const normalizeCashQueueFeedbackAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const index = job.steps.findIndex((step) => step.name === cashQueueFeedbackStep.name);
  expect(job.steps.filter((step) => step.name === cashQueueFeedbackStep.name)).toHaveLength(1);
  expect(job.steps[index]).toStrictEqual(cashQueueFeedbackStep);
  expect(job.steps[index + 1]?.name).toBe('Cash top-up retries read their original receipt');
  // Enforce the exact added regression, retaining every prior job fingerprint.
  job.steps.splice(index, 1);
};

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

const nov3AttendanceStep = {
  name: 'November 3 zero guarantees preserve separate Horse attendance',
  if: 'matrix.shard == 2',
  env: { PG_BIN: '/usr/lib/postgresql/17/bin' },
  run: 'python3 -B scripts/ci/test-nov3-zero-guarantee-postgres.py --pg-bin "$PG_BIN" --scratch "${{ runner.temp }}"',
};
const normalizeNov3AttendanceAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const index = job.steps.findIndex((step) => step.name === nov3AttendanceStep.name);
  expect(job.steps.filter((step) => step.name === nov3AttendanceStep.name)).toHaveLength(1);
  expect(job.steps[index]).toStrictEqual(nov3AttendanceStep);
  expect(job.steps[index - 1]?.name).toBe(frameCoverSteps[0].name);
  expect(job.steps[index + 1]?.name).toBe(frameCoverSteps[1].name);
  job.steps.splice(index, 1);
};

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

const freeBuyCutoffStep = {
  name: 'Free Buy promo money moves at the cutoff, never at sign-up',
  if: 'matrix.shard == 2',
  env: {
    PG17_BINDIR: '/usr/lib/postgresql/17/bin',
    FREE_BUY_CUTOFF_PG_SCRATCH_PARENT: '${{ runner.temp }}',
  },
  run: 'bash scripts/dev/test-free-buy-cutoff-postgres.sh',
};

const normalizeFreeBuyCutoffAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const start = job.steps.findIndex((step) => step.name === freeBuyCutoffStep.name);
  expect(job.steps.filter((step) => step.name === freeBuyCutoffStep.name)).toHaveLength(1);
  expect(job.steps[start - 1]?.name).toBe(
    'Retired VIP points cannot earn, spend, or mutate historical balances'
  );
  expect(job.steps[start]).toStrictEqual(freeBuyCutoffStep);
  expect(job.steps[start + 1]?.name).toBe(
    'Digest Lightning Funding And Ticket Bounty Native PostgreSQL'
  );
  // Enforce the exact owner acceptance gate before retaining every prior job hash.
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

const lightningHeroCardsGate = {
  name: 'Lightning hero cards gate',
  if: "matrix.partition == 'general' && matrix.shard == 1",
  env: { LIVE_TURN_DIST: 'dist' },
  run: 'npx playwright test -c playwright.live-turn.config.ts tests/live-turn/lightning-hero-cards.pw.ts',
};

const normalizeLightningHeroCardsAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const start = job.steps.findIndex((step) => step.name === lightningHeroCardsGate.name);
  expect(job.steps.filter((step) => step.name === lightningHeroCardsGate.name)).toHaveLength(1);
  expect(job.steps[start - 1]?.name).toBe(cashDecisionGate.name);
  expect(job.steps[start]).toStrictEqual(lightningHeroCardsGate);
  expect(job.steps[start + 1]?.name).toBe('Stop the shared preview');
  // Enforce the exact added browser gate (2026-11-09, a Lightning hero always
  // holds the cards they were dealt), retaining every historical job hash.
  job.steps.splice(start, 1);
};

const tournamentRebuyHeroCardsGate = {
  name: 'Tournament rebuy hero cards gate',
  if: "matrix.partition == 'general' && matrix.shard == 1",
  env: { LIVE_TURN_DIST: 'dist' },
  run: 'npx playwright test -c playwright.live-turn.config.ts tests/live-turn/tournament-rebuy-hero-cards.pw.ts --project=chromium',
};

const normalizeTournamentRebuyHeroCardsAddition = (job: {
  steps: Array<Record<string, unknown>>;
}) => {
  const start = job.steps.findIndex((step) => step.name === tournamentRebuyHeroCardsGate.name);
  expect(job.steps.filter((step) => step.name === tournamentRebuyHeroCardsGate.name)).toHaveLength(
    1
  );
  expect(job.steps[start - 1]?.name).toBe(lightningHeroCardsGate.name);
  expect(job.steps[start]).toStrictEqual(tournamentRebuyHeroCardsGate);
  expect(job.steps[start + 1]?.name).toBe('Stop the shared preview');
  // Enforce the exact added browser gate (2026-11-10, a tournament rebuy is
  // taking a seat again), retaining every historical job hash.
  job.steps.splice(start, 1);
};

const phoneTableLayoutGate = {
  name: 'Phone table bottom row, hero seat and notch gate',
  if: "matrix.partition == 'general' && matrix.shard == 3",
  env: { LIVE_TURN_DIST: 'dist' },
  run: 'npx playwright test -c playwright.live-turn.config.ts tests/live-turn/phone-table-layout.pw.ts --project=chromium',
};

const normalizePhoneTableLayoutAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const start = job.steps.findIndex((step) => step.name === phoneTableLayoutGate.name);
  expect(job.steps.filter((step) => step.name === phoneTableLayoutGate.name)).toHaveLength(1);
  expect(job.steps[start - 1]?.name).toBe(tournamentRebuyHeroCardsGate.name);
  expect(job.steps[start]).toStrictEqual(phoneTableLayoutGate);
  expect(job.steps[start + 1]?.name).toBe('Stop the shared preview');
  // Enforce the exact added browser gate (2026-11-11, the phone table's
  // bottom row, hero seat, action pill and notch), retaining every
  // historical job hash.
  job.steps.splice(start, 1);
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

const tournamentLockSteps = [
  {
    name: 'Receipt replay releases locks and player statistics keep key order',
    id: 'replay_locks_and_player_stats_keys',
    if: 'matrix.shard == 7',
    env: {
      PG_BIN: '/usr/lib/postgresql/17/bin',
    },
    run: 'mkdir -p "$RUNNER_TEMP/replay_locks_and_player_stats_keys"\npython3 -B scripts/qualification/replay-locks-and-player-stats-keys.py \\\n  --work "$RUNNER_TEMP/replay_locks_and_player_stats_keys/cluster" \\\n  --out "$RUNNER_TEMP/replay_locks_and_player_stats_keys/result.json" \\\n  > "$RUNNER_TEMP/replay_locks_and_player_stats_keys/run.log" 2>&1\n',
  },
  {
    name: 'Retain Receipt replay releases locks and player statistics keep key order',
    if: 'always() && matrix.shard == 7 && contains(fromJSON(\'["success", "failure", "cancelled"]\'), steps.replay_locks_and_player_stats_keys.outcome)',
    uses: 'actions/upload-artifact@v4',
    with: {
      name: 'replay_locks_and_player_stats_keys-${{ github.run_id }}-${{ github.run_attempt }}',
      path: '${{ runner.temp }}/replay_locks_and_player_stats_keys/result.json\n${{ runner.temp }}/replay_locks_and_player_stats_keys/run.log\n${{ runner.temp }}/replay_locks_and_player_stats_keys/cluster/pg/postgres.log\n',
      'if-no-files-found': 'error',
      'retention-days': 7,
    },
  },
  {
    name: 'Commission and tournament writers preserve measured lock order',
    id: 'chip_deadlocks',
    if: 'matrix.shard == 7',
    env: {
      PG_BIN: '/usr/lib/postgresql/17/bin',
    },
    run: 'mkdir -p "$RUNNER_TEMP/chip_deadlocks"\npython3 -B scripts/qualification/chip-deadlocks.py \\\n  --work "$RUNNER_TEMP/chip_deadlocks/cluster" \\\n  --out "$RUNNER_TEMP/chip_deadlocks/result.json" \\\n  > "$RUNNER_TEMP/chip_deadlocks/run.log" 2>&1\n',
  },
  {
    name: 'Retain Commission and tournament writers preserve measured lock order',
    if: 'always() && matrix.shard == 7 && contains(fromJSON(\'["success", "failure", "cancelled"]\'), steps.chip_deadlocks.outcome)',
    uses: 'actions/upload-artifact@v4',
    with: {
      name: 'chip_deadlocks-${{ github.run_id }}-${{ github.run_attempt }}',
      path: '${{ runner.temp }}/chip_deadlocks/result.json\n${{ runner.temp }}/chip_deadlocks/run.log\n${{ runner.temp }}/chip_deadlocks/cluster/pg/postgres.log\n',
      'if-no-files-found': 'error',
      'retention-days': 7,
    },
  },
];
const normalizeTournamentLockAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const start = job.steps.findIndex((step) => step.name === tournamentLockSteps[0].name);
  for (const step of tournamentLockSteps)
    expect(job.steps.filter((actual) => actual.name === step.name)).toHaveLength(1);
  expect(job.steps[start - 1]?.name).toBe('Retain original Breakfast witness qualification');
  expect(job.steps.slice(start, start + 4)).toStrictEqual(tournamentLockSteps);
  expect(job.steps[start + 4]?.name).toBe('Stall closure requires an exact recorded hand');
  // Validate only this exact addition before preserving every existing workflow fingerprint.
  job.steps.splice(start, 4);
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

const undrawnSpinSteps = [
  {
    name: 'Undrawn Spin cancellation returns exact gross entries atomically',
    if: 'matrix.shard == 4',
    run: 'python3 -B scripts/ci/test-undrawn-spin-cancellation.py \\\n  --evidence artifacts/undrawn-spin-cancellation \\\n  --work-root "$RUNNER_TEMP/undrawn-spin-work" \\\n  --socket-root "$RUNNER_TEMP/undrawn-spin-socket" \\\n  --pg-bin /usr/lib/postgresql/17/bin\n',
  },
  {
    name: 'Retain undrawn Spin cancellation evidence',
    if: 'always() && matrix.shard == 4',
    uses: 'actions/upload-artifact@v4',
    with: {
      name: 'undrawn-spin-cancellation-${{ github.run_id }}-${{ github.run_attempt }}',
      path: 'artifacts/undrawn-spin-cancellation/',
      'retention-days': 7,
      'if-no-files-found': 'error',
    },
  },
];
const normalizeUndrawnSpinAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const start = job.steps.findIndex((step) => step.name === undrawnSpinSteps[0].name);
  for (const step of undrawnSpinSteps)
    expect(job.steps.filter((actual) => actual.name === step.name)).toHaveLength(1);
  expect(job.steps[start - 1]?.name).toBe(
    'Cancellation admission cannot queue ahead of unrelated hands'
  );
  expect(job.steps.slice(start, start + 2)).toStrictEqual(undrawnSpinSteps);
  expect(job.steps[start + 2]?.name).toBe(
    'Retain cancellation admission and funded rollback evidence'
  );
  job.steps.splice(start, 2);
};

const finishUnionSteps = [
  {
    name: 'Tournament finish leaves the union cash-hand wallet available',
    id: 'finish_union_wallet',
    if: 'matrix.shard == 3',
    env: { PG_BIN: '/usr/lib/postgresql/17/bin' },
    run: 'python3 scripts/ci/test-a-finish-does-not-hold-the-union-wallet.py',
  },
  {
    name: 'Retain finish and cash-hand lock evidence',
    if: 'always() && matrix.shard == 3 && contains(fromJSON(\'["success", "failure", "cancelled"]\'), steps.finish_union_wallet.outcome)',
    uses: 'actions/upload-artifact@v4',
    with: {
      name: 'finish-union-wallet-${{ github.run_id }}-${{ github.run_attempt }}',
      path: 'artifacts/finish-union-wallet-lock/',
      'if-no-files-found': 'error',
      'retention-days': 7,
    },
  },
];
const normalizeFinishUnionAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const start = job.steps.findIndex((step) => step.name === finishUnionSteps[0].name);
  for (const step of finishUnionSteps)
    expect(job.steps.filter((actual) => actual.name === step.name)).toHaveLength(1);
  expect(job.steps[start - 1]?.name).toBe('Atomic departures, ownership, rollback and concurrency');
  expect(job.steps.slice(start, start + 2)).toStrictEqual(finishUnionSteps);
  expect(job.steps[start + 2]?.name).toBe('Accepted eliminations preserve parked source custody');
  job.steps.splice(start, 2);
};

const guaranteeFundingWatchStep = {
  name: "Guarantee funding is watched both ways on production's definitions",
  if: 'matrix.shard == 1',
  env: { PG_BIN: '/usr/lib/postgresql/17/bin', TMPDIR: '${{ runner.temp }}' },
  run: 'python3 -B scripts/ci/test-guarantee-funding-watch.py',
};
const normalizeGuaranteeFundingWatchAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const index = job.steps.findIndex((step) => step.name === guaranteeFundingWatchStep.name);
  expect(job.steps.filter((step) => step.name === guaranteeFundingWatchStep.name)).toHaveLength(1);
  expect(job.steps[index - 1]?.name).toBe(
    'Midway daily bounty freezeout preserves the owner contract'
  );
  expect(job.steps[index]).toStrictEqual(guaranteeFundingWatchStep);
  expect(job.steps[index + 1]?.name).toBe(
    'Owner alerts preserve the actual finding through the real PostgreSQL trigger'
  );
  // Enforce the exact added native gate (owner's full-buy-in guarantee rule,
  // 2026-11-05), preserving every historical job fingerprint.
  job.steps.splice(index, 1);
};

const bountyOnlyFinalTwoStep = {
  name: 'A bounty only PKO ends with two players on native PostgreSQL',
  if: 'matrix.shard == 1',
  env: { PG_BIN: '/usr/lib/postgresql/17/bin', TMPDIR: '${{ runner.temp }}' },
  run: 'python3 -B scripts/ci/test-bounty-only-pko-final-two.py',
};
const normalizeBountyOnlyFinalTwoAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const index = job.steps.findIndex((step) => step.name === bountyOnlyFinalTwoStep.name);
  expect(job.steps.filter((step) => step.name === bountyOnlyFinalTwoStep.name)).toHaveLength(1);
  expect(job.steps[index - 1]?.name).toBe(guaranteeFundingWatchStep.name);
  expect(job.steps[index]).toStrictEqual(bountyOnlyFinalTwoStep);
  expect(job.steps[index + 1]?.name).toBe(
    'Owner alerts preserve the actual finding through the real PostgreSQL trigger'
  );
  // Enforce the exact added native gate (owner rule 2026-11-05: a bounty only
  // PKO ends with two players), preserving every historical job fingerprint.
  job.steps.splice(index, 1);
};

const bountyOnlyFinalTwoWatchStep = {
  name: 'A bounty only final two payout is watched on native PostgreSQL',
  if: 'matrix.shard == 1',
  env: { PG_BIN: '/usr/lib/postgresql/17/bin', TMPDIR: '${{ runner.temp }}' },
  run: 'python3 -B scripts/ci/test-bounty-only-final-two-watch.py',
};
const normalizeBountyOnlyFinalTwoWatchAddition = (job: {
  steps: Array<Record<string, unknown>>;
}) => {
  const index = job.steps.findIndex((step) => step.name === bountyOnlyFinalTwoWatchStep.name);
  expect(job.steps.filter((step) => step.name === bountyOnlyFinalTwoWatchStep.name)).toHaveLength(
    1
  );
  expect(job.steps[index - 1]?.name).toBe(bountyOnlyFinalTwoStep.name);
  expect(job.steps[index]).toStrictEqual(bountyOnlyFinalTwoWatchStep);
  expect(job.steps[index + 1]?.name).toBe(
    'Owner alerts preserve the actual finding through the real PostgreSQL trigger'
  );
  // Enforce the exact added native gate (owner rule 2026-11-05: both final
  // two heads are proven paid), preserving every historical job fingerprint.
  job.steps.splice(index, 1);
};

const sweepGatePendingWorkStep = {
  name: 'The sweep gate reads pending bounty work on native PostgreSQL',
  if: 'matrix.shard == 1',
  env: { PG_BIN: '/usr/lib/postgresql/17/bin', TMPDIR: '${{ runner.temp }}' },
  run: 'python3 -B scripts/ci/test-sweep-gate-pending-bounty-work.py',
};
const normalizeSweepGatePendingWorkAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const index = job.steps.findIndex((step) => step.name === sweepGatePendingWorkStep.name);
  expect(job.steps.filter((step) => step.name === sweepGatePendingWorkStep.name)).toHaveLength(1);
  expect(job.steps[index - 1]?.name).toBe(bountyOnlyFinalTwoWatchStep.name);
  expect(job.steps[index]).toStrictEqual(sweepGatePendingWorkStep);
  expect(job.steps[index + 1]?.name).toBe(
    'Owner alerts preserve the actual finding through the real PostgreSQL trigger'
  );
  // Enforce the exact added native gate (2026-11-06: the per-sweep bounty gate
  // reads pending work, not every marker), preserving every historical job
  // fingerprint.
  job.steps.splice(index, 1);
};

const realtimeReviveRecordedStep = {
  name: 'A realtime revive is recorded on native PostgreSQL',
  if: 'matrix.shard == 1',
  env: { PG_BIN: '/usr/lib/postgresql/17/bin', TMPDIR: '${{ runner.temp }}' },
  run: 'python3 -B scripts/ci/test-realtime-revive-is-recorded.py',
};
const normalizeRealtimeReviveRecordedAddition = (job: {
  steps: Array<Record<string, unknown>>;
}) => {
  const index = job.steps.findIndex((step) => step.name === realtimeReviveRecordedStep.name);
  expect(job.steps.filter((step) => step.name === realtimeReviveRecordedStep.name)).toHaveLength(1);
  expect(job.steps[index - 1]?.name).toBe(sweepGatePendingWorkStep.name);
  expect(job.steps[index]).toStrictEqual(realtimeReviveRecordedStep);
  expect(job.steps[index + 1]?.name).toBe(
    'Owner alerts preserve the actual finding through the real PostgreSQL trigger'
  );
  // Enforce the exact added native gate (2026-11-06: a forced realtime revive
  // is recorded durably), preserving every historical job fingerprint.
  job.steps.splice(index, 1);
};

const heldPlaceTwoStep = {
  name: 'The final two close never dies on a held place two on native PostgreSQL',
  if: 'matrix.shard == 1',
  env: { PG_BIN: '/usr/lib/postgresql/17/bin', TMPDIR: '${{ runner.temp }}' },
  run: 'python3 -B scripts/ci/test-final-two-close-held-place-two.py',
};
const normalizeHeldPlaceTwoAddition = (job: { steps: Array<Record<string, unknown>> }) => {
  const index = job.steps.findIndex((step) => step.name === heldPlaceTwoStep.name);
  expect(job.steps.filter((step) => step.name === heldPlaceTwoStep.name)).toHaveLength(1);
  expect(job.steps[index - 1]?.name).toBe(realtimeReviveRecordedStep.name);
  expect(job.steps[index]).toStrictEqual(heldPlaceTwoStep);
  expect(job.steps[index + 1]?.name).toBe(
    'Owner alerts preserve the actual finding through the real PostgreSQL trigger'
  );
  // Enforce the exact added native gate (2026-11-07: a transiently held
  // finishing place 2 is answered, not raised as 23505, so a bounty only PKO
  // really ends at two), preserving every historical job fingerprint.
  job.steps.splice(index, 1);
};

describe('required CI uses a closed standard hosted capacity recovery', () => {
  for (const [name, job, standard] of jobs) {
    it(name + ' permits only its fixed standard hosted OS', () => {
      expect(job['runs-on']).toBe(standard);
      expect(job['runs-on']).not.toMatch(/ca-linux|self-hosted|vars\./);
    });
  }

  it.each(['missing', 'duplicate', 'reordered', 'skip', 'continue', 'command', 'artifact'])(
    'refuses a %s tournament lock qualification mutation',
    (mutation) => {
      const job = structuredClone(ci.jobs.accounting_postgres);
      const index = job.steps.findIndex(
        (step: { id?: string }) => step.id === 'replay_locks_and_player_stats_keys'
      );
      if (mutation === 'missing') job.steps.splice(index, 1);
      if (mutation === 'duplicate') job.steps.splice(index, 0, structuredClone(job.steps[index]));
      if (mutation === 'reordered')
        [job.steps[index], job.steps[index + 2]] = [job.steps[index + 2], job.steps[index]];
      if (mutation === 'skip') job.steps[index].if = 'false';
      if (mutation === 'continue') job.steps[index]['continue-on-error'] = true;
      if (mutation === 'command') job.steps[index].run = 'true';
      if (mutation === 'artifact') job.steps[index + 1].with['if-no-files-found'] = 'ignore';
      expect(() => normalizeTournamentLockAddition(job)).toThrow();
    }
  );

  it('preserves all other CI commands, gates, budgets, permissions and client partitions', () => {
    const normalized = structuredClone(ci);
    {
      // Moved 2026-11-11 (merge queue, review finding 3): typecheck_compile passes
      // a merge group's own base to its diff gates. Normalize those additions
      // back to the reviewed pull-request form before the pinned hashes below.
      const job = normalized.jobs.typecheck_compile;
      expect(job.env).toEqual({ CA_GATE_BASE: '${{ github.event.merge_group.base_sha }}' });
      delete job.env;
      const bindIndex = job.steps.findIndex(
        (step: { name?: string }) => step.name === 'Bind the merge group base for the diff gates'
      );
      expect(bindIndex).toBeGreaterThan(0);
      expect(job.steps[bindIndex].if).toBe("github.event_name == 'merge_group'");
      job.steps.splice(bindIndex, 1);
      const gateArg = ' ${CA_GATE_BASE:+"$CA_GATE_BASE"}';
      let gateArgs = 0;
      for (const step of job.steps as { run?: string }[]) {
        if (!step.run?.includes(gateArg)) continue;
        gateArgs += step.run.split(gateArg).length - 1;
        step.run = step.run.split(gateArg).join('');
      }
      expect(gateArgs).toBe(8);
    }
    const hostingSteps = normalized.jobs.accounting_postgres.steps.filter(
      (step: { name?: string }) => step.name === 'Data console native PostgreSQL contracts'
    );
    expect(hostingSteps).toHaveLength(1);
    expect(hostingSteps[0].env.GH_TOKEN).toBe('${{ github.token }}');
    // Normalize only the authenticated fixture input; every prior command,
    // permission, assertion and job fingerprint remains independently pinned.
    delete hostingSteps[0].env.GH_TOKEN;
    normalizeTournamentLockAddition(normalized.jobs.accounting_postgres);
    normalizeRootInstallAddition(normalized.jobs.accounting_postgres);
    normalizeBackupSequenceAddition(normalized.jobs.accounting_postgres);
    normalizeCashQueueFeedbackAddition(normalized.jobs.accounting_postgres);
    const leaderboardStep = {
      name: 'Leaderboard snapshot extrema preserve filtered ranking results',
      if: 'matrix.shard == 4',
      env: { PG_BIN: '/usr/lib/postgresql/17/bin' },
      run: 'python3 -B scripts/ci/test-leaderboard-extrema-postgres.py --scratch "${{ runner.temp }}"',
    };
    const leaderboardSteps = normalized.jobs.accounting_postgres.steps;
    const leaderboardIndex = leaderboardSteps.findIndex(
      (step: { name: string }) => step.name === leaderboardStep.name
    );
    expect(
      leaderboardSteps.filter((step: { name: string }) => step.name === leaderboardStep.name)
    ).toHaveLength(1);
    expect(leaderboardSteps[leaderboardIndex]).toStrictEqual(leaderboardStep);
    expect(leaderboardSteps[leaderboardIndex + 1].name).toBe(
      'Retention bounds retained prefixes before accounting guards'
    );
    leaderboardSteps.splice(leaderboardIndex, 1);
    const priorQualificationBudgets = {
      changes: 5,
      source_windows: 6,
      typecheck: 2,
      typecheck_compile: 20,
      unit_shards: 15,
      accounting_postgres: 50,
      server_shards: 40,
      verdict: 2,
      build: 15,
      'live-e2e': 25,
      'css-beats-build': 15,
      'css-beats-e2e': 30,
      'diamond-playfield-e2e': 25,
    };
    for (const [job, prior] of Object.entries(priorQualificationBudgets)) {
      expect(normalized.jobs[job]['timeout-minutes']).toBe(prior * 2);
      normalized.jobs[job]['timeout-minutes'] = prior;
    }
    const keySetup = normalized.jobs.accounting_postgres.steps.find(
      (step: { name?: string }) =>
        step.name === 'Install PostgreSQL 17 tools without a default database service'
    );
    // The install itself is the one shared installer (2026-11-07,
    // .github/actions/install-postgres-17, pinned by
    // tests/postgres-installs-from-one-shared-action.law.test.ts). Normalize
    // exactly those lines back to the reviewed inline install; every other
    // command stays fingerprinted.
    const sharedInstall = [
      '# The one shared install (signed Ubuntu/PGDG sources only, the checkout key,',
      '# bounded retries around every apt call): .github/actions/install-postgres-17.',
      'PG_UBUNTU_MIRROR=true PG_PACKAGES="postgresql-17 postgresql-17-cron ${pg_ci_build_packages[*]-}" \\',
      '  bash .github/actions/install-postgres-17/install.sh',
    ].join('\n');
    expect(keySetup.run.split(sharedInstall)).toHaveLength(2);
    keySetup.run = keySetup.run.replace(
      sharedInstall,
      [
        'sudo python3 scripts/ci/ubuntu-apt-mirror.py',
        'pg_ci_sources="$(mktemp -d "$RUNNER_TEMP/ca-postgres-apt.XXXXXX")"',
        'chmod 755 "$pg_ci_sources"',
        'test -f /etc/apt/sources.list.d/ubuntu.sources',
        'cp /etc/apt/sources.list.d/ubuntu.sources "$pg_ci_sources/ubuntu.sources"',
        'pg_ci_apt=(-o "Dir::Etc::sourcelist=/dev/null" -o "Dir::Etc::sourceparts=$pg_ci_sources")',
        'sudo apt-get "${pg_ci_apt[@]}" update',
        'sudo apt-get "${pg_ci_apt[@]}" install -y --no-install-recommends postgresql-common curl ca-certificates',
        'sudo install -d /usr/share/postgresql-common/pgdg',
        '# The PGDG signing key is installed from the checkout (.github/pgdg); fetching',
        '# it from either PGDG host failed with TLS EOFs before native tests ran.',
        'sudo install -m 0644 "$GITHUB_WORKSPACE/.github/pgdg/apt.postgresql.org.asc" /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc',
        'pg_ci_codename="$(. /etc/os-release && printf \'%s\' "$VERSION_CODENAME")"',
        "printf 'Types: deb\\nURIs: https://apt.postgresql.org/pub/repos/apt\\nSuites: %s-pgdg\\nComponents: main\\nSigned-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc\\n' \\",
        '  "$pg_ci_codename" > "$pg_ci_sources/pgdg.sources"',
        'sudo apt-get "${pg_ci_apt[@]}" update',
        "printf 'create_main_cluster = false\\n' | sudo tee /etc/postgresql-common/createcluster.conf >/dev/null",
        'sudo apt-get "${pg_ci_apt[@]}" install -y --no-install-recommends postgresql-17 postgresql-17-cron ${pg_ci_build_packages[@]+"${pg_ci_build_packages[@]}"}',
      ].join('\n')
    );
    const currentKeyBlock = [
      '# The PGDG signing key is installed from the checkout (.github/pgdg); fetching',
      '# it from either PGDG host failed with TLS EOFs before native tests ran.',
      'sudo install -m 0644 "$GITHUB_WORKSPACE/.github/pgdg/apt.postgresql.org.asc" /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc',
    ].join('\n');
    expect(keySetup.run.split(currentKeyBlock)).toHaveLength(2);
    // Normalize only the exact separately enforced key-source corrections
    // (2026-11-02 package host; 2026-11-07 checkout, pinned by
    // tests/the-postgres-signing-key-comes-from-the-checkout.law.test.ts) back to
    // the original download. Every other command, trust control and workflow
    // fingerprint remains pinned.
    keySetup.run = keySetup.run.replace(
      currentKeyBlock,
      [
        'sudo curl --fail --silent --show-error --location \\',
        '  --output /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \\',
        '  https://www.postgresql.org/media/keys/ACCC4CF8.asc',
      ].join('\n')
    );
    const freezeArmingStep = {
      name: 'The finalized-pool freeze refuses what arming it would refuse',
      if: 'matrix.shard == 1',
      env: { PG_BIN: '/usr/lib/postgresql/17/bin', TMPDIR: '${{ runner.temp }}' },
      run: 'python3 -B scripts/ci/test-finalized-pool-freeze-arming.py',
    };
    const freezeArmingSteps = normalized.jobs.accounting_postgres.steps;
    const freezeArmingIndex = freezeArmingSteps.findIndex(
      (step: { name: string }) => step.name === freezeArmingStep.name
    );
    expect(
      freezeArmingSteps.filter((step: { name: string }) => step.name === freezeArmingStep.name)
    ).toHaveLength(1);
    expect(freezeArmingSteps[freezeArmingIndex]).toStrictEqual(freezeArmingStep);
    expect(freezeArmingSteps[freezeArmingIndex - 1]?.name).toBe(
      'Tournament guarantees include funded bounties'
    );
    expect(freezeArmingSteps[freezeArmingIndex + 1]?.name).toBe(
      'Cash top-up retries read their original receipt'
    );
    // Enforce the exact added freeze proof before retaining the bounty neighbours.
    freezeArmingSteps.splice(freezeArmingIndex, 1);
    const bountyStep = {
      name: 'Tournament guarantees include funded bounties',
      if: 'matrix.shard == 1',
      env: { PG_BIN: '/usr/lib/postgresql/17/bin', TMPDIR: '${{ runner.temp }}' },
      run: 'python3 -B scripts/ci/test-bounty-guarantee-postgres.py',
    };
    const bountySteps = normalized.jobs.accounting_postgres.steps;
    const bountyIndex = bountySteps.findIndex(
      (step: { name: string }) => step.name === bountyStep.name
    );
    expect(
      bountySteps.filter((step: { name: string }) => step.name === bountyStep.name)
    ).toHaveLength(1);
    expect(bountySteps[bountyIndex]).toStrictEqual(bountyStep);
    expect(bountySteps[bountyIndex - 1]?.name).toBe(
      'MTT lobby entries count committed registrations and rebuys'
    );
    expect(bountySteps[bountyIndex + 1]?.name).toBe(
      'Cash top-up retries read their original receipt'
    );
    // Enforce the exact added native gate before checking every prior workflow fingerprint.
    bountySteps.splice(bountyIndex, 1);
    const entriesStep = {
      name: 'MTT lobby entries count committed registrations and rebuys',
      if: 'matrix.shard == 4',
      env: { PG_BIN: '/usr/lib/postgresql/17/bin', TMPDIR: '${{ runner.temp }}' },
      run: 'python3 -B scripts/ci/test-mtt-lobby-entry-counts.py',
    };
    const entrySteps = normalized.jobs.accounting_postgres.steps;
    const entryIndex = entrySteps.findIndex(
      (step: { name: string }) => step.name === entriesStep.name
    );
    expect(
      entrySteps.filter((step: { name: string }) => step.name === entriesStep.name)
    ).toHaveLength(1);
    expect(entrySteps[entryIndex - 1]?.name).toBe(
      'Install PostgreSQL 17 tools without a default database service'
    );
    expect(entrySteps[entryIndex]).toStrictEqual(entriesStep);
    expect(entrySteps[entryIndex + 1]?.name).toBe(
      'Cash top-up retries read their original receipt'
    );
    // Require the exact new native gate before preserving every historical job hash.
    entrySteps.splice(entryIndex, 1);
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
    normalizeHeldPlaceTwoAddition(normalized.jobs.accounting_postgres);
    normalizeRealtimeReviveRecordedAddition(normalized.jobs.accounting_postgres);
    normalizeSweepGatePendingWorkAddition(normalized.jobs.accounting_postgres);
    normalizeBountyOnlyFinalTwoWatchAddition(normalized.jobs.accounting_postgres);
    normalizeBountyOnlyFinalTwoAddition(normalized.jobs.accounting_postgres);
    normalizeGuaranteeFundingWatchAddition(normalized.jobs.accounting_postgres);
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
      // November 7 rebalance (run 42345829378): shard 1 suites with no
      // server-header compile, moved unchanged.
      ['Agent statements isolate clubs and use posted evidence', 1, 6],
      ['Deleted cashier accounts conserve their bank returns', 1, 6],
      ['Cashier withdrawn authority retains original operation receipts', 1, 6],
      ['Cashier statements follow the trade ledger scope and export what is on screen', 1, 6],
      ['Spin expiry lock order and committed refund contracts', 1, 5],
      ['Retain Spin expiry PostgreSQL evidence', 1, 5],
      // November 6 rebalance (run 42338709472): unchanged suites and their
      // evidence steps moved off the 34-minute shard 3 and 25-minute shard 1.
      ['Backed payout discovery preserves every conservation term', 3, 2],
      ['Concurrent hands preserve shared F06 custody lanes', 3, 2],
      ['Retain F06 hand and generation disposition proof', 3, 2],
      ['The accepted actor roster is produced inside the settlement transaction', 3, 6],
      ['Retain accepted actor roster proof', 3, 6],
      ['Superseded horse requests retire only their certified action copy', 3, 6],
      ['Retain superseded horse action proof', 3, 6],
      ['Horse settlement keys compact without losing replay or accounting proof', 3, 5],
      ['Retain horse settlement key compaction proof', 3, 5],
      [
        'Adaptive raw horse facts become exact sufficient statistics after qualified retention',
        3,
        5,
      ],
      ['Retain adaptive raw retirement and consumer proof', 3, 5],
      ['Atomic departures, ownership, rollback and concurrency', 3, 2],
      ['Inventory seal preserves exact rows through bucket continuation', 3, 6],
      ['Retain inventory seal PostgreSQL qualification', 3, 6],
      ['Inventory pages commit before their immutable checkpoint header', 3, 6],
      ['Retain committed-page inventory qualification', 3, 6],
      ['Agent downline rake stays in overseer clubs', 3, 6],
      ['Midway weekly promo pays each eligible club wallet once', 3, 5],
      ['Retain Midway weekly promo native proof', 3, 5],
      ['Initial weekly first week evaluates the calendar once per club', 3, 5],
      ['Retain first week aggregate native transcripts', 3, 5],
      ['Original inventory restoration admits only qualified finite financial evidence', 3, 6],
      ['Retain original inventory restoration qualification', 3, 6],
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
    // Normalize only the reviewed opt-in for the existing source-pinned native
    // isolation builder; every original installer command and budget stays pinned.
    expect(installers[0].env.PG_ISOLATION_TOOLCHAIN).toBe(
      "${{ matrix.shard == 3 && 'true' || 'false' }}"
    );
    delete installers[0].env.PG_ISOLATION_TOOLCHAIN;
    const isolationReadiness = '"${PG_ISOLATION_TOOLCHAIN:-false}" != true && ';
    expect(installers[0].run.split(isolationReadiness)).toHaveLength(2);
    installers[0].run = installers[0].run.replace(isolationReadiness, '');
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
    // A bad booking cannot merge (2026-11-10): one exact added step, pinned
    // here and by tests/operations/owner-window-booking-gate.test.mjs.
    {
      const validStep = {
        name: 'Owner maintenance bookings are valid before they merge',
        env: {
          CI_BASE_SHA:
            '${{ (github.event.pull_request.base.sha || github.event.merge_group.base_sha) }}',
        },
        run:
          'node --test tests/operations/owner-window-booking-gate.test.mjs\n' +
          'node scripts/ci/check-owner-window-booking.mjs\n',
      };
      const steps = normalized.jobs.typecheck_compile.steps;
      const index = steps.findIndex((s: { name: string }) => s.name === validStep.name);
      expect(steps.filter((s: { name: string }) => s.name === validStep.name)).toHaveLength(1);
      expect(steps[index]).toStrictEqual(validStep);
      expect(steps[index - 1].name).toBe('Native fixture gate rejects missing and skipped proof');
      expect(steps[index + 1].name).toBe('Owner maintenance bookings give notice after they merge');
      steps.splice(index, 1);
    }
    // A booking cannot start in the past (2026-11-07): one exact added step,
    // pinned here and by tests/a-booking-cannot-start-in-the-past.law.test.ts.
    {
      const bookingStep = {
        name: 'Owner maintenance bookings give notice after they merge',
        env: {
          CI_BASE_SHA:
            '${{ (github.event.pull_request.base.sha || github.event.merge_group.base_sha) }}',
        },
        run: 'node scripts/ci/check-owner-window-notice-after-merge.mjs',
      };
      const steps = normalized.jobs.typecheck_compile.steps;
      const index = steps.findIndex((s: { name: string }) => s.name === bookingStep.name);
      expect(steps.filter((s: { name: string }) => s.name === bookingStep.name)).toHaveLength(1);
      expect(steps[index]).toStrictEqual(bookingStep);
      expect(steps[index - 1].name).toBe('Native fixture gate rejects missing and skipped proof');
      steps.splice(index, 1);
    }
    // Pin the entire reviewed producer and transfer pair before reconstructing
    // the former browser shape. The historical job hash still protects every
    // original build command, browser assertion, timeout and step ordering.
    const browserBuild = normalized.jobs['css-beats-build'];
    const browserJob = normalized.jobs['css-beats-e2e'];
    normalizePhoneTableLayoutAddition(browserJob);
    normalizeTournamentRebuyHeroCardsAddition(browserJob);
    normalizeLightningHeroCardsAddition(browserJob);
    normalizeCashDecisionAddition(browserJob);
    // Verify the producer-owned identity delta, then compare every retained
    // producer/transfer command against the original reviewed fingerprints.
    expect(browserBuild.outputs).toEqual({
      artifact_name: '${{ steps.browser_build.outputs.artifact_name }}',
    });
    delete browserBuild.outputs;
    const seal = browserBuild.steps.find(
      (step: { name: string }) => step.name === "Seal this run's browser build"
    );
    expect(seal.id).toBe('browser_build');
    delete seal.id;
    const originalArtifactName =
      'browser-harness-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.sha }}';
    expect(seal.env.BROWSER_ARTIFACT_NAME).toBe(originalArtifactName);
    delete seal.env.BROWSER_ARTIFACT_NAME;
    const outputLine =
      `          printf 'artifact_name=%s\\n' "$BROWSER_ARTIFACT_NAME" >> "$GITHUB_OUTPUT"`.trimStart() +
      '\n';
    expect(seal.run.endsWith(outputLine)).toBe(true);
    seal.run = seal.run.slice(0, -outputLine.length);
    const upload = browserBuild.steps.find(
      (step: { uses?: string }) => step.uses === 'actions/upload-artifact@v4'
    );
    expect(upload.with.name).toBe('${{ steps.browser_build.outputs.artifact_name }}');
    upload.with.name = originalArtifactName;
    const guardIndex = browserJob.steps.findIndex(
      (step: { name: string }) => step.name === "Require the producer's browser artifact"
    );
    expect(
      browserJob.steps.filter(
        (step: { name: string }) => step.name === "Require the producer's browser artifact"
      )
    ).toHaveLength(1);
    expect(browserJob.steps[guardIndex]).toEqual({
      name: "Require the producer's browser artifact",
      if: "needs.changes.outputs.server == 'true'",
      env: {
        BROWSER_ARTIFACT_NAME: '${{ needs.css-beats-build.outputs.artifact_name }}',
        EXPECTED_RUN_ID: '${{ github.run_id }}',
        EXPECTED_SHA: '${{ github.sha }}',
      },
      run: 'set -euo pipefail\ntest -n "$BROWSER_ARTIFACT_NAME"\n[[ "$BROWSER_ARTIFACT_NAME" =~ ^browser-harness-${EXPECTED_RUN_ID}-[1-9][0-9]*-${EXPECTED_SHA}$ ]]\n',
    });
    const download = browserJob.steps[guardIndex + 1];
    expect(download.name).toBe("Download this run's browser build");
    expect(download.with.name).toBe('${{ needs.css-beats-build.outputs.artifact_name }}');
    download.with.name = originalArtifactName;
    browserJob.steps.splice(guardIndex, 1);
    const exactHash = (value: unknown) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex');
    // Moved 2026-11-11 (merge queue): the build job also runs for merge_group,
    // its if/CA_BUILD_PURPOSE name that event; nothing else in the job changed.
    expect(exactHash(browserBuild)).toBe(
      'e5524e6e97074ff751fe1a1da7a0a7f4d1797d9a92fdc5e28e3a368655db8644'
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
    const fixedLimitStep = {
      name: 'Fixed-limit blinds and uncapped buy-ins use the original cash owners',
      if: 'matrix.shard == 3',
      env: { PG_BIN: '/usr/lib/postgresql/17/bin' },
      run: 'python3 -B scripts/ci/test-fixed-limit-policy-postgres.py --pg-bin "$PG_BIN" --scratch "${{ runner.temp }}"',
    };
    const accountingSteps = normalized.jobs.accounting_postgres.steps;
    const fixedLimitIndex = accountingSteps.findIndex((step) => step.name === fixedLimitStep.name);
    expect(accountingSteps.filter((step) => step.name === fixedLimitStep.name)).toHaveLength(1);
    expect(accountingSteps[fixedLimitIndex]).toStrictEqual(fixedLimitStep);
    expect(accountingSteps[fixedLimitIndex - 1].name).toBe(
      'Original committed horse turns have an independent complete census'
    );
    expect(accountingSteps[fixedLimitIndex + 1].name).toBe(
      'Runtime privilege changes preserve the schema DDL boundary'
    );
    // Enforce the exact new regression, then retain every historical job pin.
    accountingSteps.splice(fixedLimitIndex, 1);
    expect(normalized.jobs.server_shards['timeout-minutes']).toBe(40);
    normalized.jobs.server_shards['timeout-minutes'] = 25;
    normalizeRetainedOwnerScheduling(normalized.jobs.server_shards);
    normalizeUndrawnSpinAddition(normalized.jobs.accounting_postgres);
    normalizeFinishUnionAddition(normalized.jobs.accounting_postgres);
    normalizeScheduleRequestAddition(normalized.jobs.accounting_postgres);
    normalizeMysteryAwardOrderAddition(normalized.jobs.accounting_postgres);
    normalizeNov3AttendanceAddition(normalized.jobs.accounting_postgres);
    normalizeFrameCoverAddition(normalized.jobs.accounting_postgres);
    normalizePostpaidQualityAddition(normalized.jobs.accounting_postgres);
    normalizeFreeBuyCutoffAddition(normalized.jobs.accounting_postgres);
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
    // The informational report needs only the maintained policy reader. Keep
    // its deadline and every reporting assertion pinned by the original job hash.
    expect(normalized.jobs.verdict.steps[0]).toStrictEqual({
      uses: 'actions/checkout@v4',
      with: { 'sparse-checkout': 'docs/agent-policy', 'sparse-checkout-cone-mode': false },
    });
    delete normalized.jobs.verdict.steps[0].with;
    // Ordered inventories plus all non-job fields and every whole job cover the
    // complete reviewed workflow. Unrelated job edits update only their own pin.
    const fingerprint = (value: unknown) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex');
    expect(Object.keys(normalized)).toEqual(['name', 'on', 'concurrency', 'jobs']);
    expect(
      fingerprint(Object.fromEntries(Object.entries(normalized).filter(([key]) => key !== 'jobs')))
      // Moved 2026-11-11 (merge queue): `on` gains merge_group checks_requested.
    ).toBe('c8518da7c0e1bb0e366b4c6c8868a9fd2bd080edbeffadd2d3789c611602f18c');
    // Moved 2026-11-11 (merge queue): every job gated on the pull request
    // event now also names merge_group and the merge group's base/head SHA;
    // no command, budget, permission or partition changed.
    const expectedJobs = {
      // Moved 2026-11-11 (job-token boundary): `changes` no longer holds
      // actions: write; the cancel moved to retire_superseded, which runs only
      // default-branch code on same-repository pull requests.
      changes: 'b9a459646b7051a1c001fba30bec0ff866ad563fe460961052a13e369b2d56cf',
      retire_superseded: 'fa5219bebe82fd707e0a7f21dac8b96902727de56d63f864986b252a0720425b',
      source_windows: 'a9830648dfc81b5558d0e9a45d75307210fa1535926da65e087f6647e1fa4189',
      stub_gate: '118f1b051bd24a3616cea41a6892985553c577d67f9cb39b2120f3d5a74391ca',
      fixture_native: '5ad4eff1fd198db8bd3f8a95e763496520ddff7c63c0b380afd7a49d4b6a82a6',
      typecheck: '9befab7487852fbbf2c6991d1e7e781c4c5a4391d070ef617dd4dfe193895e61',
      typecheck_compile: '6039cd213a4591c076a1454d4d1ef598d3e8bc0833d63e5c3f1ee7c67d684aaa',
      unit_shards: '2f4cffd8880df0e5826ecc79361500b4dae7da7d23698d7a211772f351863649',
      unit: '7b3caf98ff41bbe5f1e52ff0cb65323b1ec587ed45a768e81de2051bb1906de5',
      // Retain both original top-up receipt and funded satellite qualifications.
      // Every other normalized job and prior accounting command is unchanged.
      accounting_postgres: '82a9796a80bb93a237e323bd3fa46d6f7530212a12d36c1ded09f19dcbf5e486',
      server_shards: '0d259b20866a7d0b2eb6a3245894908e52e210c9852c4b63519086461724ac0f',
      server: '2f21fe942c1e2397520fe372a5b46b95e252bc6276e017f95013a2a24a62d9c1',
      verdict: '51ff5df41add022dc51ea5bcacb648971c4db7b63fd03990b47a99ece3a5c529',
      build: '5d384174da91ace2f98e73648c13fe44208e7cf8d02d79b7e875e5eef458b4b3',
      'live-e2e': 'fae9db0fd7b5ad3a502a34981574aa5ac43c01d763d2a0c518a7d98572ae796d',
      'post-deploy-check': '86936192ff526aab46d57a6e263e27475c3e60da754b0f04f4948ec40b8b4fcd',
      'css-beats-e2e': '3e68cd87692edbdbd19e4700fadd4841af06bc04b59ed970d72420c0e50e802f',
      'diamond-playfield-e2e': '42e350a9ed24cccd9539ca47631848f9022b027839632712c71070531802957e',
      'css-beats-gate': '79747df21d67d09db6eaee0451c2e2cb8befbfdac82fc45c497760bb4d8521f2',
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
      normalizeNov3AttendanceAddition(job);
      const start = job.steps.findIndex(
        (step: Record<string, unknown>) => step.name === frameCoverSteps[0].name
      );
      mutate(job.steps, start);
      expect(() => normalizeFrameCoverAddition(job)).toThrow();
    }
  });
  it('rejects missing, duplicate, displaced or weakened dated attendance qualification', () => {
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
        steps[index].run += ' || true';
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
        (step: Record<string, unknown>) => step.name === nov3AttendanceStep.name
      );
      mutate(job.steps, index);
      expect(() => normalizeNov3AttendanceAddition(job)).toThrow();
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
  it('rejects missing, duplicate or weakened union-finish qualification', () => {
    for (const mutate of [
      (steps: Array<Record<string, unknown>>, start: number) => steps.splice(start, 1),
      (steps: Array<Record<string, unknown>>, start: number) =>
        steps.push(structuredClone(steps[start])),
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start].if = 'false';
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start]['continue-on-error'] = true;
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        steps[start].run = String(steps[start].run) + ' || true';
      },
      (steps: Array<Record<string, unknown>>, start: number) => {
        (steps[start + 1].with as Record<string, unknown>)['if-no-files-found'] = 'ignore';
      },
    ]) {
      const job = structuredClone(ci.jobs.accounting_postgres);
      const start = job.steps.findIndex(
        (step: Record<string, unknown>) => step.name === finishUnionSteps[0].name
      );
      mutate(job.steps, start);
      expect(() => normalizeFinishUnionAddition(job)).toThrow();
    }
  });

  it('preserves every native qualification stage and cleanup requirement', () => {
    const normalized = structuredClone(native);
    {
      // Moved 2026-11-11 (merge queue, review finding 2): the ordinary mode also
      // admits a main merge group. Normalize that clause back to the reviewed form.
      const groupClause =
        "(!inputs.connected_ui_observations && github.event_name == 'merge_group' && " +
        "github.event.merge_group.base_ref == 'refs/heads/main' && " +
        "github.repository == 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena' && " +
        'inputs.source_sha == github.event.merge_group.head_sha) || ';
      const job = normalized.jobs['native-smoke'];
      expect(job.if.split(groupClause)).toHaveLength(2);
      job.if = job.if.replace(groupClause, '');
      // Moved 2026-11-11 (secrets leave repository scope): only the connected
      // mode reads DATABASE_URL, from the main-only ci-main environment; the
      // ordinary and merge-group modes name no environment.
      expect(job.environment).toBe("${{ inputs.connected_ui_observations && 'ci-main' || '' }}");
      delete job.environment;
    }
    expect(normalized.jobs['native-smoke']['runs-on']).toBe('ubuntu-24.04');
    expect(normalized.on.workflow_call.inputs.connected_ui_observations.default).toBe(false);
    expect(ci.jobs.fixture_native.permissions).toEqual({ contents: 'read', actions: 'read' });
    expect(ci.jobs.fixture_native.secrets).toBeUndefined();
    const job = normalized.jobs['native-smoke'];
    const alertInstall = job.steps.findIndex(
      (step: { name?: string }) =>
        step.name === 'Install locked native alert transport dependencies'
    );
    expect(job.steps[alertInstall]).toStrictEqual({
      name: 'Install locked native alert transport dependencies',
      if: '${{ !inputs.connected_ui_observations }}',
      run: 'npm ci --prefix tools/production-alerts-native-wakeup --ignore-scripts --no-audit --no-fund',
    });
    const alertGate = job.steps[alertInstall + 1];
    expect(alertGate).toStrictEqual({
      name: 'Native alert intake survives actual process death without duplicate queue submission',
      if: '${{ !inputs.connected_ui_observations }}',
      env: { TMPDIR: '${{ runner.temp }}' },
      run: 'node --test tools/production-alerts-native-wakeup/state.test.mjs tools/production-alerts-native-wakeup/lifecycle.test.mjs',
    });
    // Qualify the exact additive transport gate, then retain every historical stage/hash.
    alertGate.run = 'node --test tools/production-alerts-native-wakeup/state.test.mjs';
    job.steps.splice(alertInstall, 1);
    expect(job['timeout-minutes']).toBe('${{ inputs.connected_ui_observations && 120 || 55 }}');
    const budget = new Function('inputs', `return (${job['timeout-minutes'].slice(3, -2)});`);
    expect(budget({ connected_ui_observations: false })).toBe(55);
    expect(budget({})).toBe(55);
    expect(budget({ connected_ui_observations: true })).toBe(120);
    expect(job.steps[1].name).toBe('Prepare the current-run original-input transfer directory');
    expect(job.steps[1].if).toBe('inputs.connected_ui_observations');
    expect(job.steps[1].env).toEqual({ RETAINED_ID: '${{ inputs.retained_web_artifact_id }}' });
    expect(job.steps[1].run).toContain('[[ "$RETAINED_ID" =~ ^[1-9][0-9]*$ ]]');
    expect(job.steps[2]).toStrictEqual({
      name: "Receive only the protected caller's current-run original ZIP",
      if: 'inputs.connected_ui_observations',
      uses: 'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
      with: {
        'artifact-ids': '${{ inputs.retained_web_artifact_id }}',
        path: '${{ runner.temp }}/original-web-retention',
        'merge-multiple': true,
      },
    });
    expect(job.steps[3]).toStrictEqual({
      name: 'Admit the fixed original ZIP before private capture or native build',
      if: 'inputs.connected_ui_observations',
      run: 'python3 -B operations/release/native/original-web-retention.py --admit-staged',
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
    // The signing key is installed from the checkout (2026-11-07, pinned by
    // tests/the-postgres-signing-key-comes-from-the-checkout.law.test.ts).
    // Normalize exactly that one line back to the reviewed download; every
    // other byte of the workflow stays fingerprinted.
    // The one shared installer (2026-11-07): normalize its two lines back to
    // the reviewed inline install before the key normalization below.
    const nativeShared = [
      '  # The one shared install (signed sources, checkout key, bounded retries).',
      '  PG_UBUNTU_MIRROR=true PG_PACKAGES=postgresql-client-17 bash .github/actions/install-postgres-17/install.sh',
    ].join('\n');
    const nativeSharedSteps = normalized.jobs['native-smoke'].steps.filter(
      (step: { run?: string }) => step.run?.includes(nativeShared)
    );
    expect(nativeSharedSteps).toHaveLength(1);
    nativeSharedSteps[0].run = nativeSharedSteps[0].run.replace(
      nativeShared,
      [
        '  sudo python3 scripts/ci/ubuntu-apt-mirror.py',
        '  pg_sources="$(mktemp -d "$RUNNER_TEMP/isolated-export-apt.XXXXXX")"',
        '  chmod 755 "$pg_sources"',
        '  cp /etc/apt/sources.list.d/ubuntu.sources "$pg_sources/ubuntu.sources"',
        '  apt_options=(-o "Dir::Etc::sourcelist=/dev/null" -o "Dir::Etc::sourceparts=$pg_sources")',
        '  sudo apt-get "${apt_options[@]}" update',
        '  sudo apt-get "${apt_options[@]}" install -y --no-install-recommends postgresql-common curl ca-certificates',
        '  sudo install -d /usr/share/postgresql-common/pgdg',
        '  sudo install -m 0644 "$GITHUB_WORKSPACE/.github/pgdg/apt.postgresql.org.asc" /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc',
        '  pg_codename="$(. /etc/os-release && printf \'%s\' "$VERSION_CODENAME")"',
        '  printf \'Types: deb\\nURIs: https://apt.postgresql.org/pub/repos/apt\\nSuites: %s-pgdg\\nComponents: main\\nSigned-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc\\n\' "$pg_codename" > "$pg_sources/pgdg.sources"',
        '  sudo apt-get "${apt_options[@]}" update',
        '  sudo apt-get "${apt_options[@]}" install -y --no-install-recommends postgresql-client-17',
      ].join('\n')
    );
    const keyFromCheckout =
      'sudo install -m 0644 "$GITHUB_WORKSPACE/.github/pgdg/apt.postgresql.org.asc" /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc';
    const keySteps = normalized.jobs['native-smoke'].steps.filter((step: { run?: string }) =>
      step.run?.includes(keyFromCheckout)
    );
    expect(keySteps).toHaveLength(1);
    expect(keySteps[0].run.split(keyFromCheckout)).toHaveLength(2);
    keySteps[0].run = keySteps[0].run.replace(
      keyFromCheckout,
      'sudo curl --fail --silent --show-error --location --output /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc'
    );
    expect(createHash('sha256').update(JSON.stringify(normalized)).digest('hex')).toBe(
      '246c3981caf1382bf9d4e77c637f448882105e154b5570a43601a9222a562965'
    );
  });
});

it('refuses missing, duplicated, moved or broadened retained-owner scheduling', () => {
  for (const mutation of [
    (job: any, index: number) => job.steps.splice(index, 1),
    (job: any, index: number) => job.steps.push(structuredClone(job.steps[index])),
    (job: any, index: number) => {
      job.steps[index].if = 'matrix.shard == 2';
    },
    (job: any, index: number) => {
      job.steps[index + 1].run += '--exclude src/other.test.ts';
    },
    (job: any, index: number) => {
      [job.steps[index], job.steps[index + 1]] = [job.steps[index + 1], job.steps[index]];
    },
  ]) {
    const job = structuredClone(ci.jobs.server_shards);
    mutation(
      job,
      job.steps.findIndex((step: any) => step.name === retainedStep.name)
    );
    expect(() => normalizeRetainedOwnerScheduling(job)).toThrow();
  }
});

it('refuses a missing, duplicated, moved or weakened cash queue regression', () => {
  for (const mutate of [
    (job: any, index: number) => job.steps.splice(index, 1),
    (job: any, index: number) => job.steps.push(structuredClone(job.steps[index])),
    (job: any, index: number) => {
      job.steps[index].if = 'false';
    },
    (job: any, index: number) => {
      job.steps[index]['continue-on-error'] = true;
    },
    (job: any, index: number) => {
      job.steps[index].run += ' || true';
    },
    (job: any, index: number) => {
      [job.steps[index], job.steps[index + 1]] = [job.steps[index + 1], job.steps[index]];
    },
  ]) {
    const job = structuredClone(ci.jobs.accounting_postgres);
    mutate(
      job,
      job.steps.findIndex((step: any) => step.name === cashQueueFeedbackStep.name)
    );
    expect(() => normalizeCashQueueFeedbackAddition(job)).toThrow();
  }
});
