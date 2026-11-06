import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FLAG_REPOSITORY,
  FLAG_REPOSITORY_ID,
  FLAG_WORKFLOW,
  tournamentFlagProvider,
} from './HorseTournamentFlagQualification.js';

const ENV = {
  GITHUB_REPOSITORY: 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena',
  GITHUB_REPOSITORY_ID: '1132369872',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_RUN_ID: '41',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_TOKEN: 'test-token',
};
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
});
const withEnv = (over: Record<string, string | undefined>) => {
  process.env = { ...saved, ...ENV, ...over } as NodeJS.ProcessEnv;
};

describe('tournament flag provider repository identity', () => {
  it('names the transferred repository and its immutable id', () => {
    expect(FLAG_REPOSITORY).toBe('Smarter-Software-PIQ/Smarter-Poker-Club-Arena');
    expect(FLAG_REPOSITORY_ID).toBe(1132369872);
  });

  it('refuses the pre-transfer name and a missing or foreign repository id', async () => {
    for (const over of [
      { GITHUB_REPOSITORY: 'Smarter-Poker/Smarter-Poker-Club-Arena' },
      { GITHUB_REPOSITORY_ID: undefined },
      { GITHUB_REPOSITORY_ID: '1' },
    ]) {
      withEnv(over);
      await expect(tournamentFlagProvider('plo4_v53_icm_mtt')).rejects.toThrow(
        'Manual first-attempt provider admission required'
      );
    }
  });

  it('reads provider evidence from the current repository and refuses a foreign run', async () => {
    withEnv({});
    const urls: string[] = [];
    const run = {
      id: 41,
      event: 'workflow_dispatch',
      head_branch: 'main',
      path: FLAG_WORKFLOW,
      run_attempt: 1,
      head_sha: 'f'.repeat(40),
      repository: { id: 7, full_name: FLAG_REPOSITORY },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify(run), { status: 200 });
      })
    );
    await expect(tournamentFlagProvider('plo4_v53_icm_mtt')).rejects.toThrow(
      'Wrong provider workflow authority'
    );
    expect(urls[0]).toBe(
      'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/actions/runs/41'
    );
  });
});
