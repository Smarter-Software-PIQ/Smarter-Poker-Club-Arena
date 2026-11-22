/**
 * LAW: AN OLDER MERGED MIGRATION INSTALLS FIRST, BY CONSTRUCTION
 * (incident 90972d77, 2026-11-21).
 *
 * At 04:15 UTC four Apply Merged Migration runs released by the same hold
 * started within two seconds; 20261121024624 installed before
 * 20261121005533, whose switch-list chain guard then refused it, and the
 * install watch paged MergedMigrationNotInstalled. The applier's queue runs
 * files in run-id (dispatch) order, and dispatch order is not version order.
 *
 * The first answer (#11619) was a 300 s dispatcher wait, which an older run
 * slower than the budget still beat. The guarantee pinned here has no clock:
 *   1. the applier's runs stay serialized (per-file groups, never cancelled,
 *      plus the run-id queue step);
 *   2. each run installs every OLDER ordinary file on main that production
 *      does not hold, oldest first, once each through the same applier, and
 *      sends its own file only if all of them installed;
 *   3. a daily-maintenance window file is never sent by this path and never
 *      holds a later ordinary file back; a SUPERSEDED file never installs.
 * Pinned with a model of the queue over every dispatch order, and against the
 * workflow and dispatcher sources.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import {
  installNewerAfter,
  installOlderFirst,
  pendingNewerFiles,
  pendingOlderFiles,
  MAX_OLDER,
  ORDER_FLOOR,
} from '../scripts/ci/install-older-merged-first.mjs';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const APPLIER = parse(read('.github/workflows/apply-merged-migration.yml'));
const APPLY_RUN: string = APPLIER.jobs.apply.steps.find(
  (s: { id?: string }) => s.id === 'apply'
).run;
const DISPATCHER = parse(read('.github/workflows/dispatch-merged-migrations.yml'));
const SHELL = read('.github/scripts/dispatch-merged-migrations.sh');

const ORDINARY = 'BEGIN;\nSELECT 1;\nCOMMIT;\n';
const WINDOW = '-- @install-window: daily-maintenance\nBEGIN;\nSELECT 1;\nCOMMIT;\n';

const A = '20261121005533_horse_option_switch_a.sql';
const B = '20261121020000_unrelated_b.sql';
const C = '20261121024624_horse_option_switch_c.sql';
const D = '20261121032246_later_d.sql';

function planFor(
  target: string,
  files: Record<string, string>,
  installed: { version: string; name: string }[] = []
) {
  return pendingOlderFiles({
    target,
    files: Object.keys(files),
    readSql: (f: string) => files[f],
    installed,
  });
}

describe('which older files a run installs first', () => {
  it('every older ordinary file production lacks, oldest first, never the target or a newer one', () => {
    const files = { [D]: ORDINARY, [C]: ORDINARY, [A]: ORDINARY, [B]: ORDINARY };
    expect(planFor(C, files).install).toEqual([A, B]);
    expect(planFor(A, files).install).toEqual([]);
  });

  it('a file production holds by version, name or truncated name is never sent again', () => {
    const long = `20261121010101_${'x'.repeat(60)}.sql`;
    const files = { [A]: ORDINARY, [B]: ORDINARY, [long]: ORDINARY, [C]: ORDINARY };
    const installed = [
      { version: '20261121005533', name: 'other' },
      { version: '20261121999999', name: 'unrelated_b' },
      { version: '20261121888888', name: 'x'.repeat(55) },
    ];
    expect(planFor(C, files, installed).install).toEqual([]);
  });

  it('a window file stays QUEUED for the 04:00 route and does not hold a later file back', () => {
    const plan = planFor(C, { [A]: WINDOW, [B]: ORDINARY, [C]: ORDINARY });
    expect(plan.install).toEqual([B]);
    expect(plan.windowQueued).toEqual([A]);
  });

  it('a SUPERSEDED file never installs', () => {
    const plan = planFor(C, {
      [A]: `-- SUPERSEDED BY 20261121024624\n${ORDINARY}`,
      [B]: ORDINARY,
      [C]: ORDINARY,
    });
    expect(plan.install).toEqual([B]);
    expect(plan.superseded).toEqual([A]);
  });

  it('nothing below the floor, where history was recorded under other versions', () => {
    expect(ORDER_FLOOR).toBe('20261110000000');
    const old = '20261109235959_recorded_elsewhere.sql';
    const legacy = '20260827_horses_are_players_law.sql';
    expect(planFor(C, { [old]: ORDINARY, [legacy]: ORDINARY, [C]: ORDINARY }).install).toEqual([]);
  });
});

describe('the target is sent only after every older file installed', () => {
  const quiet = () => {};
  it('sends older files oldest first, once each', () => {
    const sent: string[] = [];
    const code = installOlderFirst({
      target: C,
      plan: { install: [A, B], windowQueued: [], superseded: [] },
      send: (f: string) => (sent.push(f), 0),
      log: quiet,
    });
    expect(code).toBe(0);
    expect(sent).toEqual([A, B]);
  });

  it('a refused older file stops the run: REFUSED, nothing after it, target not sent', () => {
    const sent: string[] = [];
    const code = installOlderFirst({
      target: C,
      plan: { install: [A, B], windowQueued: [], superseded: [] },
      send: (f: string) => (sent.push(f), f === A ? 1 : 0),
      log: quiet,
    });
    expect(code).toBe(1);
    expect(sent).toEqual([A]);
  });

  it('an unknown older outcome is UNKNOWN (3), never folded into refused or ok', () => {
    const code = installOlderFirst({
      target: C,
      plan: { install: [A], windowQueued: [], superseded: [] },
      send: () => 3,
      log: quiet,
    });
    expect(code).toBe(3);
  });

  it('a backlog beyond one run is refused with nothing sent and names the oldest file', () => {
    const many = Array.from({ length: MAX_OLDER + 1 }, (_, i) => `2026112101000${i}_f${i}.sql`);
    const sent: string[] = [];
    const lines: string[] = [];
    const code = installOlderFirst({
      target: D,
      plan: { install: many, windowQueued: [], superseded: [] },
      send: (f: string) => (sent.push(f), 0),
      log: (m: string) => lines.push(m),
    });
    expect(code).toBe(1);
    expect(sent).toEqual([]);
    expect(lines.join('\n')).toContain(`Dispatch apply-merged-migration for ${many[0]} first`);
  });

  it('an unreadable history is REFUSED with nothing sent', () => {
    const r = spawnSync(
      process.execPath,
      ['scripts/ci/install-older-merged-first.mjs', '--migration', C],
      { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } }
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('REFUSED: could not read production');
  });
});

/**
 * A model of the real queue: runs execute one at a time in run-id (dispatch)
 * order; each installs its older pending files through the same rule, then
 * its own file, and a file production already holds answers ALREADY-APPLIED.
 */
function simulate(
  dispatchOrder: string[],
  files: Record<string, string>,
  { refused = new Set<string>(), newerAfter = true }: { refused?: Set<string>; newerAfter?: boolean } = {}
) {
  const installed: { version: string; name: string }[] = [];
  const order: string[] = [];
  const has = (f: string) => installed.some((r) => r.version === f.slice(0, 14));
  const install = (f: string) => {
    if (has(f)) return 0; // ALREADY-APPLIED
    if (refused.has(f)) return 1; // REFUSED, nothing written
    installed.push({ version: f.slice(0, 14), name: f.slice(15, -4) });
    order.push(f);
    return 0;
  };
  for (const target of dispatchOrder) {
    const plan = planFor(target, files, installed);
    const code = installOlderFirst({ target, plan, send: install, log: () => {} });
    if (code !== 0 || install(target) !== 0) continue;
    if (!newerAfter) continue;
    const newer = pendingNewerFiles({
      target,
      files: Object.keys(files),
      readSql: (f: string) => files[f],
      installed,
    });
    installNewerAfter({ target, plan: newer, send: install, log: () => {} });
  }
  return order;
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) =>
    permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])
  );
}

describe('every dispatch order installs in version order', () => {
  const files = { [A]: ORDINARY, [B]: ORDINARY, [C]: ORDINARY, [D]: ORDINARY };

  it('the 04:15 race: the newer run first still installs the older file first', () => {
    expect(simulate([C, A], { [A]: ORDINARY, [C]: ORDINARY })).toEqual([A, C]);
  });

  it('all 24 orders of four merged files', () => {
    for (const p of permutations([A, B, C, D]))
      expect(simulate(p, files), p.join(' ')).toEqual([A, B, C, D]);
  });

  it('a lost or never-started older run is still installed by the next newer run', () => {
    expect(simulate([D], files)).toEqual([A, B, C, D]);
  });

  it('a single shared concurrency group would lose a file, which is why it is not used', () => {
    // GitHub keeps one PENDING run per group and a newer pending run replaces
    // it. Running C, pending D, then A joins: D is replaced by A, and A's
    // "install everything up to A" never reaches D.
    const running = C;
    let pending: string | null = D;
    pending = A; // A replaces D
    const ran = [running, pending];
    const order = simulate(ran, files, { newerAfter: false });
    expect(order).not.toContain(D);
  });
});

describe('the workflows carry the guarantee', () => {
  it('applier runs stay serialized: per-file group, never cancelled, run-id queue', () => {
    expect(APPLIER.concurrency).toEqual({
      group:
        'apply-merged-migration-${{ inputs.migration || github.event.client_payload.migration }}',
      'cancel-in-progress': false,
    });
    expect(APPLY_RUN).toContain('select(.id < $GITHUB_RUN_ID and .status != \\"completed\\")');
  });

  it('the older files install after the queue and before the target, and a failure sends nothing more', () => {
    const queue = APPLY_RUN.indexOf('deadline=$(( $(date +%s) + 900 ))');
    const older = APPLY_RUN.indexOf('node scripts/ci/install-older-merged-first.mjs');
    const target = APPLY_RUN.indexOf('node scripts/ci/apply-recorded-migration.mjs');
    expect(queue).toBeGreaterThan(0);
    expect(older).toBeGreaterThan(queue);
    expect(target).toBeGreaterThan(older);
    const between = APPLY_RUN.slice(older, target);
    expect(between).toContain('code=${PIPESTATUS[0]}');
    expect(between).toMatch(
      /if \[\[ "\$code" != "0" \]\]; then\n\s+echo "code=\$code" >> "\$GITHUB_OUTPUT"\n\s*exit "\$code"\n\s*fi/
    );
    // A check-only run checks the older files only too.
    expect(between).toContain("&& '--dry-run' || ''");
  });

  it('no dispatcher timing gate remains; the dispatcher reads Actions only for the applier state', () => {
    expect(existsSync(resolve(ROOT, 'scripts/ci/await-older-merged-applies.mjs'))).toBe(false);
    expect(SHELL).not.toContain('await-older-merged-applies');
    // actions: read is for the switched-off-applier HELD check only, never to time a send.
    expect(DISPATCHER.permissions).toEqual({
      actions: 'read',
      contents: 'write',
      'pull-requests': 'write',
    });
    expect(SHELL).not.toMatch(/actions\/workflows\/apply-merged-migration\.yml\/runs/);
  });

  it('the older-files step never sends a window file and never takes the window route', () => {
    const src = read('scripts/ci/install-older-merged-first.mjs');
    expect(src).toContain('declaresMaintenanceWindow(sql)');
    expect(src).not.toContain('--maintenance-window');
    expect(src).not.toContain('--owner-window');
  });
});

describe('a newer file held behind a refused older one installs after it (alerts 447640/447641)', () => {
  // 2026-11-22: 192807 refused on its anchors; the runs for 201323, 203048 and
  // 205903 each stopped behind it. #11785 made 192807 verify-only and its run
  // installed 192807 ALONE. 203048 and 201323 needed a hand re-send, 205903 a
  // second one.
  const R = '20261122192807_refused_on_its_anchors.sql';
  const N1 = '20261122201323_held_one.sql';
  const N2 = '20261122203048_held_two.sql';
  const N3 = '20261122205903_held_three.sql';
  const files = { [R]: ORDINARY, [N1]: ORDINARY, [N2]: ORDINARY, [N3]: ORDINARY };

  it('the fix run for the refused file installs every file held behind it, in version order', () => {
    // First the refused run and the three held runs, then the fix run for R.
    const refusedOnce = new Set([R]);
    const installed: { version: string; name: string }[] = [];
    const order: string[] = [];
    const send = (f: string) => {
      if (installed.some((r) => r.version === f.slice(0, 14))) return 0;
      if (refusedOnce.has(f)) return 1;
      installed.push({ version: f.slice(0, 14), name: f.slice(15, -4) });
      order.push(f);
      return 0;
    };
    const run = (target: string) => {
      const older = installOlderFirst({ target, plan: planFor(target, files, installed), send, log: () => {} });
      if (older !== 0 || send(target) !== 0) return older || 1;
      return installNewerAfter({
        target,
        plan: pendingNewerFiles({ target, files: Object.keys(files), readSql: (f) => files[f], installed }),
        send,
        log: () => {},
      });
    };
    for (const t of [R, N1, N2, N3]) expect(run(t)).toBe(1);
    expect(order).toEqual([]);
    refusedOnce.clear(); // #11785 fixes R in place
    expect(run(R)).toBe(0);
    expect(order).toEqual([R, N1, N2, N3]);
  });

  it('without the newer-after step the held files are never installed (the incident)', () => {
    const order = simulate([R, N1, N2, N3], files, { refused: new Set([R]) });
    expect(order).toEqual([]);
    const fixed = simulate([R], files, { newerAfter: false });
    expect(fixed).toEqual([R]);
  });

  it('newer files exclude the target, older files, window files, SUPERSEDED files and installed ones', () => {
    const plan = pendingNewerFiles({
      target: R,
      files: [A, R, N1, N2, N3, '20261122210000_window.sql', '20261122220000_old.sql'],
      readSql: (f: string) =>
        f.includes('window') ? WINDOW : f.includes('_old') ? `-- SUPERSEDED BY 20261122205903\n${ORDINARY}` : ORDINARY,
      installed: [{ version: '20261122203048', name: 'held_two' }],
    });
    expect(plan.install).toEqual([N1, N3]);
    expect(plan.windowQueued).toEqual(['20261122210000_window.sql']);
    expect(plan.superseded).toEqual(['20261122220000_old.sql']);
  });

  it('a refused newer file stops the step, names the rest, and the run is REFUSED', () => {
    const sent: string[] = [];
    const lines: string[] = [];
    const code = installNewerAfter({
      target: R,
      plan: { install: [N1, N2, N3], windowQueued: [], superseded: [] },
      send: (f: string) => (sent.push(f), f === N2 ? 1 : 0),
      log: (m: string) => lines.push(m),
    });
    expect(code).toBe(1);
    expect(sent).toEqual([N1, N2]);
    expect(lines.join('\n')).toContain(`not sent after it: ${N3}`);
    expect(installNewerAfter({ target: R, plan: { install: [N1], windowQueued: [], superseded: [] }, send: () => 3, log: () => {} })).toBe(3);
  });

  it('at most MAX_OLDER newer files per run; a longer tail is REFUSED and names the next', () => {
    const many = Array.from({ length: MAX_OLDER + 2 }, (_, i) => `2026112220000${i}_n${i}.sql`);
    const sent: string[] = [];
    const lines: string[] = [];
    const code = installNewerAfter({
      target: R,
      plan: { install: many, windowQueued: [], superseded: [] },
      send: (f: string) => (sent.push(f), 0),
      log: (m: string) => lines.push(m),
    });
    expect(code).toBe(1);
    expect(sent).toEqual(many.slice(0, MAX_OLDER));
    expect(lines.join('\n')).toContain(`Dispatch apply-merged-migration for ${many[MAX_OLDER]}`);
  });

  it('the workflow runs the newer-after step only after the target installed, never on a check-only run', () => {
    const target = APPLY_RUN.indexOf('node scripts/ci/apply-recorded-migration.mjs');
    const newer = APPLY_RUN.lastIndexOf('--newer-after');
    expect(target).toBeGreaterThan(0);
    expect(newer).toBeGreaterThan(target);
    const between = APPLY_RUN.slice(target, newer);
    expect(between).toContain('if [[ "$code" == "0" && -z "$check_only" ]]; then');
    const after = APPLY_RUN.slice(newer);
    expect(after).not.toContain('--dry-run');
    expect(after).toMatch(/code=\$\{PIPESTATUS\[0\]\}\n\s*fi\n\s*set -e\n\s*echo "code=\$code" >> "\$GITHUB_OUTPUT"\n\s*exit "\$code"/);
  });
});
