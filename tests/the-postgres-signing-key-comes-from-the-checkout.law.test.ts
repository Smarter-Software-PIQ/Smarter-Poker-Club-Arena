/**
 * THE POSTGRESQL SIGNING KEY COMES FROM THE CHECKOUT, NOT THE NETWORK
 * (2026-11-07).
 *
 * 66 workflows installed PostgreSQL 17 by first downloading the PGDG apt
 * signing key from www.postgresql.org / apt.postgresql.org. That one download
 * failed with `curl: (55) OpenSSL SSL_read ... unexpected eof` on 2026-11-07
 * in at least 11 jobs, every time before any test ran - including the backup
 * engine's certification run, the single-host bottleneck of every release.
 *
 * The key is a public file that does not change: it is now kept at
 * .github/pgdg/apt.postgresql.org.asc (fingerprint
 * B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8, byte-identical from both hosts on
 * 2026-11-07) and installed from the checkout. apt still verifies every
 * package against it, so a rotated key fails loudly at install.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const ROOT = resolve(__dirname, '..');
const WF = join(ROOT, '.github/workflows');
const KEY = join(ROOT, '.github/pgdg/apt.postgresql.org.asc');

describe('the postgres signing key comes from the checkout', () => {
  it('is the PGDG key, byte for byte', () => {
    const bytes = readFileSync(KEY);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76'
    );
    expect(bytes.toString('utf8')).toContain('-----BEGIN PGP PUBLIC KEY BLOCK-----');
  });

  it('no workflow downloads it', () => {
    for (const f of readdirSync(WF).filter((n) => /\.ya?ml$/.test(n))) {
      expect(readFileSync(join(WF, f), 'utf8'), f).not.toMatch(/ACCC4CF8\.asc/);
    }
  });

  it('every job that installs it has the key in its checkout first', () => {
    // Since 2026-11-07 every job installs through the one shared installer
    // (.github/actions/install-postgres-17), as an action step or by running
    // its install.sh; the checkout must carry the key and the installer.
    const installs = (s: any) =>
      String(s.uses ?? '') === './.github/actions/install-postgres-17' ||
      String(s.run ?? '').includes('.github/actions/install-postgres-17/install.sh');
    let jobs = 0;
    for (const f of readdirSync(WF).filter((n) => /\.ya?ml$/.test(n))) {
      const doc = parse(readFileSync(join(WF, f), 'utf8')) ?? {};
      for (const [name, job] of Object.entries<any>(doc.jobs ?? {})) {
        const steps: any[] = job.steps ?? [];
        const at = steps.findIndex(installs);
        if (at < 0) continue;
        jobs += 1;
        const checkout = steps
          .slice(0, at)
          .filter((s) => String(s.uses ?? '').startsWith('actions/checkout'))
          .pop();
        expect(checkout, `${f} ${name}: checkout before the key`).toBeTruthy();
        const w = checkout.with ?? {};
        expect(w.path, `${f} ${name}`).toBeUndefined();
        expect(w.repository, `${f} ${name}`).toBeUndefined();
        if (w['sparse-checkout']) {
          expect(String(w['sparse-checkout']), `${f} ${name}`).toMatch(/^\s*\.github\/pgdg\s*$/m);
          expect(String(w['sparse-checkout']), `${f} ${name}`).toMatch(
            /^\s*\.github\/actions\/install-postgres-17\s*$/m
          );
        }
      }
    }
    expect(jobs).toBeGreaterThanOrEqual(66);
  });

  it('the shared installer installs the checkout key at the path the PGDG source trusts', () => {
    const sh = readFileSync(join(ROOT, '.github/actions/install-postgres-17/install.sh'), 'utf8');
    expect(sh).toContain('PG_KEY_SRC="$GITHUB_WORKSPACE/.github/pgdg/apt.postgresql.org.asc"');
    expect(sh).toContain('PG_KEY_DST=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc');
    expect(sh).toContain('sudo install -m 0644 "$PG_KEY_SRC" "$PG_KEY_DST"');
    expect(sh).toContain('Signed-By: %s');
    expect(sh).not.toMatch(/ACCC4CF8\.asc|www\.postgresql\.org|sudo curl/);
  });
});
