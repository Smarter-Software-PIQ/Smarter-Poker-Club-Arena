/**
 * THE MANIFEST REPORTS THE PHASE 14 MODE THE WORKERS DECIDE WITH (2026-11-12).
 *
 * The activation manifest on /health reported the four Hold'em tournament
 * corrective domains (nlh-mtt, nlh-sng, nlh-spin, nlh-hu_sng) as admitted and
 * off. That was the manifest's mistake, not the gate's. The manifest compared
 * each domain key (variant-format) with a key it built from the catalog's
 * mode (variant-tournament), which names no domain, so a tournament domain
 * could never report candidate. The decision worker's gate compares the real
 * domain key (horsePhase14CorrectiveMode) and selects those catalogs whenever
 * its holder is usable.
 */
import { PHASE14_PROTECTED_RELEASE_SELECTIONS } from './HorsePhase14ReleaseSelections.js';
import { describe, expect, it } from 'vitest';
import { computeHorseUpgradeActivationManifest } from './HorseUpgradeActivationManifest.js';
import { horsePhase14CorrectiveMode } from './HorsePhase14Authority.js';
import { qualifiedReplayAdmissions } from './horseDecision/replay/qualifiedAuthority.js';
import {
  CORRECTIVE_DOMAINS,
  correctiveDomainKey,
} from '../services/horseCorrectiveReview/domain.js';

describe('the manifest Phase 14 mode is the mode the worker gate gives', () => {
  const manifest = computeHorseUpgradeActivationManifest();

  it.each(CORRECTIVE_DOMAINS.map((d) => [correctiveDomainKey(d)] as const))(
    '%s reports what an admitted, usable holder of its own catalog decides with',
    (domain) => {
      const attachment = qualifiedReplayAdmissions.admitPhase14Attachment(domain);
      const reported = manifest.authorities.phase14[domain];
      expect(reported.status).toBe(attachment.admission.status);
      // The worker's own question, asked with a usable holder: candidate only
      // with this domain's validated functional catalog.
      const worker =
        attachment.admission.status === 'admitted'
          ? horsePhase14CorrectiveMode({
              callerMode: undefined,
              domain,
              packDomain: domain,
              verdict: 'usable',
              catalog: attachment.catalog,
            }).mode
          : 'off';
      expect(reported.mode).toBe(worker === 'candidate' ? 'candidate' : 'off');
    }
  );

  it('reports an admitted tournament domain as candidate, not off', () => {
    const tournament = CORRECTIVE_DOMAINS.filter((d) => d.mode === 'tournament')
      .map(correctiveDomainKey)
      .filter((domain) => {
        const a = qualifiedReplayAdmissions.admitPhase14Attachment(domain);
        return a.admission.status === 'admitted' && a.catalog !== null;
      });
    // Dan's 2026-10-26 order attaches the owner-issued tournament catalog to
    // the Hold'em tournament formats; without one this case would be vacuous.
    expect(tournament).toEqual(expect.arrayContaining(['nlh-mtt']));
    for (const domain of tournament)
      expect(manifest.authorities.phase14[domain]).toEqual({
        status: 'admitted',
        mode: 'candidate',
        kernel: 'unselected',
      });
  });

  it('says for every domain whether a corrective kernel is selected, from the protected selections', () => {
    const manifest = computeHorseUpgradeActivationManifest();
    for (const [domain, reported] of Object.entries(manifest.authorities.phase14))
      expect(reported.kernel, domain).toBe(
        PHASE14_PROTECTED_RELEASE_SELECTIONS[domain] ? 'selected' : 'unselected'
      );
    // Today no domain has one: a candidate mode alone changes no decision.
    expect(
      Object.values(manifest.authorities.phase14).filter((r) => r.kernel === 'selected')
    ).toEqual([]);
  });

  it('still reports a domain with no admitted catalog as off', () => {
    const refused = CORRECTIVE_DOMAINS.map(correctiveDomainKey).filter(
      (domain) => qualifiedReplayAdmissions.admitPhase14Attachment(domain).catalog === null
    );
    expect(refused.length).toBeGreaterThan(0);
    for (const domain of refused) expect(manifest.authorities.phase14[domain].mode).toBe('off');
  });
});
