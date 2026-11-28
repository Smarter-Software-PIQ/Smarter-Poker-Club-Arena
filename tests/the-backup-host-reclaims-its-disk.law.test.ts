/**
 * THE BACKUP HOST RECLAIMS ITS DISK BEFORE EVERY CERTIFICATION (O34, 2026-11-26).
 *
 * Three certifications in a row (8a853e382063, 1ec2ff9d4df8, d88a03fd2e91)
 * were refused with tournament_freeze_qualification_failed because the Backup
 * host's disk was full ("No space left on device", run 45930467830): every
 * certification built an engine image and two qualification images and kept a
 * qualification folder, and nothing removed them.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sliceBetween } from './helpers/sourceWindow';

const ROOT = resolve(__dirname, '..');
const STANDBY_PATH = join(ROOT, 'server/standby/standby-engine.sh');
const STANDBY = readFileSync(STANDBY_PATH, 'utf8');
const CANDIDATE = 'c'.repeat(40);
const OLD = 'a'.repeat(40);
const FRESH = 'b'.repeat(40);
const IN_USE = 'd'.repeat(40);
const SERVING_ELSEWHERE = 'e'.repeat(40);

function run(script: string, dir: string) {
  return spawnSync(
    'bash',
    [
      '-c',
      `set -Eeuo pipefail\nsource ${JSON.stringify(STANDBY_PATH)}\nSTATE_DIR=${JSON.stringify(
        join(dir, 'state')
      )}\nLOG_DIR=${JSON.stringify(join(dir, 'log'))}\n${script}`,
    ],
    { encoding: 'utf8' }
  );
}

const DOCKER_STUB = (calls: string, refuse = IN_USE) => `
docker() {
  echo "$*" >> ${JSON.stringify(calls)}
  case "$1 $2" in
    "image ls")
      case "$*" in
        *club-arena-engine-standby*) printf '%s\\n' club-arena-engine-standby:${OLD} club-arena-engine-standby:${FRESH} club-arena-engine-standby:${CANDIDATE} club-arena-engine-standby:${IN_USE} ;;
        *standby-freeze*) printf '%s\\n' standby-freeze-pg:x standby-freeze-node:x ;;
      esac ;;
    "image inspect")
      case "$*" in
        *${FRESH}*) date -u -d '-2 hours' +%FT%TZ ;;
        *) date -u -d '-3 days' +%FT%TZ ;;
      esac ;;
    "image rm")
      case "$*" in *${IN_USE}*|*${refuse}*) return 1 ;; esac ;;
    "info -f") echo /var/lib/docker ;;
  esac
  return 0
}
df() { printf 'Filesystem 1G-blocks Used Available Capacity Mounted\\n/dev/sda 300G 250G 40G 87%% /\\n'; }
`;

describe('the Backup host reclaims its disk', () => {
  it('removes only old engine images it built, never the candidate, and every qualification image', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reclaim-'));
    mkdirSync(join(dir, 'state', 'qualifications', 'old-run'), { recursive: true });
    mkdirSync(join(dir, 'state', 'qualifications', 'new-run'), { recursive: true });
    mkdirSync(join(dir, 'log'), { recursive: true });
    const old = Date.now() / 1000 - 3 * 86400;
    utimesSync(join(dir, 'state', 'qualifications', 'old-run'), old, old);
    const calls = join(dir, 'calls');
    writeFileSync(calls, '');
    const r = run(
      `${DOCKER_STUB(calls)}\nreclaim_backup_disk ${CANDIDATE} ${SERVING_ELSEWHERE}`,
      dir
    );
    expect(r.status, r.stderr).toBe(0);
    const removed = readFileSync(calls, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('image rm'));
    expect(removed).toContain(`image rm club-arena-engine-standby:${OLD}`);
    expect(removed).toContain(`image rm club-arena-engine-standby:${IN_USE}`);
    expect(removed.join('\n')).not.toContain(CANDIDATE);
    expect(removed.join('\n')).not.toContain(FRESH);
    expect(removed).toContain('image rm standby-freeze-pg:x');
    expect(removed).toContain('image rm standby-freeze-node:x');
    // Never forced: docker keeps an image a container still uses.
    expect(removed.every((l) => !/\s-f\b|--force/.test(l))).toBe(true);
    const all = readFileSync(calls, 'utf8');
    expect(all).toContain('image prune -f');
    expect(all).toContain('builder prune -f --filter until=24h');
    expect(existsSync(join(dir, 'state', 'qualifications', 'old-run'))).toBe(false);
    expect(existsSync(join(dir, 'state', 'qualifications', 'new-run'))).toBe(true);
    // One engine image removed and counted (the in-use one was refused).
    expect(r.stderr).toMatch(/disk: removed 1 engine image\(s\) older than 24h; free 40 GiB/);
    expect(r.stderr).toContain('serving eeeeeeeeeeee has no image here');
  });

  it('keeps the serving release image however old it is, and removes no engine image by age when serving is unknown', () => {
    // 2026-11-27: both rehearsal swaps run production's serving release. When nothing seals for
    // more than 24 h that image is older than the cutoff; deleting it made the rehearsal run a
    // rebuild instead of the bytes production runs.
    const dir = mkdtempSync(join(tmpdir(), 'reclaim-serving-'));
    mkdirSync(join(dir, 'log'), { recursive: true });
    const calls = join(dir, 'calls');
    writeFileSync(calls, '');
    const kept = run(`${DOCKER_STUB(calls)}\nreclaim_backup_disk ${CANDIDATE} ${OLD}`, dir);
    expect(kept.status, kept.stderr).toBe(0);
    const removed = readFileSync(calls, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('image rm'));
    expect(removed.join('\n')).not.toContain(OLD);
    expect(removed).toContain(`image rm club-arena-engine-standby:${IN_USE}`);
    // The certify log proves which image was kept.
    expect(kept.stderr).toContain('kept serving aaaaaaaaaaaa');
    // UNKNOWN IS NOT NONE (2026-11-27, replaces "still reclaims when serving is unknown"). When
    // /health cannot be read the serving sha is empty and the keep rule protected nothing: a
    // serving image older than 24 h was removed and the rehearsal rebuilt it. Now no engine image
    // is removed by age; the other classes still are, and the free-space floor refuses by name.
    writeFileSync(calls, '');
    mkdirSync(join(dir, 'state', 'qualifications', 'old-run'), { recursive: true });
    const old = Date.now() / 1000 - 3 * 86400;
    utimesSync(join(dir, 'state', 'qualifications', 'old-run'), old, old);
    const unknown = run(`${DOCKER_STUB(calls)}\nreclaim_backup_disk ${CANDIDATE} ''`, dir);
    expect(unknown.status, unknown.stderr).toBe(0);
    const after = readFileSync(calls, 'utf8');
    expect(after).not.toContain('image rm club-arena-engine-standby');
    expect(after).toContain('image rm standby-freeze-pg:x');
    expect(after).toContain('image prune -f');
    expect(after).toContain('builder prune -f --filter until=24h');
    expect(existsSync(join(dir, 'state', 'qualifications', 'old-run'))).toBe(false);
    expect(unknown.stderr).toContain(
      'disk: serving release unknown, no engine image removed by age; free 40 GiB'
    );
    const body = sliceBetween(STANDBY, 'cmd_certify() {', 'trial_regression_replay "$sha"');
    expect(body).toContain('reclaim_backup_disk "$sha" "$reclaim_serving"');
    expect(body).toMatch(
      /\[\[ "\$reclaim_serving" =~ \^\[0-9a-f\]\{40\}\$ \]\] \|\| reclaim_serving=''/
    );
  });

  it('a qualification image docker refuses to remove is skipped and never ends the certification', () => {
    // The loop was `docker image ls ... | while read -r tag; do [ -n "$tag" ] && docker image rm
    // "$tag"; done`. Under set -Eeuo pipefail a refusal of the LAST listed image failed the
    // pipeline and the whole script exited before the certificate was written.
    const dir = mkdtempSync(join(tmpdir(), 'reclaim-refused-'));
    mkdirSync(join(dir, 'log'), { recursive: true });
    mkdirSync(join(dir, 'state'), { recursive: true });
    const calls = join(dir, 'calls');
    writeFileSync(calls, '');
    const r = run(
      `${DOCKER_STUB(calls, 'standby-freeze-node:x')}\nreclaim_backup_disk ${CANDIDATE} ${OLD}\necho certification-continues`,
      dir
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('certification-continues');
    expect(r.stderr).toContain('disk: could not remove standby-freeze-node:x (skipped)');
    const all = readFileSync(calls, 'utf8');
    expect(all).toContain('image rm standby-freeze-node:x');
    // Everything after the refused removal still ran.
    expect(all).toContain('image prune -f');
    expect(r.stderr).toContain(
      'disk: removed 0 engine image(s) older than 24h; free 40 GiB; kept serving aaaaaaaaaaaa'
    );
    expect(STANDBY).not.toMatch(/docker image ls[^\n]*\\\n[^\n]*\| while read/);
  });

  it('reports the smallest free space of the paths it writes, and unknown when it cannot read it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'free-'));
    mkdirSync(join(dir, 'state'), { recursive: true });
    const ok = run(
      `docker() { echo ${JSON.stringify(dir)}; }\ndf() { case "$3" in *state) printf 'h\\nx 1G 1G 7G 1%% /s\\n' ;; *) printf 'h\\nx 1G 1G 40G 1%% /d\\n' ;; esac; }\nbackup_disk_free_gib`,
      dir
    );
    expect(ok.stdout.trim()).toBe('7');
    const unknown = run(`docker() { return 1; }\ndf() { return 1; }\nbackup_disk_free_gib`, dir);
    expect(unknown.stdout.trim()).toBe('unknown');
  });

  it('certify reclaims first and refuses by name when space is still short or unreadable', () => {
    const body = sliceBetween(STANDBY, 'cmd_certify() {', 'trial_regression_replay "$sha"');
    const reclaim = body.indexOf('reclaim_backup_disk "$sha" "$reclaim_serving"');
    expect(reclaim).toBeGreaterThan(0);
    expect(reclaim).toBeLessThan(body.indexOf('assert_valid_copy'));
    expect(body).toContain(`record 'backup_disk_unreadable'`);
    expect(body).toContain('record "backup_disk_low:${free_gib}GiB"');
    expect(STANDBY).toContain('BACKUP_DISK_MIN_FREE_GIB=${BACKUP_DISK_MIN_FREE_GIB:-12}');
    // A refusal recorded here fails the verdict, so the rehearsals, the crash
    // drill and the soak (all gated on verdict = pass) do not spend 40 minutes.
    expect(STANDBY).toMatch(/record\(\) \{ reasons\+=\("\$1"\); verdict=fail;/);
  });
});
