import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  breakConsoleTitle,
  breakCountdownLabel,
  breakMiniState,
  breakWaitingLabel,
} from '../../src/components/table/breakScreenCopy';
import { sliceEnclosingBlock } from '../helpers/sourceWindow';

const read = (p: string) => readFileSync(join(__dirname, '../..', p), 'utf8');

describe('break card copy (Dan 2026-11-07)', () => {
  it('names how many tables are still finishing', () => {
    expect(breakWaitingLabel(1)).toBe('Waiting On 1 Table To Finish');
    expect(breakWaitingLabel(3)).toBe('Waiting On 3 Tables To Finish');
    expect(breakWaitingLabel(null)).toBe('Waiting For Every Table To Finish');
    expect(breakWaitingLabel(0)).toBe('Waiting For Every Table To Finish');
    expect(breakMiniState(false, false, 2)).toBe('2 Tables Left');
    expect(breakMiniState(false, false, null)).toBe('Finishing Hands');
  });

  it('says when a break is extended for the daily update', () => {
    expect(breakConsoleTitle(false, true)).toBe('Extended Break');
    expect(breakConsoleTitle(false, false)).toBe('Tournament Break');
    expect(breakConsoleTitle(true, true)).toBe('Add-On Break');
    expect(breakCountdownLabel(true)).toBe('Daily Update: Play Resumes In');
    expect(breakCountdownLabel(false)).toBe('Play Resumes In');
    expect(breakMiniState(true, true, null)).toBe('Daily Update');
    expect(breakMiniState(true, false, null)).toBe('Paused');
  });

  it('never uses an em dash', () => {
    for (const s of [
      breakWaitingLabel(2),
      breakCountdownLabel(true),
      breakMiniState(true, true, 1),
      breakConsoleTitle(false, true),
    ]) {
      expect(s).not.toContain('—');
    }
  });

  it('is wired: the page hears break_wait and extendedFor, and hands both to the card', () => {
    const page = read('src/pages/TablePage.tsx');
    const wait = sliceEnclosingBlock(page, "data?.type === 'break_wait'");
    expect(wait).toMatch(/tablesFinishing: finishing/);
    expect(page).toMatch(/p\.extendedFor === 'daily_update'/);
    expect(page).toMatch(/maintenanceBreak\.active &&\s*!tournamentBreak\.extendedForDailyUpdate/);
    const layer = read('src/components/table/TableModalsLayer.tsx');
    expect(layer).toMatch(
      /tablesFinishing=\{addOnBreakNotice \? null : \(tournamentBreak\.tablesFinishing \?\? null\)\}/
    );
    expect(layer).toMatch(
      /extendedForDailyUpdate=\{\s*!addOnBreakNotice && tournamentBreak\.extendedForDailyUpdate === true\s*\}/
    );
    const screen = read('src/components/table/TournamentBreakScreen.tsx');
    expect(screen).toMatch(/breakWaitingLabel\(tablesFinishing\)/);
    expect(screen).toMatch(/breakCountdownLabel\(extendedForDailyUpdate\)/);
    expect(screen).toMatch(/breakConsoleTitle\(!!addOnNotice, extendedForDailyUpdate\)/);
  });
});
