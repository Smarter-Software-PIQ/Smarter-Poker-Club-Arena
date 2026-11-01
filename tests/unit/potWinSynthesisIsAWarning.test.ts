/**
 * TablePage.pot_win_no_award_groups (2026-10-31): the pot animation is
 * synthesised when no award group came back - that synthesis is the repair,
 * so the report is a WARNING with one stable dedupe key, not an ERROR whose
 * key changed with every pot size and winner count.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sliceEnclosingBlock } from '../helpers/sourceWindow';
import { reportClientWarning } from '../../src/utils/errorReporter';
import { toSinkEvent } from '../../src/utils/clientErrorSink';

const TABLE_PAGE = readFileSync(join(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');
const MESSAGE = 'pot_win produced no award animation; synthesising';
const SOURCE = 'TablePage.pot_win_no_award_groups';

afterEach(() => vi.restoreAllMocks());

describe('pot_win_no_award_groups', () => {
  it('TablePage keeps the synthesis and reports it as a warning with a fixed sentence', () => {
    const at = TABLE_PAGE.indexOf(`'${SOURCE}'`);
    expect(at).toBeGreaterThan(0);
    const call = TABLE_PAGE.slice(TABLE_PAGE.lastIndexOf('reportClientWarning(', at), at + 200);
    expect(call).toContain(`'${MESSAGE}'`);
    expect(call).toContain("code: 'POT_WIN_NO_AWARD_GROUPS'");
    // The synthesis that follows is unchanged.
    expect(sliceEnclosingBlock(TABLE_PAGE, `'${SOURCE}'`)).toContain(
      'const fallbackShare = potAmount / (winnerIds.length || 1);'
    );
    // No ERROR report for this source remains.
    expect(TABLE_PAGE).not.toMatch(
      /reportError\([\s\S]{0,200}'TablePage\.pot_win_no_award_groups'/
    );
  });

  it('writes console.warn, never console.error, and never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      reportClientWarning(MESSAGE, SOURCE, {
        code: 'POT_WIN_NO_AWARD_GROUPS',
        winners: 2,
        pot: 12.5,
      })
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('every occurrence shares one dedupe key, whatever the pot and winners', () => {
    const env = { appVersion: null, userAgent: null, automated: false };
    const keys = new Set(
      [
        { winners: 1, pot: 10 },
        { winners: 3, pot: 12.75 },
        { winners: 2, pot: 1_000_000 },
      ].map(
        (extra) =>
          toSinkEvent(
            {
              at: 0,
              route: '/table/x',
              code: 'POT_WIN_NO_AWARD_GROUPS',
              name: 'Warning',
              message: MESSAGE,
              stack: null,
              source: SOURCE,
              extra: { ...extra, level: 'warn' },
            },
            env
          ).dedupe_key
      )
    );
    expect(keys.size).toBe(1);
  });
});
