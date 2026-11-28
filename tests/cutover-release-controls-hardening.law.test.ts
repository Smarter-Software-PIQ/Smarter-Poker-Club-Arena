/**
 * LAW: Cutover release-control hardening (Wave B-2, 2026-11-28).
 *
 * Pins the five release-control wiring invariants across the Hetzner deploy,
 * post-cutover receipt, Backup Engine, and installed-migration classifier:
 *   1. Read-only host posture & image pre-flight (scripts/release/check-host-posture.sh)
 *      runs over the existing fail-closed $HSSH wrapper before activation/freeze,
 *      with hard fail-closed floors (disk >= 15 GiB, inode < 85%, clock skew < 250ms,
 *      candidate + rollback images) and visible warnings (inode >= 70%, daemon.json).
 *   2. Pre-cutover (:45) /health snapshot is captured before swap and compared post-seal
 *      and at :15 via scripts/release/post-cutover-baseline-diff.py (exits 0/1/2/3).
 *   3. Deterministic 120s post-swap live canary (scripts/release/post-swap-canary.py)
 *      runs strictly inside auto-deploy-hetzner.yml (zero cron/watcher) before final
 *      receipt seal, triggering audited deterministic host rollback on hard SLO breach,
 *      and engine-release-transaction.sh enforces hard SLO invariants in-break.
 *   4. Backup Engine pins the 3rd-SHA selectable certified fallback image via
 *      BACKUP_FALLBACK_SHA + newest_certified_fallback_sha so a late failed
 *      certification never evicts the cycle's selectable fallback image.
 *   5. Machine-verified fail-closed inert_versions() classifies strictly non-engine
 *      (training_*, social_*, club_announcements, ui_*, cosmetic_*, analytics_*)
 *      migrations as inert while rejecting every engine/money/horse/function/ambiguous DDL.
 */
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const TMP_BASE = join(ROOT, 'node_modules', '.tmp');

const DEPLOY_WF = read('.github/workflows/auto-deploy-hetzner.yml');
const RECEIPT_WF = read('.github/workflows/post-cutover-receipt.yml');
const BACKUP_WF = read('.github/workflows/backup-engine.yml');
const STANDBY_PATH = join(ROOT, 'server/standby/standby-engine.sh');
const INSTALLED_MIGRATIONS = join(ROOT, 'server/scripts/engine-release-installed-migrations.py');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules' && name !== '__tests__') walk(full, out);
    } else if (/\.(ts|js|mjs|cjs)$/.test(name) && !/\.test\.|\.spec\./.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function classifyInert(texts: string[]): boolean[] {
  const py = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location('m', ${JSON.stringify(INSTALLED_MIGRATIONS)})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'print(json.dumps([m.engine_inert(t) for t in json.load(sys.stdin)]))',
  ].join('\n');
  const res = spawnSync('python3', ['-B', '-c', py], {
    input: JSON.stringify(texts),
    encoding: 'utf8',
  });
  expect(res.status, res.stderr).toBe(0);
  return JSON.parse(res.stdout) as boolean[];
}

describe('Wave B-2 cutover release-control hardening', () => {
  it('1. auto-deploy-hetzner.yml wires read-only host posture pre-flight before activation/swap', () => {
    const doc = parse(DEPLOY_WF) as {
      jobs: { deploy: { steps: Array<{ id?: string; run?: string }> } };
    };
    const steps = doc.jobs.deploy.steps;
    const prepareIdx = steps.findIndex((s) => s.id === 'prepare');
    const postureIdx = steps.findIndex((s) => s.id === 'host_posture');
    const floorIdx = steps.findIndex((s) => s.id === 'floor');
    const releaseIdx = steps.findIndex((s) => s.id === 'release');
    expect(prepareIdx).toBeGreaterThan(-1);
    expect(postureIdx).toBeGreaterThan(prepareIdx);
    expect(postureIdx).toBeLessThan(floorIdx);
    expect(floorIdx).toBeLessThan(releaseIdx);

    const run = String(steps[postureIdx].run ?? '');
    expect(run).toContain('scripts/release/check-host-posture.sh');
    expect(run).toContain('--local');
    expect(run).toContain('--min-free-gib 15');
    expect(run).toContain('--max-inode-pct 85');
    expect(run).toContain('--warn-inode-pct 70');
    expect(run).toContain('--max-clock-skew-ms 250');
    expect(run).toContain('--docker-log-rotation warn');
    expect(run).toContain('--require-image');
    expect(run).toContain('GITHUB_STEP_SUMMARY');
    // Uses existing fail-closed $HSSH wrapper (no raw SSH auth patterns)
    expect(run).toContain('"$HSSH"');
    // Exit path names host_posture if it fails closed
    expect(DEPLOY_WF).toContain('host_posture=${{ steps.host_posture.outcome }}');
  });

  it('2. pre-cutover /health snapshot and post-cutover baseline diff are wired into deploy and receipt workflows', () => {
    const deployDoc = parse(DEPLOY_WF) as {
      jobs: { deploy: { steps: Array<{ id?: string; run?: string; uses?: string }> } };
    };
    const steps = deployDoc.jobs.deploy.steps;
    const preIdx = steps.findIndex((s) => s.id === 'pre_cutover_health');
    const releaseIdx = steps.findIndex((s) => s.id === 'release');
    const verifyIdx = steps.findIndex((s) => s.id === 'verify');
    const diffIdx = steps.findIndex((s) => s.id === 'baseline_diff');
    expect(preIdx).toBeGreaterThan(-1);
    expect(preIdx).toBeLessThan(releaseIdx);
    expect(diffIdx).toBeGreaterThan(verifyIdx);

    const diffRun = String(steps[diffIdx].run ?? '');
    expect(diffRun).toContain('scripts/release/post-cutover-baseline-diff.py');
    expect(diffRun).toContain('GITHUB_STEP_SUMMARY');
    // Explicit handling for exit 0, 1 (breach), 2 (warning), 3 (unreadable)
    expect(diffRun).toMatch(/\b1\)/);
    expect(diffRun).toMatch(/\b2\)/);
    expect(diffRun).toMatch(/\b3\)/);

    // post-cutover-receipt.yml also runs the :45 vs :15 baseline diff cleanly
    expect(RECEIPT_WF).toContain('scripts/release/post-cutover-baseline-diff.py');
    expect(RECEIPT_WF).toContain('pre-cutover-health-');
    expect(RECEIPT_WF).toContain('GITHUB_STEP_SUMMARY');
  });

  it('3. deterministic post-swap live canary check and rollback guard are wired strictly inside deploy flow', () => {
    const deployDoc = parse(DEPLOY_WF) as {
      on?: Record<string, unknown>;
      jobs: {
        deploy: {
          outputs: Record<string, string>;
          steps: Array<{ id?: string; if?: string; run?: string }>;
        };
      };
    };
    // Zero timers/crons added
    expect(deployDoc.on).not.toHaveProperty('schedule');

    const steps = deployDoc.jobs.deploy.steps;
    const verifyIdx = steps.findIndex((s) => s.id === 'verify');
    const canaryIdx = steps.findIndex((s) => s.id === 'canary');
    const receiptIdx = steps.findIndex((s) => s.id === 'gameplay_receipt');
    expect(canaryIdx).toBeGreaterThan(verifyIdx);
    expect(canaryIdx).toBeLessThan(receiptIdx);

    const canaryRun = String(steps[canaryIdx].run ?? '');
    expect(canaryRun).toContain('scripts/release/post-swap-canary.py');
    expect(canaryRun).toContain('--duration-seconds');
    expect(canaryRun).toContain('--mode rollback');
    expect(canaryRun).toContain('install-engine-drill.sh');
    expect(canaryRun).not.toMatch(/(?:engine-up|engine-supervisor)\.sh/);
    expect(canaryRun).toContain('GITHUB_STEP_SUMMARY');
    expect(deployDoc.jobs.deploy.outputs.shipped).toContain(
      "steps.canary.outputs.passed != 'false'"
    );
    expect(DEPLOY_WF).toContain('canary=${{ steps.canary.outcome }}');
  });

  it('4. 3rd-SHA fallback image pinning in backup-engine.yml and standby-engine.sh survives late failed certifications', () => {
    expect(BACKUP_WF).toContain('BACKUP_FALLBACK_SHA');
    expect(BACKUP_WF).toMatch(/BACKUP_FALLBACK_SHA=[^\n]*standby-engine certify/);

    // Execute real standby-engine.sh: a late failed certification MUST NOT evict the cycle's newest certified fallback
    mkdirSync(TMP_BASE, { recursive: true });
    const dir = mkdtempSync(join(TMP_BASE, 'fallback-pin-'));
    try {
      const certDir = join(dir, 'certs');
      const logDir = join(dir, 'log');
      const stateDir = join(dir, 'state');
      mkdirSync(certDir, { recursive: true });
      mkdirSync(logDir, { recursive: true });
      mkdirSync(stateDir, { recursive: true });

      const CANDIDATE = '1'.repeat(40);
      const SERVING = '2'.repeat(40);
      const FALLBACK = '3'.repeat(40);
      const LATE_FAILED = '4'.repeat(40);
      const STALE_OTHER = '5'.repeat(40);

      const fbPath = join(certDir, `${FALLBACK}.json`);
      writeFileSync(fbPath, JSON.stringify({ sha: FALLBACK, verdict: 'pass' }));
      const earlier = Date.now() / 1000 - 3600;
      utimesSync(fbPath, earlier, earlier);

      // Newer failed certification written AFTER fallback
      const failPath = join(certDir, `${LATE_FAILED}.json`);
      writeFileSync(failPath, JSON.stringify({ sha: LATE_FAILED, verdict: 'fail' }));

      const calls = join(dir, 'docker-calls');
      writeFileSync(calls, '');
      const script = `
set -Eeuo pipefail
source ${JSON.stringify(STANDBY_PATH)}
STATE_DIR=${JSON.stringify(stateDir)}
CERT_DIR=${JSON.stringify(certDir)}
LOG_DIR=${JSON.stringify(logDir)}
docker() {
  echo "$*" >> ${JSON.stringify(calls)}
  case "$1 $2" in
    "image ls")
      case "$*" in
        *club-arena-engine-standby*)
          printf '%s\\n' \\
            club-arena-engine-standby:${CANDIDATE} \\
            club-arena-engine-standby:${SERVING} \\
            club-arena-engine-standby:${FALLBACK} \\
            club-arena-engine-standby:${LATE_FAILED} \\
            club-arena-engine-standby:${STALE_OTHER} ;;
      esac ;;
    "image inspect") date -u -d '-3 days' +%FT%TZ ;;
    "info -f") echo /var/lib/docker ;;
  esac
  return 0
}
df() { printf 'Filesystem 1G-blocks Used Available Capacity Mounted\\n/dev/sda 300G 200G 100G 66%% /\\n'; }
fb="$(newest_certified_fallback_sha ${CANDIDATE} ${SERVING})"
echo "RESOLVED_FALLBACK=$fb"
reclaim_backup_disk ${CANDIDATE} ${SERVING} "$fb"
`;
      const res = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
      expect(res.status, res.stderr).toBe(0);
      expect(res.stdout).toContain(`RESOLVED_FALLBACK=${FALLBACK}`);
      const removed = readFileSync(calls, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('image rm'));
      // Fallback image, serving image, and candidate image are ALL protected!
      expect(removed.join('\n')).not.toContain(FALLBACK);
      expect(removed.join('\n')).not.toContain(SERVING);
      expect(removed.join('\n')).not.toContain(CANDIDATE);
      // Late failed & stale other images ARE reclaimed!
      expect(removed).toContain(`image rm club-arena-engine-standby:${LATE_FAILED}`);
      expect(removed).toContain(`image rm club-arena-engine-standby:${STALE_OTHER}`);
      expect(res.stderr).toContain(`kept fallback ${FALLBACK.slice(0, 12)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('5. machine-verified inert_versions() classifies strictly non-engine migrations inert and rejects all engine/ambiguous DDL', () => {
    const inertCases: Record<string, string> = {
      'training table + index + RLS': `
-- Non-engine training UI table
BEGIN;
SET LOCAL lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS public.training_spot_bookmarks (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  spot_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, spot_id)
);
CREATE INDEX IF NOT EXISTS idx_training_spot_bookmarks_user
  ON public.training_spot_bookmarks (user_id, created_at DESC);
ALTER TABLE public.training_spot_bookmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY training_spot_bookmarks_own
  ON public.training_spot_bookmarks
  FOR SELECT
  USING (auth.uid() = user_id);
COMMIT;
`,
      'social table column add': `
ALTER TABLE public.social_feed_preferences ADD COLUMN IF NOT EXISTS compact_mode BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.social_feed_preferences.compact_mode IS 'Compact social feed layout';
`,
      'club_announcements index & view': `
CREATE INDEX IF NOT EXISTS idx_club_announcements_created ON public.club_announcements (created_at DESC);
CREATE OR REPLACE VIEW public.analytics_announcement_summary AS
  SELECT id, created_at FROM public.club_announcements;
`,
      'ui/cosmetic table insert': `
BEGIN;
INSERT INTO public.cosmetic_banner_themes (slug, label) VALUES ('midnight', 'Midnight') ON CONFLICT DO NOTHING;
UPDATE public.ui_feature_banners SET active = true WHERE slug = 'welcome';
COMMIT;
`,
    };

    const nonInertCases: Record<string, string> = {
      'touches clubs table': 'ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS badge TEXT;',
      'touches hand_history':
        'CREATE INDEX IF NOT EXISTS idx_hh_x ON public.hand_history (created_at);',
      'touches chip_ledger': 'ALTER TABLE public.chip_ledger ADD COLUMN IF NOT EXISTS note TEXT;',
      'touches tournaments': 'UPDATE public.tournaments SET name = name;',
      'touches table_seats': 'ALTER TABLE public.table_seats ADD COLUMN IF NOT EXISTS label TEXT;',
      'touches diamonds_ledger':
        'CREATE INDEX IF NOT EXISTS idx_dl ON public.diamonds_ledger (created_at);',
      'touches horse table':
        'ALTER TABLE public.ca_horse_style_switch ADD COLUMN IF NOT EXISTS x TEXT;',
      'mixed training + clubs': `
CREATE TABLE IF NOT EXISTS public.training_x (id UUID PRIMARY KEY);
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS x TEXT;
`,
      'training FK referencing clubs': `
CREATE TABLE IF NOT EXISTS public.training_club_links (
  id UUID PRIMARY KEY,
  club_id UUID REFERENCES public.clubs(id)
);
`,
      'training view joining hand_history': `
CREATE OR REPLACE VIEW public.training_hands_v AS
  SELECT id FROM public.hand_history;
`,
      'CREATE FUNCTION': `
CREATE OR REPLACE FUNCTION public.training_helper() RETURNS INT LANGUAGE sql AS 'SELECT 1';
`,
      'CREATE TRIGGER': `
CREATE TRIGGER trg_training AFTER INSERT ON public.training_x FOR EACH ROW EXECUTE FUNCTION public.fn_x();
`,
      'DO block': `
DO $$ BEGIN PERFORM 1; END $$;
`,
      'DROP TABLE': 'DROP TABLE IF EXISTS public.training_old;',
      'GRANT statement': 'GRANT SELECT ON public.training_x TO authenticated;',
      'smarter_private schema': 'CREATE TABLE IF NOT EXISTS smarter_private.training_x (id INT);',
      'unqualified unknown table': 'CREATE TABLE IF NOT EXISTS training_unqualified (id INT);',
      'unknown public table': 'CREATE TABLE IF NOT EXISTS public.mystery_table (id INT);',
      'window migration annotation': `
-- @install-window: daily-maintenance
CREATE INDEX IF NOT EXISTS idx_training_w ON public.training_x (id);
`,
      'block comment':
        '/* hidden */ CREATE INDEX IF NOT EXISTS idx_training_c ON public.training_x (id);',
      'policy subquery touching clubs': `
CREATE POLICY training_bad ON public.training_x FOR SELECT USING (EXISTS (SELECT 1 FROM public.clubs));
`,
    };

    const inertVerdicts = classifyInert(Object.values(inertCases));
    Object.keys(inertCases).forEach((label, i) => {
      expect(inertVerdicts[i], `expected inert=true for: ${label}`).toBe(true);
    });

    const nonInertVerdicts = classifyInert(Object.values(nonInertCases));
    Object.keys(nonInertCases).forEach((label, i) => {
      expect(nonInertVerdicts[i], `expected inert=false for: ${label}`).toBe(false);
    });
  });

  it('5b. PREMISE: no non-test engine code in server/src/ queries the allowlisted non-engine tables', () => {
    const hits: string[] = [];
    const tableQueryRe =
      /(?:\.from\(\s*['"`](?:training_|social_|ui_|cosmetic_|analytics_|club_announcements\b)|\bpublic\.(?:training_|social_|ui_|cosmetic_|analytics_|club_announcements\b))/;
    for (const file of walk(join(ROOT, 'server/src'))) {
      const src = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (tableQueryRe.test(src)) hits.push(file);
    }
    expect(hits).toEqual([]);
  });
});
