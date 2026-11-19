import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

describe('Ubuntu package installs go through one entry point and one mirror list', () => {
  it('selects the shared mirror before both browser and native package installs', () => {
    const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
    const native = workflow.jobs.accounting_postgres.steps.find(
      (step: { name?: string }) =>
        step.name === 'Install PostgreSQL 17 tools without a default database service'
    ).run;
    // The native install runs the one shared installer; it selects the mirror
    // through the one entry point before copying the Ubuntu sources it
    // installs from, whatever PG_UBUNTU_MIRROR says (the accounting job's text
    // is pinned by scripts/qualification/ci-accounting-inputs.json and keeps
    // its historical flag).
    expect(native).toContain('bash .github/actions/install-postgres-17/install.sh');
    const shared = readFileSync('.github/actions/install-postgres-17/install.sh', 'utf8');
    expect(shared).not.toMatch(/if \[ "\$\{PG_UBUNTU_MIRROR/);
    expect(shared).toContain('PG_UBUNTU_APT="$GITHUB_WORKSPACE/scripts/ci/ubuntu-apt.sh"');
    const setup = shared.indexOf('bash "$PG_UBUNTU_APT" setup');
    expect(setup).toBeGreaterThan(0);
    expect(setup).toBeLessThan(shared.indexOf('cp /etc/apt/sources.list.d/ubuntu.sources'));
    expect(setup).toBeLessThan(shared.indexOf('pg_attempt sudo apt-get'));
    // Every attempt is bounded and a retry starts on a different mirror.
    expect(shared).toContain('until timeout --kill-after=15 "$bound" "$@"; do');
    expect(shared).toContain('bash "$PG_UBUNTU_APT" rotate');
    const install = workflow.jobs['css-beats-e2e'].steps.find(
      (step: { name?: string }) => step.name === 'Install Chromium and WebKit'
    );
    expect(install.run).toBe(
      'bash scripts/ci/ubuntu-apt.sh run npx playwright install chromium webkit --with-deps'
    );
  });

  // EVERY BROWSER SYSTEM-PACKAGE INSTALL, NOT THE TWO THAT HIT IT FIRST
  // (2026-10-26). The mirror selection reached ci.yml's CSS beats and
  // accounting jobs on 2026-10-22, and nowhere else. Post-deploy E2E kept the
  // Azure mirror: on 2026-10-26 its browser install fetched 97 MB at 27 kB/s
  // for 59 minutes, and the client certificate hit its 80-minute cap before
  // the sweep.
  //
  // ONE ENTRY POINT FOR EVERY UBUNTU PACKAGE INSTALL (2026-11-19). Selecting
  // a mirror in an earlier line was not enough: the primary then stalled
  // Post-Deploy E2E for 20+ minutes with no per-attempt bound and no other
  // host to retry on, and two workflows ran apt-get with no selection at all.
  // Every line that installs Ubuntu packages - apt directly or Playwright's
  // --with-deps/install-deps - runs inside scripts/ci/ubuntu-apt.sh, and
  // PostgreSQL installs go through install-postgres-17, which runs it too.
  it('routes every Ubuntu package install in every workflow through the one entry point', () => {
    const entry = 'bash scripts/ci/ubuntu-apt.sh ';
    const installsPackages =
      /\b(?:apt-get|apt)\s+(?:-\S+\s+)*(?:update|install|upgrade|dist-upgrade)\b|npx playwright (?:install-deps\b|install\b[^\n]*--with-deps)/;
    const missing: string[] = [];
    let installs = 0;
    let postgres = 0;
    for (const file of readdirSync('.github/workflows').filter((name) => /\.ya?ml$/.test(name))) {
      const text = readFileSync(join('.github/workflows', file), 'utf8');
      // A direct call bypasses the per-attempt bound and the retry.
      if (text.includes('python3 scripts/ci/ubuntu-apt-mirror.py'))
        missing.push(`${file}: calls ubuntu-apt-mirror.py directly`);
      const workflow = parse(text);
      for (const [jobId, job] of Object.entries(
        (workflow?.jobs ?? {}) as Record<
          string,
          { steps?: { name?: string; run?: string; uses?: string }[] }
        >
      )) {
        for (const step of job.steps ?? []) {
          if (step.uses === './.github/actions/install-postgres-17') postgres += 1;
          const run = typeof step.run === 'string' ? step.run : '';
          if (run.includes('.github/actions/install-postgres-17/install.sh')) postgres += 1;
          for (const line of run.split('\n')) {
            const code = line.replace(/(^|\s)#.*$/, '');
            const install = code.search(installsPackages);
            if (install < 0) continue;
            installs += 1;
            const at = code.indexOf(entry);
            if (at < 0 || at > install)
              missing.push(`${file} ${jobId}: ${step.name ?? line.trim()}`);
          }
        }
      }
    }
    expect(installs).toBeGreaterThanOrEqual(20);
    expect(postgres).toBeGreaterThanOrEqual(50);
    expect(missing).toEqual([]);
  });

  it('keeps every other Ubuntu package install in the shared actions behind the entry point', () => {
    const offenders: string[] = [];
    for (const action of readdirSync('.github/actions')) {
      for (const file of readdirSync(join('.github/actions', action))) {
        const text = readFileSync(join('.github/actions', action, file), 'utf8');
        if (!/\bapt-get\b[^\n]*\b(?:update|install)\b/.test(text)) continue;
        if (`${action}/${file}` !== 'install-postgres-17/install.sh')
          offenders.push(`${action}/${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // A sparse checkout that carries the installer must carry what it runs.
  it('checks out the entry point wherever a sparse checkout carries the PostgreSQL installer', () => {
    const needed = [
      'scripts/ci/ubuntu-apt.sh',
      'scripts/ci/ubuntu-apt-mirror.py',
      'scripts/ci/ubuntu-apt-mirrors.txt',
    ];
    let sparse = 0;
    for (const file of readdirSync('.github/workflows').filter((name) => /\.ya?ml$/.test(name))) {
      const workflow = parse(readFileSync(join('.github/workflows', file), 'utf8'));
      for (const job of Object.values(
        (workflow?.jobs ?? {}) as Record<string, { steps?: { with?: Record<string, unknown> }[] }>
      )) {
        for (const step of job.steps ?? []) {
          const paths = String(step.with?.['sparse-checkout'] ?? '')
            .split('\n')
            .map((path) => path.trim().replace(/^\//, ''))
            .filter(Boolean);
          if (!paths.some((path) => path.startsWith('.github/actions/install-postgres-17')))
            continue;
          sparse += 1;
          const covered = (target: string) =>
            paths.some((path) => target === path || target.startsWith(path.replace(/\/?$/, '/')));
          expect(
            needed.filter((target) => !covered(target)),
            file
          ).toEqual([]);
        }
      }
    }
    expect(sparse).toBeGreaterThanOrEqual(2);
  });

  // THE IMAGE USES THE SAME LIST (2026-11-19). #11404 gave the native
  // qualification image its own hand-written mirror list; now it installs
  // through the same entry point and list as every workflow.
  it('builds the native qualification image through the same entry point and mirror list', () => {
    const dockerfile = readFileSync(
      'scripts/verification-harness/leaderboard-native-function-batch.Dockerfile',
      'utf8'
    );
    expect(dockerfile).toContain('COPY ubuntu-apt.sh ubuntu-apt-mirrors.txt /opt/ca-apt/');
    expect(dockerfile).toMatch(
      /RUN UBUNTU_APT_IMAGE=1 UBUNTU_APT_ATTEMPTS=\d+ UBUNTU_APT_ATTEMPT_SECONDS=\d+ \\\n\s+bash \/opt\/ca-apt\/ubuntu-apt\.sh install /
    );
    // No private copy of the list or of the apt calls.
    expect(dockerfile).not.toMatch(/https?:\/\/[a-z0-9.-]*ubuntu\.com/);
    expect(dockerfile).not.toMatch(/apt-get (?:update|install)/);
    const build = readFileSync(
      'scripts/verification-harness/leaderboard-native-function-batch-build.sh',
      'utf8'
    );
    const copy = build.indexOf(
      'cp "$here/../ci/ubuntu-apt.sh" "$here/../ci/ubuntu-apt-mirrors.txt" "$scratch/"'
    );
    expect(copy).toBeGreaterThan(0);
    expect(copy).toBeLessThan(build.indexOf('docker build'));
  });

  it('refuses a shared mirror list with fewer than two hosts or a foreign entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'ca-apt-mirror-'));
    try {
      mkdirSync(join(root, 'sources.list.d'));
      writeFileSync(
        join(root, 'sources.list.d', 'ubuntu.sources'),
        'URIs: https://archive.ubuntu.com/ubuntu\n'
      );
      for (const list of [
        '# none\n',
        'http://archive.ubuntu.com/ubuntu\n',
        'http://a.example/ubuntu\nftp://b/ubuntu\n',
      ]) {
        writeFileSync(join(root, 'mirrors.txt'), list);
        expect(() =>
          execFileSync(
            'python3',
            [
              'scripts/ci/ubuntu-apt-mirror.py',
              '--root',
              root,
              '--mirrors',
              join(root, 'mirrors.txt'),
            ],
            { stdio: 'pipe' }
          )
        ).toThrow();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('bounds client browser installation before any production identity can be created', () => {
    const workflow = parse(readFileSync('.github/workflows/post-deploy-e2e.yml', 'utf8'));
    const job = workflow.jobs['production-e2e'];
    const installIndex = job.steps.findIndex(
      (step: { name?: string }) => step.name === 'Install Chromium and WebKit'
    );
    expect(installIndex).toBeGreaterThanOrEqual(0);
    const install = job.steps[installIndex];
    // Successful job121591382452 installed in49s; job121619175020 took
    // 49m32s, then created a fixture before hitting its80m job ceiling.
    // Ten minutes allows >12x the successful install without spending the
    // suite's proof and cleanup budget on dependency setup.
    expect(install['timeout-minutes']).toBeGreaterThan(0);
    expect(install['timeout-minutes']).toBeLessThanOrEqual(10);
    expect(install['continue-on-error']).not.toBe(true);
    expect(job['timeout-minutes']).toBe(120);
    const liveIndex = job.steps.findIndex((step: { id?: string }) => step.id === 'live');
    expect(liveIndex).toBeGreaterThan(installIndex);
    expect(job.steps[liveIndex].if).toBeUndefined();
    const creates = job.steps.filter((step: { run?: string }) =>
      /production-e2e-account\.mjs create/.test(step.run ?? '')
    );
    expect(creates.length).toBeGreaterThanOrEqual(2);
    for (const step of creates) {
      expect(job.steps.indexOf(step)).toBeGreaterThan(liveIndex);
      expect(step.if).toContain("steps.live.outputs.ready == 'true'");
    }
  });

  it('changes only active Azure Ubuntu URIs, preserves trust and is idempotent', () => {
    const root = mkdtempSync(join(tmpdir(), 'ca-apt-mirror-'));
    try {
      mkdirSync(join(root, 'sources.list.d'));
      const legacy = join(root, 'sources.list');
      const modern = join(root, 'sources.list.d', 'ubuntu.sources');
      const unrelated = join(root, 'sources.list.d', 'other.list');
      writeFileSync(
        legacy,
        '# http://azure.archive.ubuntu.com/ubuntu\ndeb [signed-by=/key] http://azure.archive.ubuntu.com/ubuntu/ noble main\n'
      );
      writeFileSync(
        modern,
        'Types: deb\nURIs: https://azure.archive.ubuntu.com/ubuntu\nSuites: noble noble-updates\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n'
      );
      const other =
        'deb https://example.com/ubuntu noble main\ndeb https://azure.archive.ubuntu.com/ubuntu-extra noble main\n';
      writeFileSync(unrelated, other);
      const run = () =>
        execFileSync('python3', ['scripts/ci/ubuntu-apt-mirror.py', '--root', root], {
          encoding: 'utf8',
        });
      expect(run()).toContain('updated 2 source files');
      expect(readFileSync(legacy, 'utf8')).toBe(
        '# http://azure.archive.ubuntu.com/ubuntu\ndeb [signed-by=/key] https://archive.ubuntu.com/ubuntu/ noble main\n'
      );
      expect(readFileSync(modern, 'utf8')).toBe(
        'Types: deb\nURIs: https://archive.ubuntu.com/ubuntu\nSuites: noble noble-updates\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n'
      );
      expect(readFileSync(unrelated, 'utf8')).toBe(other);
      expect(run()).toContain('updated 0 source files');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rewrites referenced hosted mirrorlists while preserving weights, comments and trust', () => {
    const root = mkdtempSync(join(tmpdir(), 'ca-apt-mirror-'));
    try {
      mkdirSync(join(root, 'sources.list.d'));
      const source = join(root, 'sources.list.d', 'ubuntu.sources');
      const definition =
        'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates\nComponents: main\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n# mirror+file:/etc/apt/unused.txt\n';
      writeFileSync(source, definition);
      const mirror = join(root, 'apt-mirrors.txt');
      writeFileSync(
        mirror,
        'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\n# http://azure.archive.ubuntu.com/ubuntu\nhttps://example.com/ubuntu\tpriority:3 # http://azure.archive.ubuntu.com/ubuntu\n'
      );
      const unused = 'http://azure.archive.ubuntu.com/ubuntu\n';
      writeFileSync(join(root, 'unused.txt'), unused);
      const run = () =>
        execFileSync('python3', ['scripts/ci/ubuntu-apt-mirror.py', '--root', root], {
          encoding: 'utf8',
        });
      expect(run()).toContain('updated 1 source files');
      expect(readFileSync(source, 'utf8')).toBe(definition);
      expect(readFileSync(mirror, 'utf8')).toBe(
        'https://archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\n# http://azure.archive.ubuntu.com/ubuntu\nhttps://example.com/ubuntu\tpriority:3 # http://azure.archive.ubuntu.com/ubuntu\n' +
          'http://us.archive.ubuntu.com/ubuntu\tpriority:4 # ca-shared: scripts/ci/ubuntu-apt-mirrors.txt\n' +
          'http://azure.archive.ubuntu.com/ubuntu/\tpriority:5 # ca-fallback: replaced mirror, tried last\n'
      );
      expect(readFileSync(join(root, 'unused.txt'), 'utf8')).toBe(unused);
      expect(run()).toContain('updated 0 source files');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // THE RUNNERS MOVED MIRRORS (2026-11-18). Hosted runners now resolve Ubuntu
  // through a regional EC2 mirror in their mirrorlist. The script matched
  // azure.archive.ubuntu.com only, printed "updated 0 source files", and the
  // Post-Deploy E2E browser install hit its 10-minute bound in 3 of 7 failed
  // runs (44332156955, 44268660943, 44239575898). Every regional or cloud
  // subdomain of the archive is a hosted mirror; the primary, security and
  // ports hosts and look-alike paths are not.
  it('rewrites any regional cloud archive mirror, including EC2, and nothing else', () => {
    const root = mkdtempSync(join(tmpdir(), 'ca-apt-mirror-'));
    try {
      mkdirSync(join(root, 'sources.list.d'));
      writeFileSync(
        join(root, 'sources.list.d', 'ubuntu.sources'),
        'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates\nComponents: main\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n'
      );
      const mirror = join(root, 'apt-mirrors.txt');
      writeFileSync(
        mirror,
        'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:1\nhttp://archive.ubuntu.com/ubuntu/\tpriority:2\nhttp://security.ubuntu.com/ubuntu/\tpriority:3\nhttp://ports.ubuntu.com/ubuntu-ports/\tpriority:4\nhttp://us.archive.ubuntu.com/ubuntu-extra/\tpriority:5\n'
      );
      const run = () =>
        execFileSync('python3', ['scripts/ci/ubuntu-apt-mirror.py', '--root', root], {
          encoding: 'utf8',
        });
      const first = run();
      expect(first).toContain('updated 1 source files');
      expect(first).toContain('us-east-2.ec2.archive.ubuntu.com');
      expect(readFileSync(mirror, 'utf8')).toBe(
        'https://archive.ubuntu.com/ubuntu/\tpriority:1\nhttp://archive.ubuntu.com/ubuntu/\tpriority:2\nhttp://security.ubuntu.com/ubuntu/\tpriority:3\nhttp://ports.ubuntu.com/ubuntu-ports/\tpriority:4\nhttp://us.archive.ubuntu.com/ubuntu-extra/\tpriority:5\n' +
          'http://azure.archive.ubuntu.com/ubuntu\tpriority:6 # ca-shared: scripts/ci/ubuntu-apt-mirrors.txt\n' +
          'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:7 # ca-fallback: replaced mirror, tried last\n'
      );
      expect(run()).toContain('updated 0 source files');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // A STALLED MIRROR FAILS OVER (2026-11-19). Every fallback line named the
  // primary host, so when the primary stalled, Post-Deploy E2E's live-table
  // browser install hung for 20+ minutes (run 44519687021) with nowhere else
  // to go. The replaced cloud mirror stays listed last, and an idle fetch gives
  // up after 30 s so apt's mirror method reaches it.
  it('keeps the replaced mirror as a last fallback and bounds every idle fetch', () => {
    const root = mkdtempSync(join(tmpdir(), 'ca-apt-mirror-'));
    try {
      mkdirSync(join(root, 'sources.list.d'));
      writeFileSync(
        join(root, 'sources.list.d', 'ubuntu.sources'),
        'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble\nComponents: main\n'
      );
      const mirror = join(root, 'apt-mirrors.txt');
      writeFileSync(mirror, 'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:1\n');
      const run = () =>
        execFileSync('python3', ['scripts/ci/ubuntu-apt-mirror.py', '--root', root], {
          encoding: 'utf8',
        });
      expect(run()).toContain('bounded fetches set');
      expect(readFileSync(mirror, 'utf8')).toBe(
        'https://archive.ubuntu.com/ubuntu/\tpriority:1\n' +
          'http://us.archive.ubuntu.com/ubuntu\tpriority:2 # ca-shared: scripts/ci/ubuntu-apt-mirrors.txt\n' +
          'http://azure.archive.ubuntu.com/ubuntu\tpriority:3 # ca-shared: scripts/ci/ubuntu-apt-mirrors.txt\n' +
          'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:4 # ca-fallback: replaced mirror, tried last\n'
      );
      expect(readFileSync(join(root, 'apt.conf.d', '80-ca-bounded-fetch'), 'utf8')).toBe(
        'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAcquire::Retries "3";\n'
      );
      const again = run();
      expect(again).toContain('updated 0 source files');
      expect(again).toContain('bounded fetches already set');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  const entryPoint = (root: string, args: string[], env: Record<string, string> = {}) =>
    execFileSync('bash', ['scripts/ci/ubuntu-apt.sh', ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, UBUNTU_APT_ROOT: root, UBUNTU_APT_SUDO: '', ...env },
    });
  const firstHost = (list: string) =>
    list
      .split('\n')
      .filter((line) => /priority:\d+/.test(line.split('#')[0]))
      .sort(
        (a, b) => Number(/priority:(\d+)/.exec(a)![1]) - Number(/priority:(\d+)/.exec(b)![1])
      )[0]
      .split(/\s/)[0];

  // A STALLED ATTEMPT IS CUT OFF AND RETRIED ON ANOTHER HOST (2026-11-19).
  it('bounds every attempt and retries a stalled install on a different mirror', () => {
    const root = mkdtempSync(join(tmpdir(), 'ca-apt-entry-'));
    try {
      mkdirSync(join(root, 'sources.list.d'));
      writeFileSync(
        join(root, 'sources.list.d', 'ubuntu.sources'),
        'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble\nComponents: main\n'
      );
      const mirror = join(root, 'apt-mirrors.txt');
      writeFileSync(mirror, 'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:1\n');
      const seen = join(root, 'seen.txt');
      // Each attempt records the host apt would try first; the first two
      // attempts hang past the one-second bound, the third succeeds.
      const probe =
        `python3 -c "import re,sys; t=open(sys.argv[1]).read().splitlines(); ` +
        `e=[l for l in t if re.search('priority:[0-9]+', l.split('#')[0])]; ` +
        `e.sort(key=lambda l:int(re.search('priority:([0-9]+)', l).group(1))); ` +
        `open(sys.argv[2],'a').write(e[0].split()[0]+chr(10))" "${mirror}" "${seen}"; ` +
        `[ "$(wc -l < "${seen}")" -ge 3 ] || sleep 10`;
      const started = Date.now();
      entryPoint(root, ['run', 'sh', '-c', probe], { UBUNTU_APT_ATTEMPT_SECONDS: '1' });
      expect(Date.now() - started).toBeLessThan(9000);
      const hosts = readFileSync(seen, 'utf8').trim().split('\n');
      expect(hosts).toEqual([
        'https://archive.ubuntu.com/ubuntu/',
        'http://us.archive.ubuntu.com/ubuntu',
        'http://azure.archive.ubuntu.com/ubuntu',
      ]);
      expect(firstHost(readFileSync(mirror, 'utf8'))).toBe(
        'http://azure.archive.ubuntu.com/ubuntu'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails after its bounded attempts instead of holding the step', () => {
    const root = mkdtempSync(join(tmpdir(), 'ca-apt-entry-'));
    try {
      mkdirSync(join(root, 'sources.list.d'));
      writeFileSync(
        join(root, 'sources.list.d', 'ubuntu.sources'),
        'URIs: mirror+file:/etc/apt/apt-mirrors.txt\n'
      );
      writeFileSync(
        join(root, 'apt-mirrors.txt'),
        'https://archive.ubuntu.com/ubuntu/\tpriority:1\n'
      );
      expect(() => entryPoint(root, ['run', 'false'], { UBUNTU_APT_ATTEMPTS: '2' })).toThrow(
        /failed after 2 attempts on different mirrors/
      );
      expect(() => entryPoint(root, ['run'])).toThrow();
      expect(() => entryPoint(root, ['install'])).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('points an image without Python at the shared list and rotates it between attempts', () => {
    const root = mkdtempSync(join(tmpdir(), 'ca-apt-entry-'));
    try {
      mkdirSync(join(root, 'sources.list.d'));
      writeFileSync(
        join(root, 'sources.list'),
        'deb http://archive.ubuntu.com/ubuntu/ focal main\ndeb http://security.ubuntu.com/ubuntu/ focal-security main\ndeb https://example.com/ubuntu focal main\n'
      );
      const image = { UBUNTU_APT_IMAGE: '1' };
      entryPoint(root, ['setup'], image);
      expect(readFileSync(join(root, 'sources.list'), 'utf8')).toBe(
        'deb mirror+file:/etc/apt/ca-ubuntu-mirrors.txt focal main\ndeb mirror+file:/etc/apt/ca-ubuntu-mirrors.txt focal-security main\ndeb https://example.com/ubuntu focal main\n'
      );
      const shared = readFileSync('scripts/ci/ubuntu-apt-mirrors.txt', 'utf8')
        .split('\n')
        .map((line) => line.replace(/#.*/, '').trim())
        .filter(Boolean);
      expect(shared.length).toBeGreaterThanOrEqual(3);
      const list = join(root, 'ca-ubuntu-mirrors.txt');
      expect(readFileSync(list, 'utf8')).toBe(
        shared.map((uri, i) => `${uri}\tpriority:${i + 1}\n`).join('')
      );
      expect(readFileSync(join(root, 'apt.conf.d', '80-ca-bounded-fetch'), 'utf8')).toBe(
        'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAcquire::Retries "3";\n'
      );
      entryPoint(root, ['rotate'], image);
      expect(readFileSync(list, 'utf8').split('\n')[0]).toBe(`${shared[1]}\tpriority:1`);
      // Idempotent: a second setup restores the list order and changes no source.
      entryPoint(root, ['setup'], image);
      expect(readFileSync(list, 'utf8').split('\n')[0]).toBe(`${shared[0]}\tpriority:1`);
      expect(readdirSync(root).filter((name) => name.endsWith('.ca-orig'))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('bounds the live-table browser installation too', () => {
    const workflow = parse(readFileSync('.github/workflows/post-deploy-e2e.yml', 'utf8'));
    const installs = Object.values(
      workflow.jobs as Record<string, { steps?: { name?: string; 'timeout-minutes'?: number }[] }>
    ).flatMap((job) =>
      (job.steps ?? []).filter((step) => step.name === 'Install Chromium and WebKit')
    );
    expect(installs.length).toBeGreaterThanOrEqual(2);
    for (const install of installs) {
      expect(install['timeout-minutes']).toBeGreaterThan(0);
      expect(install['timeout-minutes']).toBeLessThanOrEqual(10);
    }
  });

  it('refuses a missing source directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'ca-apt-mirror-'));
    try {
      expect(() =>
        execFileSync('python3', ['scripts/ci/ubuntu-apt-mirror.py', '--root', root], {
          stdio: 'pipe',
        })
      ).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
