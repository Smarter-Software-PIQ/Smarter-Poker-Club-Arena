/**
 * LAW: a Horse decision option is on by default only with its evidence.
 *
 * Two PLO6 decision changes (#10626, #10628) were merged on by default on a
 * demonstrated mechanism and switched to opt-in hours later because their
 * value had never been checked. docs/HORSE-DECISION-CHANGE-EVIDENCE.md is the
 * eight-row checklist that would have caught both. This law makes it binding
 * for new options: HorseLogic may read a HorseDecideOpts option so that its
 * absence turns it on (`opts.x !== false` or `opts.x ?? true`) only if the
 * option was already on by default when this law was written (GRANDFATHERED
 * below), or it has a file docs/horse-default-on.d/<option>.md that names its
 * pull request and answers all eight rows.
 *
 * An option read as `=== true` is an opt-in arm and needs nothing here.
 * A grandfathered option that stops being on by default leaves the list in
 * the same pull request, so turning it back on later needs the evidence.
 *
 * Limit: the scan is textual and covers HorseLogic.ts. It does not see an
 * alias (`const on = opts.x; if (on !== false)`), a destructuring default or
 * a default applied in another file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

export const EVIDENCE_ROWS = [
  'Mechanism',
  'Input fidelity',
  'Value',
  'Continuation',
  'Reach',
  'Scope',
  'Visibility',
  'Limits',
] as const;

/** Options HorseLogic read as on by default when this law was written. */
const GRANDFATHERED: readonly string[] = [
  'callDeductionPricing',
  'comboDrawPressure',
  'committedRaiseDiscipline',
  'decisionGravityTiming',
  'drawOutlookQuality',
  'flopTurnBluffBaseline',
  'handReading',
  'holdemDominatedFold',
  'limpReraiseIsoRead',
  'mind',
  'nashCallVsJam',
  'observeMind',
  'omahaEvFoldModel',
  'omahaTournamentFirstIn',
  'phase7Utility',
  'planFingerprint',
  'ploSuitedAcesFourBet',
  'probeAwareAggression',
  'riverBluffBaseline',
  'riverBluffBombPot',
  'riverBluffFixedLimit',
  'riverBluffHiLo',
  'riverBluffMultiBoard',
  'riverBluffMultiway',
  'riverBluffShortDeck',
  'riverFastCalldown',
  'riverLeadRange',
  'streetIQ',
  'tokenCallPrice',
  'v11',
  'v12',
  'v13',
  'v15',
  'v15RiverNoNearLock',
  'v16Blockers',
  'v16Icm',
  'v16PloPolar',
  'v16Reads',
  'v16SizeCond',
  'v17CatchBlock',
  'v17Pos',
  'v17ShortDeck',
  'v18ExploitSize',
  'v18Families',
  'v18SelfImage',
  'v18Squeeze',
  'v18Straddle',
  'v20Multiway',
  'v20Mzone',
  'v21Deep',
  'v21River',
  'v23Endgame',
  'v23Plan',
  'v23Reads',
  'v23Spin',
  'v23Variants',
  'v24Bounty',
  'v25PloTourney',
  'v26Prizes',
  'v27GtoCharts',
  'v29GtoFlop',
  'v30GtoTurnRiver',
  'v37Satellite',
  'v38Ev',
  'v40Omaha',
  'v41Leaks',
  'v43Tempo',
  'v46Charts',
  'v46ShortDeck',
  'v51RiverFlat',
  'v52RangeAdvantage',
  'v53Pressure',
  'v56OmahaPressureRange',
  'v57TournamentAggression',
  'v60CashPressure',
  'v61RiverOnePairShade',
  'v63LargeRiverBetShade',
  'v64RiverRaiseNeedsTwoPair',
  'v65TurnOnePairShade',
  'v66BetRaisedOnePair',
  'v67RiverBetRaisedOnePair',
  'v68TurnAirDrawCalls',
  'v69TurnCallGaps',
  'v7',
  'v74NlhOpenSizes',
  'v74OmahaSemiBluffNeedsDraw',
  'v79TopPairWeakKicker',
  'v8',
  'v80TopPairStrongKicker',
  'v81OmahaBigBetCalls',
  'v83AggressionNeedsBluffs',
  'v84OmahaRiverReraiseCalls',
  'v85CashAction',
  'v86MultiStreetUnblocked',
  'v86PloOverhaul',
  'v86UnblockedPreflop',
  'v87DeepDiveDiscipline',
  'v87FlopStabCheckRaise',
  'v87HoldemOverhaul',
  'v87HollywoodTank',
  'v87RiverBlockBetTrap',
  'v88CommitmentHonored',
];

const EVIDENCE_DIR = join('..', 'docs', 'horse-default-on.d');

export function defaultOnOptions(source: string): string[] {
  const names = new Set<string>();
  const read = /\bopts\??\.([A-Za-z0-9_]+)\s*(?:!==?\s*false|\?\?\s*true)/g;
  for (const match of source.matchAll(read)) names.add(match[1]);
  return [...names].sort();
}

/** Returns what an evidence file is missing; empty means complete. */
export function evidenceGaps(text: string): string[] {
  const gaps: string[] = [];
  if (!/#\d{3,}|\/pull\/\d+/.test(text)) gaps.push('a pull request reference');
  const lines = text.split('\n');
  for (const row of EVIDENCE_ROWS) {
    const heading = new RegExp(`^#{1,6}\\s*(?:\\d+[.)]?\\s*)?${row}\\s*$`, 'i');
    const at = lines.findIndex((line) => heading.test(line.trim()));
    if (at < 0) {
      gaps.push(`a "## ${row}" section`);
      continue;
    }
    const body: string[] = [];
    for (const line of lines.slice(at + 1)) {
      if (/^#{1,6}\s/.test(line.trim())) break;
      body.push(line.trim());
    }
    if (body.join('').length < 20) gaps.push(`content under "## ${row}"`);
  }
  return gaps;
}

describe('a Horse decision option is on by default only with its evidence', () => {
  const logic = readFileSync('src/engine/HorseLogic.ts', 'utf8');
  const current = defaultOnOptions(logic);
  const added = current.filter((name) => !GRANDFATHERED.includes(name));

  it('reads HorseLogic and finds the default-on options', () => {
    expect(current.length).toBeGreaterThan(50);
  });

  it('every option turned on by default since this law has complete evidence', () => {
    const problems = added.flatMap((name) => {
      const file = join(EVIDENCE_DIR, `${name}.md`);
      if (!existsSync(file)) {
        return [
          `${name}: HorseLogic reads it as on by default and docs/horse-default-on.d/${name}.md does not exist. ` +
            'Either read it as `opts.' +
            name +
            ' === true` (an opt-in arm) or add that file with the eight rows of docs/HORSE-DECISION-CHANGE-EVIDENCE.md.',
        ];
      }
      const gaps = evidenceGaps(readFileSync(file, 'utf8'));
      return gaps.length
        ? [`${name}: docs/horse-default-on.d/${name}.md lacks ${gaps.join(', ')}`]
        : [];
    });
    expect(problems).toEqual([]);
  });

  it('a grandfathered option that is no longer on by default has left the list', () => {
    const stale = GRANDFATHERED.filter((name) => !current.includes(name));
    expect(
      stale,
      'Remove these names from GRANDFATHERED in this pull request; turning one back on later needs its evidence file.'
    ).toEqual([]);
  });

  it('the two withdrawn PLO6 rules are not grandfathered', () => {
    expect(GRANDFATHERED).not.toContain('vpipFloorDeepStackOff');
    expect(GRANDFATHERED).not.toContain('omahaPreflopCallWithActionBehind');
  });

  describe('the scan and the evidence reader are not vacuous', () => {
    it('sees both default-on forms and ignores an opt-in read', () => {
      const sample = [
        'if (opts.alpha !== false) {}',
        'const b = opts.beta ?? true;',
        'if (opts?.gamma !== false) {}',
        'if (opts.delta === true) {}',
        'if (opts.epsilon ?? false) {}',
      ].join('\n');
      expect(defaultOnOptions(sample)).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('accepts a complete evidence file and names each gap in an incomplete one', () => {
      const complete =
        'Pull request #12345\n' +
        EVIDENCE_ROWS.map(
          (row, i) => `## ${i + 1}. ${row}\nA real answer of useful length for this row.\n`
        ).join('\n');
      expect(evidenceGaps(complete)).toEqual([]);
      expect(evidenceGaps(complete.replace('#12345', 'none'))).toEqual([
        'a pull request reference',
      ]);
      expect(evidenceGaps(complete.replace('## 3. Value', '## 3. Worth'))).toEqual([
        'a "## Value" section',
      ]);
      expect(
        evidenceGaps(
          'Pull request #12345\n' + EVIDENCE_ROWS.map((row) => `## ${row}\nTBD\n`).join('\n')
        )
      ).toHaveLength(8);
    });
  });
});
