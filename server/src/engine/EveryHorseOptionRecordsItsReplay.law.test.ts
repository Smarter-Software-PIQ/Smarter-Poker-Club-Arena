/**
 * LAW: an option is eligible for switch-on only with its replay on real audited decisions, recorded.
 *
 * Every lane replayed its option on the audited decisions with a scratch script, wrote the outcome in prose, and
 * the claim "Evidence MET" could rest on a replay nobody could re-read: one was joined by position, one ran four
 * inert arms because a journaled option had become off-only (the registry refuses the whole set, nothing is
 * switched), one option's replay made more new mistakes than it fixed while its league card said WIN. This law
 * makes the replay a REQUIRED, RECORDED bar. For every option authority file docs/horse-option-authority.d/
 * <option>.md (README.md and the supplementary <option>.<PART>.md files are not option files):
 *
 *   1. The file carries at least one machine-read row `- Replay: ...` and none that is malformed. The format and
 *      its parser are the scorer's own (benchmark/AuditedDecisionReplay.parseReplayBarRows; the scorer writes the
 *      row with `--row`, and refuses to when an arm is inert or its option set is not declared):
 *        - Replay: fixed N; newlyWrong N; changed N; ...; set <name>; scorer <commit>
 *        - Replay: NOT RUN (<reason>)
 *        - Replay: LEGACY (<reason>)     a replay recorded in prose only, before the row existed
 *      A file has run rows, or exactly one NOT RUN / LEGACY row, never both.
 *   2. THE CLAIM. A file claims its evidence is MET (eligible for switch-on) when its status paragraph, the first
 *      paragraph under the title, contains the words "Evidence MET". Such a file must carry run rows, and in every
 *      one of them newlyWrong must not exceed fixed. NOT RUN, LEGACY, or newlyWrong > fixed fails the build.
 *   3. The claim cannot be worded around: a status paragraph that says MET without the words "Evidence MET" or
 *      "Evidence NOT MET" fails, except the files that were worded so when this law was written
 *      (PARTIAL_STATUS_20261119, closed).
 *   4. GRANDFATHERED_20261119: the files that claimed "Evidence MET" on 2026-11-19, before this bar existed, for
 *      the options production had switched on that day (read 2026-11-19T19:00:33Z). Their
 *      replays are in prose in the file (LEGACY) or were not run on the committed scorer. The list is closed and
 *      only shrinks: an entry must still be a file that claims MET, and it leaves the list in the pull request
 *      that gives it run rows. No new option may be added to it.
 *
 * Limits: the law reads what the file says. It cannot check that a run row's numbers are the scorer's output, that
 * the named commit exists, or that the audited set was the right one; those are the reviewer's, with the scorer's
 * report beside the row. It does not read the production switch, so it cannot see an option switched on without a
 * MET claim (the database's own note rule and the lane lead own that).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseReplayBarRows } from '../benchmark/AuditedDecisionReplay.js';

const DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'docs',
  'horse-option-authority.d'
);

/**
 * Claimed "Evidence MET" on 2026-11-19, before the replay bar was machine-read, AND switched on in production
 * that day (production option-switch read 2026-11-19T19:00:33Z: these three are on). The law itself does not read
 * production. omahaReadIsByStreetAndTexture also claimed MET that day but had no switch row and its own file holds
 * its switch-on (the minimum-raise ladder section); its status paragraph now states "Evidence NOT MET" and it is
 * not listed. Closed: remove an entry, never add one.
 */
export const GRANDFATHERED_20261119: readonly string[] = [
  'omahaPreflopReraiseDefencePricedInPosition',
  'omahaSmallBetIsPriced',
  'omahaTurnRiverRaiseIsPriced',
];

/**
 * Status paragraphs that said MET on 2026-11-19 without the words "Evidence MET" or "Evidence NOT MET" (some rows
 * met, the value row not: "Evidence: mechanism, scope ... MET; ... INSUFFICIENT", "MET on the league; MIXED on the
 * audit replays"). They do not claim eligibility. Closed: a new file states one of the two phrases.
 */
export const PARTIAL_STATUS_20261119: readonly string[] = [
  'lightningVpipFloorLimpOnly',
  'omahaFlopFacingBetEv',
  'omahaReraisedPositionInLightning',
  'vpipFloorLimpOnly',
];

/** `<option>.md` only: README.md and `<option>.<PART>.md` (constants, appendices) are not option files. */
export const isOptionFile = (name: string): boolean =>
  name !== 'README.md' && /^[A-Za-z][A-Za-z0-9]*\.md$/.test(name);

/** The first paragraph under the `# ` title. */
export function statusParagraph(markdown: string): string {
  const lines = markdown.split('\n');
  let i = lines.findIndex((l) => l.startsWith('# '));
  if (i < 0) return '';
  i++;
  while (i < lines.length && lines[i].trim() === '') i++;
  const out: string[] = [];
  while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('#'))
    out.push(lines[i++]);
  return out.join(' ');
}
export const claimsMet = (markdown: string): boolean =>
  /\bEvidence MET\b/.test(statusParagraph(markdown));

export interface ReplayBarLists {
  grandfathered: readonly string[];
  partialStatus: readonly string[];
}

/** Every way the option authority files break the replay bar; [] when they keep it. */
export function replayBarViolations(
  files: Readonly<Record<string, string>>,
  lists: ReplayBarLists
): string[] {
  const out: string[] = [];
  for (const [option, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const file = `docs/horse-option-authority.d/${option}.md`;
    const status = statusParagraph(text);
    const met = claimsMet(text);
    const { rows, malformed } = parseReplayBarRows(text);
    for (const m of malformed) out.push(`${file}: malformed Replay row: ${m}`);
    const run = rows.flatMap((r) => (r.state === 'RUN' ? [r] : []));
    const notRun = rows.filter((r) => r.state !== 'RUN');
    if (rows.length === 0 && malformed.length === 0)
      out.push(
        `${file}: no Replay row. Add "- Replay: fixed N; newlyWrong N; changed N; set <name>; scorer <commit>" (written by server/scripts/audited-decision-replay.ts --row) or "- Replay: NOT RUN (<reason>)".`
      );
    if (run.length > 0 && notRun.length > 0)
      out.push(`${file}: run rows and a NOT RUN / LEGACY row together; keep the run rows only`);
    if (run.length === 0 && notRun.length > 1)
      out.push(`${file}: ${notRun.length} NOT RUN / LEGACY rows; one says it`);
    if (
      !/\bEvidence (NOT )?MET\b/.test(status) &&
      /\bMET\b/.test(status.replace(/\bNOT MET\b/g, '')) &&
      !lists.partialStatus.includes(option)
    )
      out.push(
        `${file}: the status paragraph says MET without "Evidence MET" or "Evidence NOT MET". State one of the two: only "Evidence MET" claims eligibility for switch-on, and it needs the replay.`
      );
    const grandfathered = lists.grandfathered.includes(option);
    if (grandfathered && !met)
      out.push(
        `${file}: grandfathered but no longer claims "Evidence MET"; remove it from GRANDFATHERED_20261119`
      );
    if (grandfathered && run.length > 0)
      out.push(
        `${file}: grandfathered but carries run rows now; remove it from GRANDFATHERED_20261119 so the bar reads them`
      );
    if (!met || grandfathered) continue;
    if (run.length === 0)
      out.push(
        `${file}: claims "Evidence MET" with Replay ${notRun[0]?.state ?? 'absent'}. An option is eligible for switch-on only with its replay on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts (--row). Run it and record the row, or state "Evidence NOT MET".`
      );
    for (const r of run)
      if (r.newlyWrong > r.fixed)
        out.push(
          `${file}: claims "Evidence MET" but its replay on set "${r.set}" made more decisions newly wrong (${r.newlyWrong}) than it fixed (${r.fixed}). State "Evidence NOT MET" until a corrected form passes.`
        );
  }
  for (const [name, list] of [
    ['GRANDFATHERED_20261119', lists.grandfathered],
    ['PARTIAL_STATUS_20261119', lists.partialStatus],
  ] as const)
    for (const option of list)
      if (!Object.hasOwn(files, option))
        out.push(`${name} names ${option}, which has no authority file; remove the entry`);
  return out;
}

function optionFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(DIR).sort())
    if (isOptionFile(f)) out[f.slice(0, -3)] = readFileSync(join(DIR, f), 'utf8');
  return out;
}

describe('LAW: every Horse option records its replay on real audited decisions', () => {
  const files = optionFiles();
  const LISTS: ReplayBarLists = {
    grandfathered: GRANDFATHERED_20261119,
    partialStatus: PARTIAL_STATUS_20261119,
  };

  it('reads the option authority files, and only those', () => {
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(70);
    expect(isOptionFile('README.md')).toBe(false);
    expect(isOptionFile('omahaFlopFacingBetEv.CONSTANTS.md')).toBe(false);
    expect(isOptionFile('omahaFlopFacingBetEv.md')).toBe(true);
    expect(Object.keys(files)).not.toContain('README');
  });

  it('every option file carries its Replay row, and no MET claim stands without a passing replay', () => {
    expect(replayBarViolations(files, LISTS)).toEqual([]);
  });

  it('the allow-lists are closed: exactly the files of 2026-11-19, sorted, no duplicates', () => {
    for (const list of [GRANDFATHERED_20261119, PARTIAL_STATUS_20261119]) {
      expect([...list]).toEqual([...new Set(list)].sort());
    }
    expect(GRANDFATHERED_20261119.length).toBeLessThanOrEqual(3);
    expect(PARTIAL_STATUS_20261119.length).toBeLessThanOrEqual(4);
    // What is grandfathered is exactly what claims MET without a run row: nothing else slips through unlisted.
    const metWithoutRun = Object.entries(files)
      .filter(
        ([, text]) =>
          claimsMet(text) && !parseReplayBarRows(text).rows.some((r) => r.state === 'RUN')
      )
      .map(([option]) => option);
    expect(metWithoutRun).toEqual([...GRANDFATHERED_20261119]);
  });

  it('the README states the bar the law enforces', () => {
    const readme = readFileSync(join(DIR, 'README.md'), 'utf8');
    expect(readme).toContain('- Replay: fixed N; newlyWrong N; changed N');
    expect(readme).toContain('- Replay: NOT RUN (<reason>)');
    expect(readme).toContain('EveryHorseOptionRecordsItsReplay.law.test.ts');
    expect(readme).toContain('"Evidence MET"');
  });

  describe('the rule bites (synthetic files)', () => {
    const NONE: ReplayBarLists = { grandfathered: [], partialStatus: [] };
    const file = (status: string, ...rows: string[]) =>
      `# anOption: authority for the live switch\n\n${status}\nsecond line of the status.\n\n## Evidence rows\n\n- Value: MET.\n\n## Replay\n\n${rows.join('\n')}\n`;
    const RUN = '- Replay: fixed 5; newlyWrong 2; changed 9; set audit2 2,950; scorer 86ab7637d9e';
    const HARM =
      '- Replay: fixed 1; newlyWrong 4; changed 11; set woowoo flop 563; scorer 86ab7637d9e';
    const NOT_RUN = '- Replay: NOT RUN (no replay on audited decisions was run for this option)';
    const LEGACY = '- Replay: LEGACY (a replay is recorded in prose in this file only)';
    const one = (text: string, lists = NONE) => replayBarViolations({ anOption: text }, lists);

    it('passes a MET claim with a run row that fixes at least as much as it breaks', () => {
      expect(one(file('Owner order. Evidence MET (2026-11-20): league WIN.', RUN))).toEqual([]);
      expect(
        one(
          file(
            'Evidence MET.',
            '- Replay: fixed 0; newlyWrong 0; changed 3; set s; scorer 86ab7637d9e'
          )
        )
      ).toEqual([]);
    });
    it('passes NOT MET with NOT RUN, LEGACY, or a harmful replay honestly recorded', () => {
      for (const row of [NOT_RUN, LEGACY, HARM, RUN])
        expect(one(file('Owner order. Evidence NOT MET; a live read is owed.', row))).toEqual([]);
      expect(one(file('Evidence NOT MET for value; mechanism and tests MET.', NOT_RUN))).toEqual(
        []
      );
    });
    it('fails a MET claim whose Replay is NOT RUN, LEGACY or absent', () => {
      expect(one(file('Evidence MET (2026-11-20).', NOT_RUN))).toEqual([
        expect.stringContaining('claims "Evidence MET" with Replay NOT RUN'),
      ]);
      expect(one(file('Evidence MET, thin.', LEGACY))).toEqual([
        expect.stringContaining('claims "Evidence MET" with Replay LEGACY'),
      ]);
      const none = one(file('Evidence MET on the v2 evaluation.'));
      expect(none).toHaveLength(2);
      expect(none[0]).toContain('no Replay row');
      expect(none[1]).toContain('with Replay absent');
    });
    it('fails a MET claim whose replay made more decisions newly wrong than it fixed, on any set', () => {
      expect(one(file('Evidence MET.', RUN, HARM))).toEqual([
        expect.stringContaining('newly wrong (4) than it fixed (1)'),
      ]);
    });
    it('fails a file without a row, a malformed row, and mixed or repeated rows', () => {
      expect(one(file('Evidence NOT MET.'))).toEqual([expect.stringContaining('no Replay row')]);
      expect(
        one(file('Evidence NOT MET.', '- Replay: fixed 5; newlyWrong 2; changed 9; set s'))
      ).toEqual([expect.stringContaining('malformed Replay row')]);
      expect(one(file('Evidence NOT MET.', '- Replay: NOT RUN'))).toEqual([
        expect.stringContaining('malformed Replay row'),
      ]);
      expect(one(file('Evidence NOT MET.', RUN, NOT_RUN))).toEqual([
        expect.stringContaining('run rows and a NOT RUN / LEGACY row together'),
      ]);
      expect(one(file('Evidence NOT MET.', NOT_RUN, LEGACY))).toEqual([
        expect.stringContaining('2 NOT RUN / LEGACY rows'),
      ]);
    });
    it('does not let the claim be worded around', () => {
      const partial = file(
        'Evidence: mechanism, scope and tests MET; value not measured.',
        NOT_RUN
      );
      expect(one(partial)).toEqual([expect.stringContaining('says MET without "Evidence MET"')]);
      expect(one(partial, { grandfathered: [], partialStatus: ['anOption'] })).toEqual([]);
      // A claim lower in the file is not the status paragraph; the status paragraph is what the law reads.
      expect(claimsMet(file('Built 2026-11-20. No verdict yet.', NOT_RUN))).toBe(false);
      expect(statusParagraph(file('First.', NOT_RUN))).toBe('First. second line of the status.');
    });
    it('grandfathers only a file that still claims MET and has no run row, and only a file that exists', () => {
      const g = { grandfathered: ['anOption'], partialStatus: [] };
      expect(one(file('Evidence MET.', LEGACY), g)).toEqual([]);
      expect(one(file('Evidence MET.', NOT_RUN), g)).toEqual([]);
      expect(one(file('Evidence NOT MET.', NOT_RUN), g)).toEqual([
        expect.stringContaining('no longer claims "Evidence MET"'),
      ]);
      expect(one(file('Evidence MET.', HARM), g)).toEqual([
        expect.stringContaining('carries run rows now'),
      ]);
      expect(
        replayBarViolations({}, { grandfathered: ['gone'], partialStatus: ['alsoGone'] })
      ).toEqual([
        'GRANDFATHERED_20261119 names gone, which has no authority file; remove the entry',
        'PARTIAL_STATUS_20261119 names alsoGone, which has no authority file; remove the entry',
      ]);
    });
  });
});
