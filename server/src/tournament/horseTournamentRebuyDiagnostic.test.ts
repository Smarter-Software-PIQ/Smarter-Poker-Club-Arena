import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  horseRebuyFailureClass,
  reportHorseRebuyDecision,
  shouldEmitHorseRebuyDiagnostic,
} from './horseTournamentRebuyDiagnostic.js';
afterEach(() => vi.restoreAllMocks());
describe('original Horse rebuy input diagnostics', () => {
  it('records a stable generation, choice, deadline, response timing and SQLSTATE without error payloads', () => {
    vi.spyOn(Date, 'now').mockReturnValue(12345);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    reportHorseRebuyDecision({
      tournamentId: 'event',
      userId: 'horse',
      handNumber: 7,
      choice: true,
      phase: 'purchase_unproven',
      bustAtMs: 1000,
      promptUntilMs: 12000,
      startedAtMs: 11000,
      error: {
        code: '55000',
        message: 'Rebuy or re-entry decision window has closed',
        secret: 'never export',
      },
    });
    const text = log.mock.calls[0][0] as string;
    const record = JSON.parse(text.slice(text.indexOf('{')));
    expect(record).toMatchObject({
      schema: 'horse-rebuy-decision/v1',
      handNumber: 7,
      choice: true,
      phase: 'purchase_unproven',
      remainingMs: -345,
      elapsedMs: 1345,
      sqlstate: '55000',
      failureClass: 'cutoff',
    });
    expect(text).not.toContain('never export');
    expect(text).not.toContain('message');
  });
  it('keeps transport/timeout outcomes unknown and diagnostics cannot unwind gameplay', () => {
    expect(horseRebuyFailureClass(new Error('fetch failed'))).toBe('transport');
    expect(horseRebuyFailureClass({ code: '57014' })).toBe('timeout');
    expect(horseRebuyFailureClass(null)).toBe('unknown');
    vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('broken stderr');
    });
    expect(() =>
      reportHorseRebuyDecision({
        tournamentId: 'event',
        userId: 'horse',
        handNumber: 7,
        choice: true,
        phase: 'purchased',
        bustAtMs: null,
        promptUntilMs: null,
      })
    ).not.toThrow();
  });

  it('deduplicates repeated polling phases per (userId, handNumber, phase) while preserving active purchase transitions and bounded memory (1e532243)', () => {
    const seen = new Set<string>();
    expect(shouldEmitHorseRebuyDiagnostic(seen, 'u1', 100, 'choice')).toBe(true);
    expect(shouldEmitHorseRebuyDiagnostic(seen, 'u1', 100, 'choice')).toBe(false);
    expect(shouldEmitHorseRebuyDiagnostic(seen, 'u1', 100, 'deferred')).toBe(true);
    expect(shouldEmitHorseRebuyDiagnostic(seen, 'u1', 100, 'deferred')).toBe(false);
    expect(shouldEmitHorseRebuyDiagnostic(seen, 'u1', 100, 'purchase_pending')).toBe(true);
    expect(shouldEmitHorseRebuyDiagnostic(seen, 'u1', 100, 'purchase_pending')).toBe(false);
    // Next hand for the same horse emits again.
    expect(shouldEmitHorseRebuyDiagnostic(seen, 'u1', 101, 'choice')).toBe(true);
    // Active purchase attempts and outcomes are never suppressed.
    expect(shouldEmitHorseRebuyDiagnostic(seen, 'u1', 100, 'purchase_started')).toBe(true);
    expect(shouldEmitHorseRebuyDiagnostic(seen, 'u1', 100, 'purchase_started')).toBe(true);
    expect(shouldEmitHorseRebuyDiagnostic(seen, 'u1', 100, 'purchased')).toBe(true);
    expect(shouldEmitHorseRebuyDiagnostic(seen, 'u1', 100, 'purchase_unproven')).toBe(true);
    expect(shouldEmitHorseRebuyDiagnostic(seen, 'u1', 100, 'purchase_unproven')).toBe(true);
    // Bounded eviction caps memory at maxEntries.
    const small = new Set<string>();
    for (let i = 0; i < 10; i++) {
      expect(shouldEmitHorseRebuyDiagnostic(small, `u${i}`, i, 'deferred', 4)).toBe(true);
    }
    expect(small.size).toBe(4);
  });
});
