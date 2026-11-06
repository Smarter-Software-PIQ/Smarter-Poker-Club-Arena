/**
 * LAW: a hashed Horse policy source ships in the engine image.
 *
 * Every phase authority recomputes its policy digest at boot from the exact
 * bytes of the files its source list names, read from the server root
 * (`/app` in the image). Dan's 2026-10-26 forced activation issues an
 * authority for the running code only when that digest exists. On Nov 5
 * 2026 the first release carrying #8605 (67bc0e85) hashed two files the
 * runtime image did not carry (`native/public_hist215_wtl.cc`,
 * `scripts/build-public-hist215-native.mjs`, compiled in a builder stage and
 * never copied forward), every digest was null, and phases 8, 10, 11, 12, 13
 * and 14 silently fell to shadow for three releases with no receipt.
 *
 * This law resolves every path in every running source list against the
 * runtime stage's COPY set in `server/Dockerfile`, so a path added to any
 * list without a matching COPY fails CI; it pins the image build gate that
 * refuses the same condition at build time; and it pins the boot receipt that
 * names an unreadable path instead of letting it degrade to shadow in silence.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseOwnerForcedAuthority } from './HorseOwnerForcedActivation.js';
import {
  HORSE_POLICY_SOURCE_UNREADABLE_FIRE,
  horsePolicySourceLists,
  horsePolicySourceManifest,
  reportHorsePolicySourcesAtBoot,
  runningHorsePolicySourceReader,
  unreadableHorsePolicySources,
} from './HorsePolicySourceManifest.js';
import { HORSE_REFERENCE_DECISION_SOURCE_FILES } from './HorseReferenceDecisionSources.js';

const serverRoot = fileURLToPath(new URL('../../', import.meta.url));
const dockerfile = readFileSync(`${serverRoot}Dockerfile`, 'utf8');

/** The runtime stage: everything after the last FROM. */
function runtimeStage(text: string): string {
  const froms = [...text.matchAll(/^FROM .*$/gm)];
  const last = froms[froms.length - 1];
  if (!last || last.index === undefined) throw new Error('Dockerfile has no FROM');
  return text.slice(last.index);
}

interface CopySet {
  readonly files: Set<string>;
  readonly dirs: string[];
}

/** The destination paths (relative to /app) of every plain COPY in the runtime
 * stage. `COPY --from=` is a build-stage artifact, not a source file: a hashed
 * source must be copied from the build context so its bytes are the reviewed
 * bytes. Destinations ending in `/` are directory prefixes. */
function runtimeCopySet(text: string): CopySet {
  const files = new Set<string>();
  const dirs: string[] = [];
  for (const line of runtimeStage(text).split('\n')) {
    const m = /^COPY\s+(?!--from)(.+)$/.exec(line.trim());
    if (!m) continue;
    const parts = m[1].split(/\s+/).filter((p) => !p.startsWith('--'));
    const dest = parts[parts.length - 1].replace(/^\.\//, '');
    const sources = parts.slice(0, -1);
    if (dest.endsWith('/')) {
      if (sources.length === 1 && sources[0].endsWith('/')) dirs.push(dest);
      else for (const s of sources) files.add(dest + s.replace(/^\.\//, '').split('/').pop()!);
    } else files.add(dest);
  }
  return { files, dirs };
}

function copiedIntoImage(path: string, copies: CopySet): boolean {
  if (copies.files.has(path)) return true;
  return copies.dirs.some((d) => d === '' || path.startsWith(d));
}

const escape = (p: string) => p.replace(/[./]/g, '\\$&');

describe('a hashed Horse policy source ships in the engine image', () => {
  const copies = runtimeCopySet(dockerfile);

  it('the manifest is the union of every running source list and is non-trivial', () => {
    const manifest = horsePolicySourceManifest();
    expect(manifest.length).toBeGreaterThan(50);
    for (const [owner, list] of Object.entries(horsePolicySourceLists()))
      for (const p of list) expect(manifest, `${owner}: ${p}`).toContain(p);
    for (const p of HORSE_REFERENCE_DECISION_SOURCE_FILES) expect(manifest).toContain(p);
  });

  it('every hashed path resolves to a runtime-stage COPY in server/Dockerfile', () => {
    const missing = horsePolicySourceManifest().filter((p) => !copiedIntoImage(p, copies));
    expect(
      missing,
      `add a runtime-stage COPY to server/Dockerfile for every hashed path:\n${missing.join('\n')}`
    ).toEqual([]);
  });

  it('the two #8605 paths that broke the Nov 5 releases are copied from the build context', () => {
    for (const p of ['native/public_hist215_wtl.cc', 'scripts/build-public-hist215-native.mjs']) {
      expect(HORSE_REFERENCE_DECISION_SOURCE_FILES).toContain(p);
      expect(copies.files.has(p), p).toBe(true);
      expect(runtimeStage(dockerfile)).toMatch(
        new RegExp(`^COPY ${escape(p)} \\./${escape(p)}$`, 'm')
      );
    }
  });

  it('every hashed path exists in the server tree, so the build-context COPY has a source', () => {
    for (const p of horsePolicySourceManifest())
      expect(existsSync(`${serverRoot}${p}`), p).toBe(true);
    expect(unreadableHorsePolicySources(runningHorsePolicySourceReader)).toEqual([]);
  });

  it('the image build runs the shipped-sources gate after the runtime emit and before pruning', () => {
    const stage = runtimeStage(dockerfile);
    const emit = stage.indexOf('tsconfig.emit.json');
    const gate = stage.indexOf('node dist/engine/horsePolicySourcesShippedMain.js');
    const prune = stage.indexOf('npm prune');
    expect(emit).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(emit);
    expect(prune).toBeGreaterThan(gate);
    expect(existsSync(`${serverRoot}src/engine/horsePolicySourcesShippedMain.ts`)).toBe(true);
  });

  it('a missing hashed file is named at boot: console error, error report and a telemetry receipt', () => {
    enableBrainTelemetry();
    drainFires();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const missing = 'native/public_hist215_wtl.cc';
      const unreadable = reportHorsePolicySourcesAtBoot((path) => {
        if (path === missing)
          throw new Error(`ENOENT: no such file or directory, open '/app/${path}'`);
        return runningHorsePolicySourceReader(path);
      });
      expect(unreadable.map((u) => u.path)).toEqual([missing]);
      const text = error.mock.calls.map((c) => String(c[0])).join('\n');
      expect(text).toContain(missing);
      expect(text).toContain('server/Dockerfile must COPY');
      expect(text).toContain('falls to shadow');
      const fires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
      expect(fires[HORSE_POLICY_SOURCE_UNREADABLE_FIRE]).toBe(1);
      expect(reportHorsePolicySourcesAtBoot()).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });

  it('a null policy digest can never be invisible: the forced authority fires its own receipt', () => {
    enableBrainTelemetry();
    drainFires();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const forced = horseOwnerForcedAuthority({
        phase: 'phase10',
        continuationVersion: 'v',
        policyDigest: null,
        packId: 'p',
        domain: 'd',
      });
      expect(forced).toBeNull();
      const fires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
      expect(fires.horse_owner_forced_authority_digest_unavailable).toBe(1);
      expect(fires.horse_owner_forced_authority_digest_unavailable_phase10).toBe(1);
      expect(error).toHaveBeenCalled();
      expect(String(error.mock.calls[0][0])).toContain('phase10');
    } finally {
      error.mockRestore();
    }
  });
});
