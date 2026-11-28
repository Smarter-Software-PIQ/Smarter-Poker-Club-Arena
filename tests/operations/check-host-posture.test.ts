import { describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'release', 'check-host-posture.sh');

// Create temp fixtures inside the worktree's own node_modules/.tmp (on SSD2, never /tmp).
const TMP_BASE = join(ROOT, 'node_modules', '.tmp');

interface StubConfig {
  dfFreeKiB?: number;
  dfInodePct?: number;
  chronycOut?: string;
  chronycRc?: number;
  freeSwapTotal?: number;
  freeSwapUsed?: number;
  dockerImages?: Record<string, string>;
  daemonJson?: string | null;
}

function runWithStubs(cfg: StubConfig, extraArgs: string[] = []) {
  mkdirSync(TMP_BASE, { recursive: true });
  const dir = mkdtempSync(join(TMP_BASE, 'host-posture-'));
  const binDir = join(dir, 'bin');
  const daemonPath = join(dir, 'daemon.json');
  try {
    spawnSync('mkdir', ['-p', binDir], { encoding: 'utf8' });

    const freeKiB = cfg.dfFreeKiB ?? 40 * 1024 * 1024; // 40 GiB
    const inodePct = cfg.dfInodePct ?? 22;
    const dfScript = `#!/usr/bin/env bash
if [[ "$1" == "-Pi" || "$1" == "-i" ]]; then
  echo "Filesystem Inodes IUsed IFree IUse% Mounted on"
  echo "/dev/sda1 1000000 220000 780000 ${inodePct}% /"
else
  echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
  echo "/dev/sda1 100000000 50000000 ${freeKiB} 50% /"
fi
`;
    writeFileSync(join(binDir, 'df'), dfScript, 'utf8');
    chmodSync(join(binDir, 'df'), 0o755);

    const chronycOut =
      cfg.chronycOut ??
      'Reference ID    : A9FEA97B (169.254.169.123)\nSystem time     : 0.001240 seconds fast of NTP time\nLeap status     : Normal\n';
    const chronycRc = cfg.chronycRc ?? 0;
    const chronycScript = `#!/usr/bin/env bash
cat <<'OUT'
${chronycOut}
OUT
exit ${chronycRc}
`;
    writeFileSync(join(binDir, 'chronyc'), chronycScript, 'utf8');
    chmodSync(join(binDir, 'chronyc'), 0o755);

    const swapTotal = cfg.freeSwapTotal ?? 2_000_000_000;
    const swapUsed = cfg.freeSwapUsed ?? 100_000_000; // 5%
    const freeScript = `#!/usr/bin/env bash
echo "              total        used        free      shared  buff/cache   available"
echo "Mem:     16000000000  8000000000  4000000000   100000000  4000000000  7500000000"
echo "Swap:    ${swapTotal}  ${swapUsed}  ${Math.max(0, swapTotal - swapUsed)}"
`;
    writeFileSync(join(binDir, 'free'), freeScript, 'utf8');
    chmodSync(join(binDir, 'free'), 0o755);

    const dockerImages = cfg.dockerImages ?? {
      'ghcr.io/smarter/engine:cand': 'sha256:1111',
      'ghcr.io/smarter/engine:rollback': 'sha256:2222',
    };
    const dockerScript = `#!/usr/bin/env bash
ref="\${@: -1}"
case "$ref" in
${Object.entries(dockerImages)
  .map(([k, v]) => `  "${k}") echo "${v}"; exit 0 ;;`)
  .join('\n')}
  *) echo "No such image: $ref" >&2; exit 1 ;;
esac
`;
    writeFileSync(join(binDir, 'docker'), dockerScript, 'utf8');
    chmodSync(join(binDir, 'docker'), 0o755);

    if (cfg.daemonJson !== null) {
      writeFileSync(
        daemonPath,
        cfg.daemonJson ??
          JSON.stringify({
            'log-driver': 'json-file',
            'log-opts': { 'max-size': '50m', 'max-file': '5' },
          }),
        'utf8'
      );
    }

    const res = spawnSync('bash', [SCRIPT, '--local', '--daemon-json', daemonPath, ...extraArgs], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      },
    });
    const parsed = JSON.parse(res.stdout);
    return { status: res.status, parsed, stderr: res.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('scripts/release/check-host-posture.sh', () => {
  it('passes exit 0 when disk, inode, chrony skew, docker log rotation, swap, and required images are healthy', () => {
    const { status, parsed } = runWithStubs({}, [
      '--require-image',
      'ghcr.io/smarter/engine:cand',
      '--require-image',
      'ghcr.io/smarter/engine:rollback',
    ]);
    expect(status).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.checks.disk.ok).toBe(true);
    expect(parsed.checks.inode.ok).toBe(true);
    expect(parsed.checks.clockSkew.ok).toBe(true);
    expect(parsed.checks.clockSkew.skewMs).toBeLessThan(250);
    expect(parsed.checks.dockerLogRotation.ok).toBe(true);
    expect(parsed.checks.swap.ok).toBe(true);
    expect(parsed.checks.requiredImages.ok).toBe(true);
    expect(parsed.checks.requiredImages.present).toHaveLength(2);
    expect(parsed.failures).toEqual([]);
  });

  it('fails closed (exit 1) when free disk is below 15 GiB', () => {
    const { status, parsed } = runWithStubs({ dfFreeKiB: 10 * 1024 * 1024 });
    expect(status).toBe(1);
    expect(parsed.ok).toBe(false);
    expect(parsed.checks.disk.ok).toBe(false);
    expect(parsed.checks.disk.freeGiB).toBe(10);
  });

  it('fails closed (exit 1) when inode usage is >= 70%', () => {
    const { status, parsed } = runWithStubs({ dfInodePct: 72 });
    expect(status).toBe(1);
    expect(parsed.checks.inode.ok).toBe(false);
    expect(parsed.checks.inode.inodeUsedPct).toBe(72);
  });

  it('fails closed (exit 1) when chrony clock skew is >= 250ms or unsynchronised', () => {
    const skewed = runWithStubs({
      chronycOut: 'System time     : 0.420000 seconds slow of NTP time\nLeap status     : Normal\n',
    });
    expect(skewed.status).toBe(1);
    expect(skewed.parsed.checks.clockSkew.ok).toBe(false);
    expect(skewed.parsed.checks.clockSkew.skewMs).toBe(420);

    const unsynced = runWithStubs({
      chronycOut:
        'System time     : 0.000100 seconds fast of NTP time\nLeap status     : Not synchronised\n',
    });
    expect(unsynced.status).toBe(1);
    expect(unsynced.parsed.checks.clockSkew.ok).toBe(false);
  });

  it('fails closed (exit 1) when Docker daemon.json lacks max-size or is missing', () => {
    const noMaxSize = runWithStubs({
      daemonJson: JSON.stringify({ 'log-driver': 'json-file', 'log-opts': {} }),
    });
    expect(noMaxSize.status).toBe(1);
    expect(noMaxSize.parsed.checks.dockerLogRotation.ok).toBe(false);

    const missingFile = runWithStubs({ daemonJson: null });
    expect(missingFile.status).toBe(1);
    expect(missingFile.parsed.checks.dockerLogRotation.ok).toBe(false);
  });

  it('fails closed (exit 1) when swap usage is unhealthy or a required image is missing', () => {
    const highSwap = runWithStubs({ freeSwapTotal: 2_000_000_000, freeSwapUsed: 1_500_000_000 });
    expect(highSwap.status).toBe(1);
    expect(highSwap.parsed.checks.swap.ok).toBe(false);

    const missingImg = runWithStubs({}, ['--require-image', 'ghcr.io/smarter/engine:absent']);
    expect(missingImg.status).toBe(1);
    expect(missingImg.parsed.checks.requiredImages.ok).toBe(false);
    expect(missingImg.parsed.checks.requiredImages.missing).toEqual([
      'ghcr.io/smarter/engine:absent',
    ]);
  });

  it('refuses disallowed SSH targets with exit 3 and never embeds raw IPs or sudo writes', () => {
    const res = spawnSync('bash', [SCRIPT, '--host', '5.161.252.33'], { encoding: 'utf8' });
    expect(res.status).toBe(3);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.failures[0]).toContain('disallowed SSH target');

    const src = readFileSync(SCRIPT, 'utf8');
    const nonCommentLines = src
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(src).not.toMatch(/5\.161\.252\.33|5\.161\.236\.0/);
    expect(nonCommentLines).not.toMatch(/\bsudo\b/);
    expect(src).toContain('ssh ca-engine');
    expect(src).toContain('ssh ca-backup');
  });

  it('supports --warn-inode-pct and --docker-log-rotation warn for live production severity split', () => {
    // 71% inodes + daemon.json lacking max-size: warn (exit 0) when configured with warn threshold 70 / fail 85
    const warned = runWithStubs(
      {
        dfInodePct: 71,
        daemonJson: JSON.stringify({ 'log-driver': 'json-file', 'log-opts': {} }),
      },
      [
        '--min-free-gib',
        '15',
        '--max-inode-pct',
        '85',
        '--warn-inode-pct',
        '70',
        '--max-clock-skew-ms',
        '250',
        '--docker-log-rotation',
        'warn',
        '--require-image',
        'ghcr.io/smarter/engine:cand',
        '--require-image',
        'ghcr.io/smarter/engine:rollback',
      ]
    );
    expect(warned.status).toBe(0);
    expect(warned.parsed.ok).toBe(true);
    expect(warned.parsed.checks.inode.ok).toBe(true);
    expect(warned.parsed.checks.inode.warning).toBe(true);
    expect(warned.parsed.checks.dockerLogRotation.ok).toBe(true);
    expect(warned.parsed.checks.dockerLogRotation.warning).toBe(true);
    expect(warned.parsed.warnings.length).toBe(2);
    expect(warned.parsed.failures).toEqual([]);

    // 85% inodes STILL hard-fails closed (exit 1)
    const hardFailInode = runWithStubs({ dfInodePct: 85 }, [
      '--max-inode-pct',
      '85',
      '--warn-inode-pct',
      '70',
      '--docker-log-rotation',
      'warn',
    ]);
    expect(hardFailInode.status).toBe(1);
    expect(hardFailInode.parsed.ok).toBe(false);
    expect(hardFailInode.parsed.checks.inode.ok).toBe(false);

    // Invalid --docker-log-rotation mode fails closed (exit 3)
    const badMode = runWithStubs({}, ['--docker-log-rotation', 'ignore']);
    expect(badMode.status).toBe(3);
    expect(badMode.parsed.ok).toBe(false);
  });
});
