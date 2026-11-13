/**
 * THE FIXTURE BUILDERS SHARE THE RUNTIME POSTGRESQL
 *
 * 2026-11-13: trixie-security published PostgreSQL 17.12. The native fixture's
 * runtime stage pins postgresql-17=17.11, but the builder stages named only
 * postgresql-server-dev-17 (or nothing), so libpq-dev pulled in by build
 * dependencies upgraded postgresql-17, libpq5 and the server headers to 17.12
 * inside the builders. Every PR's "Native fixture prerequisites / native-smoke"
 * then failed with 58P01 (internal_load_library), blocking the required
 * TypeScript Check for the whole repository.
 *
 * Every apt install in operations/release/fixture/Dockerfile that installs a
 * PostgreSQL 17 package or a build dependency that drags libpq-dev must name
 * postgresql-17, libpq5, libpq-dev and postgresql-server-dev-17 at the exact
 * version the runtime stage pins.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dockerfile = readFileSync(
  join(__dirname, '..', 'operations', 'release', 'fixture', 'Dockerfile'),
  'utf8'
);

function installs(): string[] {
  // One logical RUN per entry, continuation lines joined.
  return dockerfile
    .replace(/\\\n/g, ' ')
    .split('\n')
    .filter((l) => /apt-get install/.test(l));
}

describe('the fixture builders share the runtime PostgreSQL (2026-11-13)', () => {
  const runtime = dockerfile.match(/postgresql-17=(17\.\d+-[^\s\\]+)/);
  it('the runtime pins an exact PostgreSQL 17 version', () => {
    expect(runtime).not.toBeNull();
  });
  const version = runtime![1];

  it('every install that touches PostgreSQL or its client headers pins all of it to that version', () => {
    const touching = installs().filter((l) =>
      /postgresql-server-dev-17|libgdal-dev|libpq-dev|build-essential/.test(l)
    );
    expect(touching.length).toBeGreaterThanOrEqual(2);
    for (const line of touching) {
      for (const pkg of ['postgresql-17', 'libpq5', 'libpq-dev', 'postgresql-server-dev-17']) {
        expect(line, `${pkg} unpinned in a builder install`).toContain(`${pkg}=${version}`);
      }
    }
  });

  it('no install names a PostgreSQL package at any other version', () => {
    for (const line of installs()) {
      for (const m of line.matchAll(/\b(postgresql-17|postgresql-client-17|libpq5|libpq-dev|postgresql-server-dev-17)=(\S+)/g)) {
        expect(m[2]).toBe(version);
      }
    }
  });
});
