/**
 * LAW: losing one external drive never splits the push lock, strands a worktree, or misroutes an inbox post.
 *
 * 2026-11-22 19:12 America/Chicago: SSD1 dropped off the bus for about 30 minutes. The one push lock lived on
 * it, so lanes improvised a second lock and two pre-pushes ran at once; a bare `git worktree prune` deleted
 * the registrations of the worktrees on it (hs-river, hs-onepair, hs-relguard); and the primary coordination
 * inbox was unreachable. scripts/ops/drive-loss-lib.mjs holds the three rules; these tests pin them and
 * refuse the bare prune that did the damage.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INBOX_CANONICAL,
  INBOX_MIRROR,
  LEGACY_PUSH_LOCK_PARENT,
  PUSH_LOCK_MARKER,
  drivePresence,
  formatInboxPost,
  formatLockOwner,
  inboxTargets,
  legacyPushLockDir,
  lockIsReclaimable,
  parseWorktreePorcelain,
  pushLockDir,
  worktreePruneDecision,
} from '../../scripts/ops/drive-loss-lib.mjs';
import { runInboxPost } from '../../scripts/ops/coordination-inbox-post.mjs';
import { runPushLock } from '../../scripts/ops/push-lock.mjs';
import { PROTECT_REASON, runSafePrune } from '../../scripts/ops/safe-worktree-prune.mjs';

const ROOT = resolve(__dirname, '../..');
const BOOT = 1;
const SSD1 = 11;
const SSD2 = 22;

/** A fake machine: `mounts` maps a mount point to its device; `paths` are the folders and files that exist. */
function machine({ ssd1 = true, ssd2 = true, extra = [] as string[] } = {}) {
  const mounts: Record<string, number> = { '/': BOOT };
  const paths = new Set<string>([
    '/',
    '/Volumes',
    '/bootdisk/dev/club-arena/.git',
    // Compatibility scaffolds on the boot disk: they exist whether or not a drive is mounted over them.
    '/Volumes/SmarterWork',
    '/Volumes/SmarterWork/agent-work',
    '/Volumes/SmarterWork/agent-work/shared-capacity',
    '/Volumes/SmarterWork/agent-work/extreme-capacity',
    '/Volumes/SmarterArchives',
    '/Volumes/SmarterArchives/agent-evidence',
    '/Volumes/SmarterArchives/agent-evidence/extreme-archive',
    ...extra,
  ]);
  if (ssd1) {
    mounts['/Volumes/SmarterWork/agent-work/shared-capacity'] = SSD1;
    mounts['/Volumes/SmarterArchives 1'] = SSD1;
    for (const p of [
      LEGACY_PUSH_LOCK_PARENT,
      '/Volumes/SmarterArchives 1',
      '/Volumes/SmarterArchives 1/agent-evidence',
      INBOX_MIRROR,
      '/Volumes/SmarterWork/agent-work/shared-capacity/hs-river',
    ]) {
      paths.add(p);
    }
  }
  if (ssd2) {
    mounts['/Volumes/SmarterWork/agent-work/extreme-capacity'] = SSD2;
    mounts['/Volumes/SmarterArchives/agent-evidence/extreme-archive'] = SSD2;
    paths.add(INBOX_CANONICAL);
    paths.add('/Volumes/SmarterWork/agent-work/extreme-capacity/coord-tree');
  }
  const dev = (p: string) => {
    let best = '/';
    for (const m of Object.keys(mounts)) {
      if ((p === m || p.startsWith(`${m}/`)) && m.length > best.length) best = m;
    }
    return mounts[best];
  };
  return { paths, probe: { exists: (p: string) => paths.has(p), dev, bootDev: BOOT } };
}

const LIST = [
  'worktree /bootdisk/dev/club-arena',
  'HEAD aaa',
  'branch refs/heads/main',
  '',
  'worktree /Volumes/SmarterWork/agent-work/shared-capacity/hs-river',
  'HEAD bbb',
  'branch refs/heads/hs/river',
  '',
  'worktree /Volumes/SmarterWork/agent-work/extreme-capacity/coord-tree',
  'HEAD ccc',
  'branch refs/heads/coord',
  '',
  'worktree /Volumes/SmarterWork/agent-work/extreme-capacity/deleted-tree',
  'HEAD ddd',
  'branch refs/heads/deleted',
  'prunable gitdir file points to non-existent location',
  '',
  'worktree /bootdisk/dev/.gemini/worktrees/removed',
  'HEAD eee',
  'detached',
  'prunable gitdir file points to non-existent location',
  '',
].join('\n');

describe('a path on an unmounted drive is missing its drive, not deleted', () => {
  it('tells present, gone and missing-drive apart by the device that answers', () => {
    const up = machine().probe;
    expect(drivePresence('/Volumes/SmarterWork/agent-work/shared-capacity/hs-river', up)).toBe(
      'present'
    );
    expect(drivePresence('/Volumes/SmarterWork/agent-work/extreme-capacity/deleted-tree', up)).toBe(
      'gone'
    );
    expect(drivePresence('/bootdisk/dev/.gemini/worktrees/removed', up)).toBe('gone');
    const down = machine({ ssd1: false }).probe;
    expect(drivePresence('/Volumes/SmarterWork/agent-work/shared-capacity/hs-river', down)).toBe(
      'missing-drive'
    );
    // The scaffold folder itself exists, on the boot disk. It is not the drive.
    expect(drivePresence('/Volumes/SmarterWork/agent-work/shared-capacity', down)).toBe(
      'missing-drive'
    );
    expect(drivePresence(INBOX_MIRROR, down)).toBe('missing-drive');
  });
});

describe('a worktree registration survives its drive dropping off the bus', () => {
  function run(probe: ReturnType<typeof machine>['probe'], opts: { failLock?: boolean } = {}) {
    const calls: string[][] = [];
    const out: string[] = [];
    const code = runSafePrune(['--repo', '/bootdisk/dev/club-arena'], {
      git: (_repo: string, args: string[]) => {
        calls.push(args);
        if (args[1] === 'list') return { status: 0, stdout: LIST, stderr: '' };
        if (args[1] === 'lock' && opts.failLock) return { status: 128, stdout: '', stderr: 'nope' };
        return { status: 0, stdout: '', stderr: '' };
      },
      probe,
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => out.push(s),
    });
    return { code, calls, out: out.join('\n') };
  }
  const river = '/Volumes/SmarterWork/agent-work/shared-capacity/hs-river';

  it('with every drive mounted it prunes only what is really gone, and locks nothing', () => {
    const d = worktreePruneDecision(parseWorktreePorcelain(LIST), machine().probe);
    expect(d.missingDrive).toEqual([]);
    expect(d.gone).toEqual([
      '/Volumes/SmarterWork/agent-work/extreme-capacity/deleted-tree',
      '/bootdisk/dev/.gemini/worktrees/removed',
    ]);
    const { code, calls } = run(machine().probe);
    expect(code).toBe(0);
    expect(calls.map((c) => c[1])).toEqual(['list', 'prune']);
  });

  it('with SSD1 gone it locks the SSD1 tree for the prune and unlocks it after (the 2026-11-22 case)', () => {
    const { code, calls, out } = run(machine({ ssd1: false }).probe);
    expect(code).toBe(0);
    expect(calls).toEqual([
      ['worktree', 'list', '--porcelain'],
      ['worktree', 'lock', '--reason', PROTECT_REASON, river],
      ['worktree', 'prune'],
      ['worktree', 'unlock', river],
    ]);
    expect(out).toContain(`KEPT (drive not mounted)  ${river}`);
  });

  it('prunes nothing when a protecting lock is refused', () => {
    const { code, calls } = run(machine({ ssd1: false }).probe, { failLock: true });
    expect(code).toBe(1);
    expect(calls.some((c) => c[1] === 'prune')).toBe(false);
  });

  it('leaves a tree somebody already locked alone: it is neither re-locked nor unlocked', () => {
    const locked = LIST.replace(
      'branch refs/heads/hs/river',
      'branch refs/heads/hs/river\nlocked portable'
    );
    const d = worktreePruneDecision(parseWorktreePorcelain(locked), machine({ ssd1: false }).probe);
    expect(d.missingDrive).toEqual([river]);
    expect(d.protect).toEqual([]);
  });

  it('no script or hook runs a bare git worktree prune; the two janitors call the helper', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === '_archive') continue;
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(sh|bash|mjs|cjs|js|ts|py)$/.test(name) && !full.includes('/.husky/')) continue;
        if (st.size > 2_000_000) continue;
        // The helper is the one place the prune is run (as an argument list) and named in a message.
        if (full.endsWith('scripts/ops/safe-worktree-prune.mjs')) continue;
        readFileSync(full, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (/^\s*(#|\/\/|\*|\/\*)/.test(line)) return;
            if (/\bgit\b[^\n|;&]*\bworktree\s+prune\b/.test(line)) {
              offenders.push(`${full.slice(ROOT.length + 1)}:${i + 1}`);
            }
          });
      }
    };
    for (const top of ['scripts', '.husky', 'operations']) walk(join(ROOT, top));
    expect(offenders).toEqual([]);
    for (const f of ['scripts/prune-stale-worktrees.sh', 'scripts/agent-tree-janitor.sh']) {
      expect(readFileSync(join(ROOT, f), 'utf8')).toContain('scripts/ops/safe-worktree-prune.mjs');
    }
  }, 180_000);
});

describe('there is one push lock, and no drive can take it away', () => {
  it('is a function of the clone alone: the same path with SSD1 mounted, missing, or both drives gone', () => {
    const lock = pushLockDir('/bootdisk/dev/club-arena/.git');
    expect(lock).toBe('/bootdisk/dev/club-arena/.git/ca-push-lock');
    expect(lock.startsWith('/Volumes/')).toBe(false);
    expect(() => pushLockDir('/Volumes/SmarterWork/agent-work/clone/.git')).toThrow(
      /off \/Volumes/
    );
    expect(pushLockDir.length).toBe(1); // no probe argument: what is mounted cannot change the answer
  });

  it('honours the old SSD1 lock only while its drive is mounted', () => {
    expect(legacyPushLockDir(machine().probe)).toBe(`${LEGACY_PUSH_LOCK_PARENT}/shepherd.lock`);
    expect(legacyPushLockDir(machine({ ssd1: false }).probe)).toBeNull();
  });

  function lockWorld(m: ReturnType<typeof machine>, alive: number[] = []) {
    const files = new Map<string, string>();
    const out: string[] = [];
    const deps = {
      gitCommonDir: () => '/bootdisk/dev/club-arena/.git',
      probe: m.probe,
      mkdir: (d: string) => {
        if (m.paths.has(d)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
        m.paths.add(d);
      },
      writeFile: (f: string, s: string) => void files.set(f, s),
      readFile: (f: string) => {
        if (!files.has(f)) throw new Error('ENOENT');
        return files.get(f) as string;
      },
      removeLock: (d: string) => {
        files.delete(`${d}/owner`);
        m.paths.delete(d);
      },
      pidAlive: (pid: number) => alive.includes(pid),
      now: () => new Date('2026-11-24T06:00:00Z'),
      stdout: (s: string) => out.push(s),
    };
    return { deps, files, out, paths: m.paths };
  }
  const NEW = '/bootdisk/dev/club-arena/.git/ca-push-lock';
  const OLD = `${LEGACY_PUSH_LOCK_PARENT}/shepherd.lock`;

  it('two lanes cannot both hold it, with SSD1 mounted or not', () => {
    for (const ssd1 of [true, false]) {
      const w = lockWorld(machine({ ssd1 }), [100, 200]);
      expect(runPushLock(['acquire', '--owner', 'lane-a push', '--pid', '100'], w.deps)).toBe(0);
      expect(runPushLock(['acquire', '--owner', 'lane-b push', '--pid', '200'], w.deps)).toBe(1);
      expect(w.paths.has(NEW)).toBe(true);
      expect(w.paths.has(OLD)).toBe(ssd1);
      expect(runPushLock(['release', '--pid', '200'], w.deps)).toBe(0); // not the holder: nothing changes
      expect(w.paths.has(NEW)).toBe(true);
      expect(runPushLock(['release', '--pid', '100'], w.deps)).toBe(0);
      expect(w.paths.has(NEW)).toBe(false);
      expect(w.paths.has(OLD)).toBe(false);
      expect(runPushLock(['acquire', '--owner', 'lane-b push', '--pid', '200'], w.deps)).toBe(0);
    }
  });

  it('a lane on an old wrapper holding the SSD1 lock still excludes a lane on the helper', () => {
    const w = lockWorld(machine(), [100]);
    w.paths.add(OLD);
    w.files.set(`${OLD}/owner`, 'hs-queue-v35 push of hs/x abc 2026-11-24T05:00:00Z\n');
    expect(runPushLock(['acquire', '--owner', 'lane-a push', '--pid', '100'], w.deps)).toBe(1);
    expect(w.paths.has(NEW)).toBe(false);
    expect(w.out.join('\n')).toContain('hs-queue-v35');
  });

  it('takes over a lock only when the helper wrote it and its wrapper pid is dead', () => {
    const line = formatLockOwner({
      owner: 'lane-a push',
      pid: 100,
      nowIso: '2026-11-24T06:00:00Z',
    });
    expect(line).toContain(PUSH_LOCK_MARKER);
    expect(lockIsReclaimable(line, () => false)).toBe(true);
    expect(lockIsReclaimable(line, () => true)).toBe(false);
    expect(lockIsReclaimable('old-wrapper push of x pid=100 now\n', () => false)).toBe(false);
    const w = lockWorld(machine({ ssd1: false }), [200]);
    expect(runPushLock(['acquire', '--owner', 'lane-a push', '--pid', '100'], w.deps)).toBe(0);
    expect(runPushLock(['acquire', '--owner', 'lane-b push', '--pid', '200'], w.deps)).toBe(0);
    expect(w.files.get(`${NEW}/owner`)).toContain('lane-b push pid=200');
  });
});

describe('a coordination post has one canonical inbox and one mirror', () => {
  function post(m: ReturnType<typeof machine>, extra: string[] = []) {
    const written: string[] = [];
    const out: string[] = [];
    const code = runInboxPost(
      [
        '--from',
        'Lane A (s1)',
        '--to',
        'ALL LANES',
        '--subject',
        'TEST',
        '--body-file',
        'b',
        ...extra,
      ],
      {
        probe: m.probe,
        readFile: () => '1. body\n',
        append: (f: string) => void written.push(f),
        now: () => new Date('2026-11-24T06:00:00.123Z'),
        stdout: (s: string) => out.push(s),
        stderr: (s: string) => out.push(s),
      }
    );
    return { code, written, out: out.join('\n') };
  }

  it('writes both when both drives are mounted, canonical first', () => {
    expect(post(machine())).toMatchObject({ code: 0, written: [INBOX_CANONICAL, INBOX_MIRROR] });
  });

  it('with SSD1 gone the post lands in the canonical file alone, never in a boot-disk scaffold', () => {
    const m = machine({ ssd1: false });
    expect(inboxTargets(m.probe).targets.map((t) => t.path)).toEqual([INBOX_CANONICAL]);
    expect(post(m)).toMatchObject({ code: 0, written: [INBOX_CANONICAL] });
  });

  it('with SSD2 gone it refuses unless told to use the mirror alone', () => {
    const m = machine({ ssd2: false });
    expect(post(m)).toMatchObject({ code: 3, written: [] });
    expect(post(m, ['--mirror-only'])).toMatchObject({ code: 0, written: [INBOX_MIRROR] });
    // A stale copy of the canonical file sitting in the scaffold folder is still not the drive.
    const stale = machine({ ssd2: false, extra: [INBOX_CANONICAL] });
    expect(post(stale)).toMatchObject({ code: 3, written: [] });
  });

  it('a post is the format the lanes read: header, ASCII body, GATE END', () => {
    const text = formatInboxPost({
      from: 'Lane A (s1)',
      to: 'ALL LANES',
      subject: 'TEST',
      body: '1. body\n\n',
      nowIso: '2026-11-24T06:00:00Z',
    });
    expect(text).toBe(
      '\n## 2026-11-24T06:00:00Z FROM Lane A (s1) TO ALL LANES - SUBJECT: TEST\n1. body\nGATE END\n'
    );
    expect(() =>
      formatInboxPost({
        from: 'a',
        to: 'b',
        subject: 'c',
        body: `caf${String.fromCharCode(233)}`,
        nowIso: 'x',
      })
    ).toThrow(/non-ASCII/);
    expect(() =>
      formatInboxPost({ from: 'a', to: 'b', subject: '', body: 'x', nowIso: 'x' })
    ).toThrow();
  });
});
