import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  canRestoreFinishedTournamentReport,
  fetchTournamentResult,
} from '../../src/services/tournamentResult';
const resultRead = vi.hoisted(() => ({
  entry: { status: 'eliminated', position: null } as Record<string, unknown>,
  status: 'CANCELLED',
  qualification: vi.fn(),
}));
vi.mock('../../src/services/satelliteQualifierResult', () => ({
  readMySatelliteQualifierResult: resultRead.qualification,
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let head = false;
      const response = () => ({
        data: head
          ? null
          : table === 'tournaments'
            ? { status: resultRead.status, name: 'Satellite', is_mystery_bounty: false }
            : resultRead.entry,
        count: head ? 6 : null,
        error: null,
      });
      const query: any = {
        select: (_columns: string, options?: { head?: boolean }) => {
          head = !!options?.head;
          return query;
        },
        eq: () => query,
        maybeSingle: async () => response(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(response()).then(resolve),
      };
      return query;
    },
  },
}));
beforeEach(() => {
  resultRead.entry = { status: 'eliminated', position: null };
  resultRead.status = 'CANCELLED';
  resultRead.qualification.mockReset().mockResolvedValue(null);
});

describe('cancelled tournament result reader preserves canonical satellite evidence', () => {
  it('asks for qualification after cancellation changes winner status to eliminated', async () => {
    resultRead.qualification.mockResolvedValue({
      qualified: true,
      targetId: 'target',
      amount: 100,
      deliveryKind: 'ticket',
    });
    const result = await fetchTournamentResult('satellite', 'hero');
    expect(resultRead.qualification).toHaveBeenCalledWith('satellite', 'hero');
    expect(result.satelliteQualification).toEqual({
      targetId: 'target',
      amount: 100,
      deliveryKind: 'ticket',
    });
    expect(result.entryStatus).toBe('eliminated');
    expect(result.finishPlace).toBeNull();
  });
  it('keeps cancellation unranked when the canonical reader confirms no qualification receipt', async () => {
    const result = await fetchTournamentResult('satellite', 'hero');
    expect(resultRead.qualification).toHaveBeenCalledOnce();
    expect(result.tournamentStatus).toBe('CANCELLED');
    expect(result.satelliteQualification).toBeUndefined();
  });
  it('treats a refused or unreadable receipt as unknown rather than losing an earned award', async () => {
    resultRead.qualification.mockRejectedValue(new Error('satellite qualifier receipt unproven'));
    const result = await fetchTournamentResult('satellite', 'hero');
    expect(result.tournamentStatus).toBeUndefined();
    expect(result.entryStatus).toBeUndefined();
  });
  it.each([
    { status: 'RUNNING', entry: { status: 'eliminated', position: null } },
    { status: 'CANCELLED', entry: { status: 'eliminated', position: 3 } },
  ])(
    'does not broaden qualification reads for ordinary live busts or earned ranks',
    async ({ status, entry }) => {
      resultRead.status = status;
      resultRead.entry = entry;
      await fetchTournamentResult('satellite', 'hero');
      expect(resultRead.qualification).not.toHaveBeenCalled();
    }
  );
  it('keeps the existing completed null-rank winner qualification read', async () => {
    resultRead.status = 'COMPLETED';
    resultRead.entry = { status: 'winner', position: null };
    await fetchTournamentResult('satellite', 'hero');
    expect(resultRead.qualification).toHaveBeenCalledOnce();
  });
});

it('initial completion recovery marks the report as result-only at its producer', () => {
  const page = readFileSync('src/pages/TablePage.tsx', 'utf8');
  const exit = page.slice(
    page.indexOf('const goToLobbyWithResult ='),
    page.indexOf('let durableCompletionLookupInFlight')
  );
  expect(exit).toMatch(
    /resultOnly:\s*loadedFinishedReportReady\s*\|\|\s*loadedTournamentStatus === 'COMPLETED'\s*\|\|\s*loadedTournamentStatus === 'CANCELLED'/
  );
});

describe('initial load restores a finished participant without ending a rebuy decision', () => {
  it.each(['mtt', 'spin', 'sng'])(
    'restores a sealed %s entrant while the event is still running',
    () => {
      expect(
        canRestoreFinishedTournamentReport({
          entryStatus: 'eliminated',
          tournamentStatus: 'RUNNING',
          prizePoolFinalized: true,
          isRebuy: true,
          isReentry: true,
        })
      ).toBe(true);
    }
  );
  it('restores a freezeout bust even before late registration closes', () => {
    expect(
      canRestoreFinishedTournamentReport({
        entryStatus: 'eliminated',
        tournamentStatus: 'RUNNING',
        prizePoolFinalized: false,
        isRebuy: false,
        isReentry: false,
      })
    ).toBe(true);
  });
  it.each(['playing', 'registered'])('does not report a %s entrant as finished', (entryStatus) => {
    expect(
      canRestoreFinishedTournamentReport({
        entryStatus,
        tournamentStatus: 'RUNNING',
        prizePoolFinalized: true,
      })
    ).toBe(false);
  });
  it('waits for committed tournament completion before recovering a winner', () => {
    expect(
      canRestoreFinishedTournamentReport({
        entryStatus: 'winner',
        tournamentStatus: 'RUNNING',
        prizePoolFinalized: true,
        isRebuy: false,
        isReentry: false,
      })
    ).toBe(false);
    expect(
      canRestoreFinishedTournamentReport({
        entryStatus: 'winner',
        tournamentStatus: 'COMPLETED',
        prizePoolFinalized: true,
      })
    ).toBe(true);
  });
  it('preserves an open rebuy or re-entry decision and refuses unknown finality', () => {
    for (const fields of [
      { isRebuy: true, isReentry: false },
      { isRebuy: false, isReentry: true },
      {},
    ])
      expect(
        canRestoreFinishedTournamentReport({
          entryStatus: 'eliminated',
          tournamentStatus: 'RUNNING',
          prizePoolFinalized: false,
          ...fields,
        })
      ).toBe(false);
  });
});

it('explicit player following keeps an old bust report from closing the observer', () => {
  const page = readFileSync('src/pages/TablePage.tsx', 'utf8');
  const multi = readFileSync('src/pages/MultiTablePage.tsx', 'utf8');
  const condition = page.match(
    /if \(\s*(loadedTournamentStatus === 'COMPLETED' \|\|\s*\(loadedFinishedReportReady && !followingPlayerRef.current\))\s*\) \{\s*void exitFromDurableCompletion\(\);/
  );
  expect(condition).not.toBeNull();
  const restore = new Function(
    'loadedTournamentStatus',
    'loadedFinishedReportReady',
    'followingPlayerRef',
    `return ${condition![1]};`
  );
  expect(restore('RUNNING', true, { current: true })).toBe(false);
  expect(restore('RUNNING', true, { current: false })).toBe(true);
  expect(restore('RUNNING', false, { current: true })).toBe(false);
  expect(restore('COMPLETED', true, { current: true })).toBe(true);
  expect(multi.match(/followingPlayer=\{!!table.followPlayer\}/g)).toHaveLength(2);
  expect(page).toContain('followingPlayerRef.current = followingPlayer;');
});
