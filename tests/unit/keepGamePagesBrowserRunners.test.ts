import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

describe('supported post-deploy browser runners', () => {
  const workflow = YAML.parse(readFileSync('.github/workflows/post-deploy-e2e.yml', 'utf8'));
  it.each([
    'private-record-client-proof',
    'stats-pagination-proof',
    'production-e2e',
    'live-table-e2e',
    'club-channel-lifecycle-e2e',
  ])('%s retains the supported standard hosted browser image', (name) => {
    expect(workflow.jobs[name]['runs-on']).toBe('ubuntu-24.04');
    expect(workflow.jobs[name]['runs-on']).not.toMatch(/ca-linux|self-hosted|vars\./);
  });
});
