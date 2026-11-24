import { parse } from 'yaml';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 2026-11-17: four Promo Play Through outages on its first enforced day came
// from guards meeting a real tournament shape the proofs never modelled, and
// the promo workflow only ran on migrations named after promo. This law keeps
// the workflow required-shaped (reports on every pull request, any migration
// is relevant) and keeps every promo native proof actually invoked by it.
const path = '.github/workflows/promo-play-through.yml';
const text = readFileSync(path, 'utf8');
const workflow = parse(text);
const job = workflow.jobs['promo-play-through'];

describe('promo play-through is a required proof', () => {
  it('reports on every pull request and merge group, never behind a path filter', () => {
    expect(workflow.on.pull_request.branches).toEqual(['main']);
    expect(workflow.on.pull_request.paths).toBeUndefined();
    expect(workflow.on.merge_group.types).toEqual(['checks_requested']);
    expect(job.name).toBe('Promo play-through lock ledger and fee meter');
  });

  it('treats any migration as relevant and fails open when the diff cannot be read', () => {
    const relevant = job.steps.find((step: { id?: string }) => step.id === 'relevant');
    const paths: string[] = relevant.env.PROMO_PATHS.split('\n').filter(Boolean);
    expect(paths).toContain('supabase/migrations/**');
    expect(paths).toContain(path);
    expect(relevant.run).toContain('git diff --name-only --no-renames');
    expect(relevant.run).toContain('running every proof');
    const after = job.steps.slice(job.steps.indexOf(relevant) + 1);
    for (const step of after) {
      expect(step.if ?? '').toContain("steps.relevant.outputs.run == 'true'");
    }
  });

  it('invokes every promo native proof in scripts/ci, directly or as a named sub-proof', () => {
    const files = readdirSync('scripts/ci');
    const proofs = files.filter((f) => /^test-promo-.*\.py$/.test(f));
    expect(proofs.length).toBeGreaterThan(15);
    const callers = files
      .filter((f) => /\.(py|mjs)$/.test(f))
      .map((f) => [f, readFileSync(`scripts/ci/${f}`, 'utf8')] as const);
    for (const proof of proofs) {
      const direct = text.includes(`scripts/ci/${proof}`);
      const nested = callers.some(([f, body]) => f !== proof && body.includes(proof));
      expect(direct || nested, `${proof} is run by no workflow or proof`).toBe(true);
    }
  });

  it('runs the obligation earning matrix and refuses a run that proved nothing', () => {
    expect(text).toContain(
      'python3 -B scripts/ci/test-promo-obligation-earning-matrix.py --pg-bin /usr/lib/postgresql/17/bin'
    );
    expect(text).toContain('v.get("checks",0)>=192');
    const matrix = readFileSync('scripts/ci/test-promo-obligation-earning-matrix.py', 'utf8');
    for (const kind of [
      'place',
      'bubble_protection',
      'final_table_deal',
      'seat',
      'satellite_remainder',
      'refund',
      'bounty_residual',
      'own_bounty',
      'bounty',
      'mystery_bounty',
      'equal_share',
      'equal_share_bounty',
    ]) {
      expect(matrix).toContain(`'${kind}'`);
    }
    expect(matrix).toContain("PLAYERS = ['human', 'horse']");
  });
});
