/**
 * THE FIXTURE BUILDERS SHARE THE RUNTIME POSTGRESQL, AND DEBIAN MOVING ON NEVER
 * BREAKS IT
 *
 * 2026-11-13: trixie-security published PostgreSQL 17.12. The native fixture's
 * runtime stage pinned postgresql-17=17.11, but the builder stages named only
 * postgresql-server-dev-17 (or nothing), so libpq-dev pulled in by build
 * dependencies upgraded postgresql-17, libpq5 and the server headers to 17.12
 * inside the builders. Every PR's "Native fixture prerequisites / native-smoke"
 * then failed with 58P01 (internal_load_library), blocking the required
 * TypeScript Check for the whole repository.
 *
 * 2026-11-21: the Debian 13.8 point release removed 17.11-0+deb13u1 and
 * wal2json 2.6-2+b1 from deb.debian.org. Exact `pkg=version` APT pins can only
 * name what the archive still publishes, so every native build failed with
 * "Version '17.11-0+deb13u1' for 'postgresql-17' was not found" (runs
 * 44891884720, 44892437918, 44895568497) and the required check went red again.
 *
 * The law, in operations/release/fixture/Dockerfile:
 *  - one `postgres-debs` stage lists every PostgreSQL package exactly once,
 *    with its exact version, Debian pool path, SHA-1 and SHA-256; no other line
 *    writes a PostgreSQL package version;
 *  - the server, client, libpq and headers share one version;
 *  - the files come from deb.debian.org first and, once Debian has dropped the
 *    version, from snapshot.debian.org's content-addressed archive by SHA-1;
 *    every byte is checked against the listed SHA-256;
 *  - the runtime and every builder install those same files (never a package
 *    name APT resolves from the archive), hold them, and prove the installed
 *    versions equal the list.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dockerfile = readFileSync(
  join(__dirname, '..', 'operations', 'release', 'fixture', 'Dockerfile'),
  'utf8'
);
// One logical instruction per entry, continuation lines joined.
const logical = dockerfile.replace(/\\\n/g, ' ').split('\n');
const code = logical.filter((l) => !/^\s*#/.test(l));

const CORE = [
  'postgresql-17',
  'postgresql-client-17',
  'libpq5',
  'libpq-dev',
  'postgresql-server-dev-17',
];
const RUNTIME = [
  'postgresql-17',
  'postgresql-client-17',
  'libpq5',
  'postgresql-17-pgvector',
  'postgresql-17-wal2json',
];
const ALL = [...new Set([...CORE, ...RUNTIME])];
const DEB = (name: string) => `/opt/postgres-debs/${name}.deb`;
const MOUNT =
  '--mount=type=bind,from=postgres-debs,source=/opt/postgres-debs,target=/opt/postgres-debs';

type Pin = { name: string; version: string; pool: string; sha1: string; sha256: string };

function pins(): Pin[] {
  const stage = code.findIndex((l) => /^FROM node AS postgres-debs$/.test(l));
  expect(stage, 'the postgres-debs stage exists').toBeGreaterThanOrEqual(0);
  const run = code[stage + 1];
  const rows = [...run.matchAll(/\["([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)"\]/g)];
  return rows.map((m) => ({ name: m[1], version: m[2], pool: m[3], sha1: m[4], sha256: m[5] }));
}

function installs(): string[] {
  return code.filter((l) => /apt-get install/.test(l));
}

describe('the fixture PostgreSQL is one exact, checksum-pinned set that survives Debian (2026-11-13, 2026-11-21)', () => {
  it('lists every PostgreSQL package exactly once with version, pool path, SHA-1 and SHA-256', () => {
    const list = pins();
    expect(list.map((p) => p.name).sort()).toEqual([...ALL].sort());
    for (const p of list) {
      expect(p.pool).toMatch(
        new RegExp(
          `^pool/main/[a-z0-9]+/[a-z0-9.+-]+/${p.name.replace(/[+.]/g, '\\$&')}_${p.version.replace(/[+.]/g, '\\$&')}_amd64\\.deb$`
        )
      );
      expect(p.sha1).toMatch(/^[0-9a-f]{40}$/);
      expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('gives the server, client, libpq and headers one version', () => {
    const versions = new Set(
      pins()
        .filter((p) => CORE.includes(p.name))
        .map((p) => p.version)
    );
    expect(versions.size).toBe(1);
  });

  it('writes each PostgreSQL package version nowhere but that list', () => {
    for (const p of pins()) {
      const outside = code.filter((l) => l.includes(p.version) && !l.includes(`"${p.version}"`));
      expect(outside, `${p.version} written outside the postgres-debs list`).toEqual([]);
    }
    for (const line of code) {
      expect(line, 'an APT version pin on a PostgreSQL package').not.toMatch(
        /\b(postgresql-17|postgresql-client-17|libpq5|libpq-dev|postgresql-server-dev-17|postgresql-17-pgvector|postgresql-17-wal2json)=/
      );
    }
  });

  it('fetches deb.debian.org first, falls back to snapshot.debian.org by SHA-1, and checks every byte against SHA-256', () => {
    const stage = code.findIndex((l) => /^FROM node AS postgres-debs$/.test(l));
    const run = code[stage + 1];
    const main = run.indexOf('"https://deb.debian.org/debian/"+pool');
    const security = run.indexOf(
      '"https://deb.debian.org/debian-security/"+pool.replace("pool/main/","pool/updates/main/")'
    );
    const snapshot = run.indexOf('"https://snapshot.debian.org/file/"+sha1');
    expect(main).toBeGreaterThan(0);
    expect(security).toBeGreaterThan(main);
    expect(snapshot).toBeGreaterThan(security);
    expect(run).toContain('createHash("sha256").update(body).digest("hex")');
    expect(run).toMatch(/if\(actual!==sha256\)\{[^}]*process\.exit\(1\);\}/);
    // snapshot.debian.org stays out of the APT sources (2026-11-05: 504s on hosted runners).
    for (const line of code.filter((l) => /sources\.list/.test(l))) {
      expect(line).not.toContain('snapshot.debian.org');
    }
  });

  it('the runtime installs the listed files, holds them and proves their versions', () => {
    const runtime = installs().filter((l) => l.includes(DEB('postgresql-17-wal2json')));
    expect(runtime).toHaveLength(1);
    const line = runtime[0];
    expect(line).toContain(MOUNT);
    for (const name of RUNTIME) expect(line).toContain(DEB(name));
    expect(line).toContain(`apt-mark hold ${RUNTIME.join(' ')}`);
    expect(line).toMatch(
      new RegExp(`node -e '[^']*/opt/postgres-debs/versions[^']*' ${RUNTIME.join(' ')}`)
    );
  });

  it('every builder install that touches PostgreSQL or its headers installs the same files and proves their versions', () => {
    const touching = installs().filter((l) =>
      /postgresql-server-dev-17|libgdal-dev|libpq-dev|build-essential/.test(l)
    );
    expect(touching.length).toBeGreaterThanOrEqual(2);
    for (const line of touching) {
      expect(line).toContain(MOUNT);
      for (const name of CORE)
        expect(line, `${name} not installed from postgres-debs`).toContain(DEB(name));
      expect(line).toMatch(
        new RegExp(
          `node -e '[^']*/opt/postgres-debs/versions[^']*' ${RUNTIME.join(' ')} libpq-dev postgresql-server-dev-17`
        )
      );
    }
  });

  it('no install lets APT resolve a PostgreSQL package by name from the archive', () => {
    for (const line of installs()) {
      const args = line
        .replace(/\/opt\/postgres-debs\/\S+\.deb/g, '')
        .replace(/apt-mark hold[^&]*/g, '')
        .replace(/node -e '[^']*'[^&]*/g, '');
      expect(args, 'a PostgreSQL package named for APT to resolve').not.toMatch(
        /(?:^|\s)(postgresql-17|postgresql-client-17|libpq5|libpq-dev|postgresql-server-dev-17|postgresql-17-pgvector|postgresql-17-wal2json)(?=\s|$)/
      );
    }
  });
});
