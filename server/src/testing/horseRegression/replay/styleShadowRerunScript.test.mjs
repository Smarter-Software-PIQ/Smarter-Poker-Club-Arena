/**
 * Review bd7a5cc2: the offline style re-run writes rows (table ids, hands) only outside the repository, after every
 * symlink on either side is resolved (finding 1), and it hands a DEEP second look the earlier FAST decisions of its
 * producer and hand (finding 4).
 *
 * Review of 2026-11-13 (post-merge, section B): the journal copy is read as a stream and a damaged copy stops the
 * run by name (B3); a count that is not a positive whole number is an error (B6); the output files are owner-only
 * (B8); and the script's own join, run on the journal's real FAST and DEEP records of one turn, gives one counted
 * changed decision, on the executed lane (B1, B2).
 */
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  originalFastCandidates,
  outputIsOutsideRepo,
  parseArgs,
  readJournalCopy,
  writePrivateFile,
} from '../../../../scripts/style-shadow-rerun.mjs';
import {
  PHASE6C_FIXTURE_IDS as IDS,
  PHASE6C_FIXTURE_PATH,
  phase6cFixtureRecord,
  resignHorseJournalRecord,
} from '../../../engine/horseDecision/replay/fixtures/index.ts';
import { STYLE_SWITCH_SOURCE_DEFAULT } from '../../../engine/HorseStyleSwitch.ts';

// A stand-in exact replay whose decision depends on the fold-bluff switch only (as in styleShadowRerun.test.ts):
// the records, the witnesses and the join below are the journal's and the script's own.
vi.mock('../../../engine/horseDecision/replay/exactReplay.ts', () => ({
  exactReplayHorseDecisionRecord: async (raw, options) => {
    const states = options.styleStatesOverride ?? JSON.parse(raw.body).replayState.style;
    const action = states.styleFoldBluff === 'on' ? 'fold' : 'call';
    return {
      outcome: options.styleStatesOverride ? 'replayed_mismatch' : 'replayed_exact',
      replayed: { action, amount: action === 'call' ? 100 : null, rngAfter: 1, effects: 0 },
      context: { gameMode: 'tournament', format: 'tournament', variant: 'nlh', stage: 'preflop' },
    };
  },
}));
const { styleShadowCountedRows, styleShadowRerunRecord } =
  await import('../../../engine/horseDecision/replay/styleShadowRerun.ts');

const base = mkdtempSync(join(tmpdir(), 'style-rerun-out-'));
const repo = join(base, 'repo');
const elsewhere = join(base, 'elsewhere');
mkdirSync(join(repo, 'server'), { recursive: true });
mkdirSync(elsewhere);
symlinkSync(repo, join(base, 'link-to-repo'));
symlinkSync(join(repo, 'server'), join(elsewhere, 'link-to-server'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('style re-run output stays outside the repository', () => {
  it('refuses the repository itself and any path inside it, existing or not', () => {
    expect(outputIsOutsideRepo(repo, repo)).toBe(false);
    expect(outputIsOutsideRepo(join(repo, 'server', 'rerun-out'), repo)).toBe(false);
    expect(outputIsOutsideRepo(join(repo, 'a', 'b', 'c'), repo)).toBe(false);
  });

  it('refuses a symlinked path that lands inside the repository (the reproduced bypass)', () => {
    // tmpdir() is itself behind a symlink on macOS (/var -> /private/var), as /tmp was in the review's reproduction
    expect(outputIsOutsideRepo(join(base, 'link-to-repo', 'server', 'rerun-out'), repo)).toBe(
      false
    );
    expect(outputIsOutsideRepo(join(elsewhere, 'link-to-server', 'out'), repo)).toBe(false);
    // the root given through a symlink is resolved as well
    expect(outputIsOutsideRepo(join(repo, 'out'), join(base, 'link-to-repo'))).toBe(false);
  });

  it('accepts a real outside directory, existing or not, including an outside sibling whose name starts with ..', () => {
    expect(outputIsOutsideRepo(join(elsewhere, 'rerun-out'), repo)).toBe(true);
    expect(outputIsOutsideRepo(elsewhere, repo)).toBe(true);
    // beside the repository, not in it: the relative path is ../..repo-out
    expect(outputIsOutsideRepo(join(base, '..repo-out'), repo)).toBe(true);
    expect(outputIsOutsideRepo(join(base, '..repo-out', 'deeper'), repo)).toBe(true);
  });

  it('refuses a directory inside the repository whose name starts with ..', () => {
    // the relative path is ..repo-out: it starts with two dots and is still inside
    expect(outputIsOutsideRepo(join(repo, '..repo-out'), repo)).toBe(false);
    expect(outputIsOutsideRepo(join(repo, '..repo-out', 'deeper'), repo)).toBe(false);
  });

  it('writes its files owner-only and never over an existing file', () => {
    const file = join(elsewhere, 'rows.csv');
    writePrivateFile(file, 'decision_id\n');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).toBe('decision_id\n');
    expect(() => writePrivateFile(file, 'other\n')).toThrow(/EEXIST/);
    expect(readFileSync(file, 'utf8')).toBe('decision_id\n');
  });
});

describe('style re-run arguments', () => {
  it('reads a limit and a concurrency that are positive whole numbers', () => {
    expect(parseArgs(['copy.ndjson'])).toMatchObject({
      limit: Number.POSITIVE_INFINITY,
      concurrency: 4,
    });
    expect(
      parseArgs(['copy.ndjson', '--limit', '25', '--concurrency', '2', '--out', elsewhere])
    ).toMatchObject({ limit: 25, concurrency: 2, out: elsewhere });
  });

  it('a limit or concurrency that is not a positive whole number is an error, not zero work', () => {
    for (const option of ['--limit', '--concurrency'])
      for (const value of ['abc', '0', '-1', '2.5', '1e3', '', ' 3', 'NaN', 'Infinity'])
        expect(() => parseArgs(['copy.ndjson', option, value]), `${option} ${value}`).toThrow(
          new RegExp(`${option} must be a positive whole number, got "`)
        );
    expect(() => parseArgs(['copy.ndjson', '--limit'])).toThrow(
      /--limit must be a positive whole number, got nothing/
    );
    expect(() => parseArgs(['copy.ndjson', '--concurrency'])).toThrow(
      /--concurrency must be a positive whole number, got nothing/
    );
  });
});

describe('a DEEP second look gets the earlier FAST decisions of its producer and hand', () => {
  const fast = (sequence) => ({
    producerId: 'p',
    handKey: 'h',
    sequence,
    body: '{"snapshot":{"type":"DECIDE_FAST"}}',
  });
  const byHand = new Map([['p\u0000h', [fast(1), fast(2), fast(5)]]]);
  it('only earlier FAST records, only for DEEP, at most 256', () => {
    const deep = {
      producerId: 'p',
      handKey: 'h',
      sequence: 3,
      body: '{"snapshot":{"type":"DECIDE_DEEP"}}',
    };
    expect(originalFastCandidates(deep, byHand).map((r) => r.sequence)).toEqual([1, 2]);
    expect(originalFastCandidates({ ...fast(3) }, byHand)).toEqual([]);
    const many = new Map([['p\u0000h', Array.from({ length: 300 }, (_, i) => fast(i))]]);
    const got = originalFastCandidates({ ...deep, sequence: 1000 }, many);
    expect(got).toHaveLength(256);
    expect(got[0].sequence).toBe(44);
  });

  it('the lane is the parsed snapshot type, not text found anywhere in the body', () => {
    // a FAST record that merely mentions the DEEP type in a string is not a DEEP look
    const mention = {
      ...fast(3),
      body: '{"note":"\\"type\\":\\"DECIDE_DEEP\\"","snapshot":{"type":"DECIDE_FAST"}}',
    };
    expect(mention.body).toMatch(/"type\\":\\"DECIDE_DEEP/);
    expect(originalFastCandidates(mention, byHand)).toEqual([]);
  });
});

describe('the journal copy is read as a stream', () => {
  const sampleText = readFileSync(PHASE6C_FIXTURE_PATH, 'utf8');
  const sampleLines = sampleText.split('\n').filter((line) => line.trim());
  const write = (name, text) => {
    const file = join(elsewhere, name);
    writeFileSync(file, text);
    return file;
  };
  /** The sample is older than the switch states: the pair carries the states it would carry today, nothing else. */
  const withShadow = (record) =>
    resignHorseJournalRecord(record, (body) => {
      body.replayState = {
        version: 'horse-decision-replay-state-v4',
        style: { ...STYLE_SWITCH_SOURCE_DEFAULT, styleFoldBluff: 'shadow' },
      };
    });
  const realFast = phase6cFixtureRecord(IDS.tournamentAtlasEvaluated);
  const realDeep = phase6cFixtureRecord(IDS.deepSecondLook);
  /** The sample with its FAST 435750 and DEEP 435768 decision records carrying v4 states; every other line as is. */
  const pairCopy = () =>
    write(
      'pair.ndjson',
      sampleLines
        .map((line) => {
          const row = JSON.parse(line);
          if (row.record?.eventId === realFast.eventId || row.record?.eventId === realDeep.eventId)
            return JSON.stringify({ ...row, record: withShadow(row.record) });
          return line;
        })
        .join('\n') + '\n'
    );

  it('counts the real sample without selecting it: 16 records as its header declares, none with switch states', async () => {
    const journal = await readJournalCopy(PHASE6C_FIXTURE_PATH);
    expect(journal).toMatchObject({
      lines: 17,
      blankLines: 0,
      otherLines: 1,
      declaredRecords: 16,
      records: 16,
      recordsByKind: { decision: 8, execution: 8 },
      decisionsInWindow: 8,
      decisionsWithoutTime: 0,
      selected: [],
      bytes: Buffer.byteLength(sampleText),
      sha256: createHash('sha256').update(sampleText).digest('hex'),
    });
    journal.close();
  });

  it('joins each selected decision to its own execution witness and a DEEP look to its FAST record', async () => {
    const journal = await readJournalCopy(pairCopy());
    try {
      expect(journal.selected.map((e) => [e.lane, e.eventId])).toEqual([
        ['fast', realFast.eventId],
        ['deep', realDeep.eventId],
      ]);
      const [fast, deep] = journal.selected.map((e) => journal.load(e));
      expect(fast.record).toEqual(withShadow(realFast));
      expect(deep.record).toEqual(withShadow(realDeep));
      // two journal turn keys, and under each one the witness of that request
      expect(fast.record.turnKey).not.toBe(deep.record.turnKey);
      const witness = (loaded) => JSON.parse(loaded.execution.body);
      expect(fast.execution.turnKey).toBe(fast.record.turnKey);
      expect(deep.execution.turnKey).toBe(deep.record.turnKey);
      expect([witness(fast).identity.requestId, witness(fast).executionStatus]).toEqual([
        435750,
        'intended',
      ]);
      expect([
        witness(deep).identity.requestId,
        witness(deep).executionStatus,
        witness(deep).retirementReason,
      ]).toEqual([435768, 'not_executed', 'second_look_unchanged']);
      expect(fast.originalFastRecords).toEqual([]);
      expect(deep.originalFastRecords).toEqual([fast.record]);
    } finally {
      journal.close();
    }
  });

  it('the real FAST and DEEP records of one turn give one counted changed decision, on the executed lane', async () => {
    const journal = await readJournalCopy(pairCopy());
    try {
      const rows = [];
      for (const entry of journal.selected) {
        const { record, execution, originalFastRecords } = journal.load(entry);
        const result = await styleShadowRerunRecord(record, {
          runningSource: '5'.repeat(40),
          execution,
          originalFastRecords,
        });
        rows.push(...result.rows);
      }
      // the option changes both lanes' decisions: two rows, two decision ids, two journal turn keys
      expect(
        rows.map((r) => [r.lane, r.executed, r.execution_status, r.actual, r.would_be])
      ).toEqual([
        ['fast', 't', 'intended', 'c', 'f'],
        ['deep', 'f', 'not_executed', 'c', 'f'],
      ]);
      expect(new Set(rows.map((r) => r.decision_id)).size).toBe(2);
      expect(new Set(rows.map((r) => r.turn_key)).size).toBe(2);
      // one turn, and only the lane that executed is counted
      expect(new Set(rows.map((r) => r.turn_identity)).size).toBe(1);
      expect(styleShadowCountedRows(rows)).toEqual([rows[0]]);
    } finally {
      journal.close();
    }
  });

  it('selects by window and limit, in time order', async () => {
    const file = pairCopy();
    const at = Number(realFast.atMs);
    const only = async (options) => {
      const journal = await readJournalCopy(file, options);
      journal.close();
      return [journal.decisionsInWindow, journal.selected.map((e) => e.lane)];
    };
    expect(await only({ limit: 1 })).toEqual([8, ['fast']]);
    expect(await only({ sinceMs: at + 1 })).toEqual([6, ['deep']]);
    expect(await only({ sinceMs: at, untilMs: at + 1 })).toEqual([1, ['fast']]);
    expect(await only({ untilMs: 1 })).toEqual([0, []]);
  });

  it('reads a copy larger than one read chunk without holding it: counts, bytes and hash are the file own', async () => {
    // 6.4 MB against a 1 MB read chunk: every chunk boundary falls inside a record line
    const recordLines = sampleLines.slice(1);
    const text = Array.from({ length: 24 }, () => recordLines.join('\n')).join('\n');
    const file = write('large.ndjson', text); // no header line and no final newline
    expect(Buffer.byteLength(text)).toBeGreaterThan(6 * 1024 * 1024);
    const journal = await readJournalCopy(file);
    journal.close();
    expect(journal).toMatchObject({
      lines: 24 * 16,
      records: 24 * 16,
      declaredRecords: null,
      recordsByKind: { decision: 24 * 8, execution: 24 * 8 },
      bytes: Buffer.byteLength(text),
      sha256: createHash('sha256').update(text).digest('hex'),
    });
  });

  it('counts a decision record with no time apart, and leaves it out of the window', async () => {
    const lines = sampleLines.map((line) => {
      const row = JSON.parse(line);
      if (row.record?.eventId !== realFast.eventId) return line;
      const { atMs: _atMs, ...record } = row.record;
      return JSON.stringify({ ...row, record });
    });
    const journal = await readJournalCopy(write('no-time.ndjson', lines.join('\n') + '\n'));
    journal.close();
    expect([journal.decisionsInWindow, journal.decisionsWithoutTime]).toEqual([7, 1]);
  });

  it('stops by name on a line that is not JSON, naming the line', async () => {
    // a copy cut off in the middle of its last record
    const cut = write('cut.ndjson', sampleText.slice(0, sampleText.length - 2000));
    await expect(readJournalCopy(cut)).rejects.toThrow(
      /cut\.ndjson: 1 of 17 lines are not readable JSON \(line 17 \(byte \d+\)\); the copy is truncated or damaged, nothing was re-run/
    );
    const garbled = write(
      'garbled.ndjson',
      [sampleLines[0], 'not json', ...sampleLines.slice(1, 4), '{"half":', ''].join('\n')
    );
    await expect(readJournalCopy(garbled)).rejects.toThrow(
      /2 of 6 lines are not readable JSON \(line 2 \(byte \d+\), line 6 \(byte \d+\)\)/
    );
  });

  it('stops by name when the header line declares another number of records than were read', async () => {
    const short = write('short.ndjson', sampleLines.slice(0, -1).join('\n') + '\n');
    await expect(readJournalCopy(short)).rejects.toThrow(
      /short\.ndjson: its header line declares 16 records but 15 were read; the copy is incomplete, nothing was re-run/
    );
  });

  it('stops by name when the copy changes between selecting and reading back', async () => {
    const file = pairCopy();
    const journal = await readJournalCopy(file);
    try {
      writeFileSync(file, 'x'.repeat(Buffer.byteLength(readFileSync(file))));
      expect(() => journal.load(journal.selected[0])).toThrow(
        /pair\.ndjson changed after it was read \(no record at byte \d+\)/
      );
    } finally {
      journal.close();
    }
  });
});
