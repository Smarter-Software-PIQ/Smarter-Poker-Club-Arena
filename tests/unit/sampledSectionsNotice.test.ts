/**
 * WHAT IS SAMPLED, EXACTLY (2026-11-04). The stats page used to say every
 * analysis panel ran on the most recent 750 hands. Since migration
 * 20261104194608 the breakdowns by position, game and stake cover every hand
 * in the range; the payload names what still samples and the notice must say
 * only that.
 */
import { describe, expect, it } from 'vitest';
import { sampledSectionsNotice } from '../../src/pages/stats/StatsHeadlineDeck';
import { normalizeStatsContractMetadata } from '../../src/services/statsContract';

describe('sampledSectionsNotice', () => {
  it('keeps the blanket wording for an older payload that names nothing', () => {
    expect(sampledSectionsNotice({ analysis_hand_cap: 750 })).toBe(
      'Analysis Panels Use Your Most Recent 750 Hands. Headline Totals Still Include Every Hand In This Range.'
    );
  });

  it('says nothing when no section samples', () => {
    expect(
      sampledSectionsNotice({ analysis_hand_cap: 750, analysis_sampled_sections: [] })
    ).toBeNull();
  });

  it('names exactly the sampled sections', () => {
    expect(
      sampledSectionsNotice({ analysis_hand_cap: 750, analysis_sampled_sections: ['sessions'] })
    ).toBe(
      'Session History Uses Your Most Recent 750 Hands. Every Other Figure On This Page Includes Every Hand In This Range.'
    );
    expect(
      sampledSectionsNotice({
        analysis_hand_cap: 750,
        analysis_sampled_sections: ['sessions', 'positions'],
      })
    ).toContain('Session History And Position Breakdown Uses');
  });

  it('the contract normalizer carries the list through and drops non-strings', () => {
    const contract = normalizeStatsContractMetadata({
      contract_version: 2,
      coverage: {
        analysis_hand_cap: 750,
        analysis_hands_capped: true,
        analysis_sampled_sections: ['sessions', 7],
      },
    });
    expect(contract.coverage.analysis_sampled_sections).toEqual(['sessions']);
    const older = normalizeStatsContractMetadata({
      contract_version: 2,
      coverage: { analysis_hand_cap: 750 },
    });
    expect(older.coverage.analysis_sampled_sections).toBeUndefined();
  });
});
