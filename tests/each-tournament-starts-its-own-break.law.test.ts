/**
 * EACH TOURNAMENT STARTS ITS OWN FIVE MINUTES (Dan 2026-10-25, BINDING).
 *
 * Dan, verbatim: "THE 5 MINUTE BREAK FOR ALL TOURNAMENTS DOES NOT START FOR
 * THE TOURNAMENT UNTIL ALL HANDS FOR THAT SPECIFIC TOURNAMENT ARE COMPLETED,
 * 'LAST HAND BEFORE BREAK' THEN BREAK, NOT STARTING THE CLOCK BEFORE THE LAST
 * HAND INSIDE THAT TOURNAMENT IS COMPLETED. EVERY TOURNAMENT WILL START AND
 * STOP THERE 5 MINUTE BREAK AT DIFFERENT TIMES WITH THIS SETTING. BUT THIS IS
 * 100% HOW ITS SUPPOSED TO BE."
 *
 * Two things were wrong, and both are pinned here:
 *
 * 1. The engine waited for every table of EVERY tournament and stamped one
 *    shared end on all of them, then resumed them all at once.
 * 2. The table's break clock was never handed the phase or the server's end
 *    time, so it fell back to its 'counting_down' default and ran a local five
 *    minutes from :55 while the last hand was still being played (Dan's
 *    screenshot: "Break: 4:24" over a live flop, with "Resumes: Last Hand"
 *    in the info bar beneath it).
 *
 * The behaviour itself is exercised in server/src/SynchronizedBreakDeadline.test.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const GAME_SERVER = read('server/src/GameServer.ts');
const MODALS = read('src/components/table/TableModalsLayer.tsx');
const SCREEN = read('src/components/table/TournamentBreakScreen.tsx');

function method(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, signature).toBeGreaterThan(-1);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated ${signature}`);
}

describe('each tournament starts its own break', () => {
  it('the :55 trigger hands every tournament to its own break instead of one shared drain', () => {
    const trigger = method(GAME_SERVER, 'private async triggerSynchronizedBreak()');
    expect(trigger).toContain(
      'this.runTournamentBreak(tm, maintenanceEndsAt, generation, breakGeneration)'
    );
    expect(trigger).not.toMatch(/waitForAllTablesParked\(\s*breakEngines\s*\)/);
    expect(trigger).not.toMatch(/beginBreakCountdown\(/);
  });

  it("a tournament's countdown waits for that tournament's tables alone", () => {
    const own = method(GAME_SERVER, 'private async runTournamentBreak(');
    expect(own).toContain('await this.waitForAllTablesParked([tm])');
    const wait = method(GAME_SERVER, 'private async waitForAllTablesParked(');
    // The drain must not widen itself to other tournaments.
    expect(wait).not.toContain('this.tournamentEngines');
    expect(wait).not.toContain('PARK_WAIT_CEILING_MS');
    expect(wait).toContain('if (waitingOn.length === 0) return true');
  });

  it('each tournament is resumed by its own timer, never by a sweep of every engine', () => {
    const schedule = method(GAME_SERVER, 'private scheduleTournamentBreakResume(');
    expect(schedule).toContain('this.resumeTournamentBreak(tm, generation, breakGeneration)');
    const resume = method(GAME_SERVER, 'private async resumeSynchronizedBreak(');
    expect(resume).not.toContain('this.tournamentEngines');
  });

  it('the table break clock is told the phase and the real end, and waits until then', () => {
    expect(MODALS).toMatch(
      /phase=\{addOnBreakNotice\?\.phase \?\? tournamentBreak\.phase \?\? 'last_hand'\}/
    );
    expect(MODALS).toMatch(
      /breakEndsAtMs=\{\s*addOnBreakNotice \? addOnBreakNotice\.endsAtMs : \(tournamentBreak\.breakEndsAtMs \?\? null\)\s*\}/
    );
    expect(SCREEN).toContain('? `Break: ${formatTime(displayTime)}`');
    /* "Last Hand" belongs to the add-on window alone (Dan 2026-11-01): a plain
       break's waiting state says Waiting, because the card only shows once
       this table's own hand is done. */
    expect(SCREEN).toContain("? 'Add-On: Last Hand'");
    expect(SCREEN).toContain(": 'Break: Waiting'");
  });

  it("the full card never covers this table's own live hand (Dan 2026-11-01)", () => {
    /* "THE TOURNAMENT BREAK CARD SHOULD NOT POP UP UNTIL THE HAND AT THE
       CURRENT TABLE IS FINISHED." TableModalsLayer hands the screen this
       table's live-hand flag, and during the last-hand window with a hand in
       play the screen renders only the small waiting chip. */
    expect(MODALS).toContain('heroHandLive={isHandInProgress}');
    expect(SCREEN).toContain('if (!countingDown && heroHandLive) {');
    expect(SCREEN).toContain('Will Start When All Tables Finish Their Current Hand');
  });

  it('the add-on break card carries a working Add On button (Dan 2026-11-01)', () => {
    /* "WHERE IS THE ACTUAL 'ADD ON BUTTON' ON THE CARD?! THERE IS NO WAY TO
       ACTUALLY ADD ON." The card's button opens the same confirmed,
       price-bound offer the table menu's Add-On item opens. */
    expect(SCREEN).toContain('className="break-screen__addon-btn"');
    expect(SCREEN).toContain('disabled={!countingDown}');
    expect(MODALS).toContain('onAddOn={onOpenAddOn}');
    const PAGE = read('src/pages/TablePage.tsx');
    expect(PAGE).toContain('onOpenAddOn={() => void handleTournamentAddOn()}');
  });
});
