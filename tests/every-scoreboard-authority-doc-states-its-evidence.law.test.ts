/**
 * LAW: EVERY AUTHORITY DOC THE HOLD'EM SCOREBOARD READS STATES ITS EVIDENCE
 * (2026-11-22).
 *
 * scripts/ops/holdem-blanket-scoreboard-lib.mjs reports each option's
 * evidence by finding "Evidence MET" or "Evidence NOT MET" in its file under
 * docs/horse-option-authority.d/. On 2026-11-22 #11791 rewrote
 * holdemValueAndCallsArePriced.md to record it live, the words dropped out of
 * the state line, the scoreboard read UNKNOWN, and main went red for every
 * pull request (#11800 restored them and made docs changes run their tests).
 *
 * This law reads the files exactly as the scoreboard loads them and refuses
 * any option in the scoreboard's catalog whose authority file states neither.
 * Because it names that folder in its code, a docs-only pull request that
 * edits one of those files runs it (scripts/ci/run-docs-readers.mjs), so the
 * author learns at their own pull request, not everyone else's.
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(__dirname, '..');
const AUTHORITY_DIR = 'docs/horse-option-authority.d';
const load = (rel: string) => import(/* @vite-ignore */ pathToFileURL(resolve(ROOT, rel)).href);

type AuthorityDoc = { path: string; evidenceStatus: string };

describe("every authority doc the Hold'em scoreboard reads states its evidence", () => {
  it('each catalog option with an authority file reads as MET or NOT_MET', async () => {
    const cli = await load('scripts/ops/holdem-blanket-scoreboard.mjs');
    const lib = await load('scripts/ops/holdem-blanket-scoreboard-lib.mjs');
    const inputs = cli.loadLocalRepoInputs(ROOT);
    const docs = inputs.authorityDocs as Record<string, AuthorityDoc>;
    const catalog = lib.buildEffectiveCatalog(
      lib.parseHorseOptionSwitchSource(inputs.horseOptionSwitchSource),
      docs
    ) as { option: string }[];
    const read = catalog.filter((e) => docs[e.option]);
    // The scoreboard reads at least the files this law was written for.
    expect(read.map((e) => e.option)).toContain('holdemValueAndCallsArePriced');
    expect(read.map((e) => e.option)).toContain('holdemRiverFullHouseValueIsPriced');
    const unreadable = read
      .filter((e) => !['MET', 'NOT_MET'].includes(docs[e.option].evidenceStatus))
      .map((e) => `${AUTHORITY_DIR}/${e.option}.md`);
    expect(
      unreadable,
      'state "Evidence MET" or "Evidence NOT MET" in the first paragraph of these files'
    ).toEqual([]);
  });

  it('the parser tells the two states apart and does not guess', async () => {
    const { parseAuthorityDoc } = await load('scripts/ops/holdem-blanket-scoreboard-lib.mjs');
    const status = (text: string) =>
      parseAuthorityDoc(text, `${AUTHORITY_DIR}/x.md`).evidenceStatus;
    expect(status('# x\n\n**State: LIVE ON**. Evidence NOT MET against the bar.')).toBe('NOT_MET');
    expect(status('# x\n\n**State: LIVE ON**. Evidence MET.')).toBe('MET');
    // The 2026-11-22 wording: the bar "is not met", said in words only.
    expect(status('# x\n\n**State: LIVE ON** (evidence #76). The bar is not met.')).toBe('UNKNOWN');
  });
});
