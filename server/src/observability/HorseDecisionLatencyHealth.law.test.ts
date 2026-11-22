/**
 * LAW: per-worker >100 ms decision latency telemetry is read-only, bounded,
 * surfaced on /health, has zero runtime imports, and never touches worker
 * decision logic; post-cutover-audit remains strictly read-only with zero .env reads.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { horseDecisionRuntimeSpecifiers } from '../engine/HorseDecisionClosure.js';

const serverRoot = fileURLToPath(new URL('../../', import.meta.url));
const repoRoot = path.resolve(serverRoot, '..');
const readServer = (rel: string) => readFileSync(path.join(serverRoot, rel), 'utf8');
const readRepo = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');

describe('LAW — per-worker >100 ms decision latency /health telemetry and read-only cutover audit', () => {
  it('wires horseDecisionLatency onto /health without touching dealerReady routing readiness', () => {
    const healthSrc = readServer('src/handlers/health.ts');
    expect(healthSrc).toContain('horseDecisionLatencyHealth');
    expect(healthSrc).toContain('horseDecisionLatency');
    const dealerReadyBlock = healthSrc.slice(
      healthSrc.indexOf('const dealerReady ='),
      healthSrc.indexOf('const horseJournal =')
    );
    expect(dealerReadyBlock).not.toContain('horseDecisionLatency');
    expect(dealerReadyBlock).not.toContain('starvationAlert');
  });

  it('records FAST decision latency in horseDecision/lane.ts after resolution with zero decision-path imports', () => {
    const laneSrc = readServer('src/engine/horseDecision/lane.ts');
    expect(laneSrc).toContain('recordHorseDecisionLatencySample');
    const captureIdx = laneSrc.indexOf('this.observerParticipants.capture(original)');
    const recordIdx = laneSrc.indexOf('recordHorseDecisionLatencySample({');
    const returnIdx = laneSrc.indexOf('return result;', recordIdx);
    expect(captureIdx).toBeGreaterThan(-1);
    expect(recordIdx).toBeGreaterThan(captureIdx);
    expect(returnIdx).toBeGreaterThan(recordIdx);

    // Pure leaf observability module: zero runtime imports of its own.
    const trackerSrc = readServer('src/observability/HorseDecisionLatencyHealth.ts');
    expect(horseDecisionRuntimeSpecifiers(trackerSrc)).toEqual([]);

    // Never imported inside worker decision computation or client protocol layers.
    for (const rel of [
      'src/engine/HorseLogic.ts',
      'src/engine/horseDecision/worker.ts',
      'src/engine/horseDecision/workerRuntime.ts',
      'src/engine/horseDecision/client.ts',
    ]) {
      expect(readServer(rel), rel).not.toContain('HorseDecisionLatencyHealth');
    }
  });

  it('keeps post-cutover-audit strictly read-only via linked Supabase CLI with zero .env reads', () => {
    const cliSrc = readRepo('scripts/ops/post-cutover-audit.mjs');
    const libSrc = readRepo('scripts/ops/post-cutover-audit-lib.mjs');
    expect(cliSrc).toContain("'--linked'");
    expect(cliSrc).toContain("'--agent=no'");
    expect(libSrc).toContain('assertReadOnlySql');
    for (const src of [cliSrc, libSrc]) {
      expect(src).not.toMatch(/dotenv/i);
      expect(src).not.toMatch(/readFileSync\([^)]*\.env/);
      expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|POSTGRES_URL/);
    }
  });
});
