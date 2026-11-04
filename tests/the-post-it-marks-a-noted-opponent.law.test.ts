/**
 * THE POST-IT MARKS A NOTED OPPONENT (Dan 2026-11-04, binding)
 *
 * "Add a post it note style icon any time a user adds a note about another
 * player, they should be able to see that they added a note about a player."
 *
 * Source-level pins, so the marker cannot be quietly unwired:
 *  - SeatSlot accepts `hasNote` and paints `.seat__note-marker` for it, never
 *    on the hero's own seat;
 *  - the memo comparator re-renders when `hasNote` changes (a seat that
 *    ignores the prop would keep a stale marker for the whole session);
 *  - TablePage feeds it from usePlayerNoteMarkers, keyed on the signed-in
 *    user, and excludes the hero;
 *  - every writer of a note announces the change through the service, so the
 *    marker appears the moment the note is saved and leaves when deleted.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('the post-it marks a noted opponent', () => {
  const seat = read('src/components/table/SeatSlot.tsx');
  const seatCss = read('src/components/table/SeatSlot.css');
  const table = read('src/pages/TablePage.tsx');
  const panel = read('src/components/gameplay/PlayerNotesPanel.tsx');
  const service = read('src/services/PlayerNotesService.ts');

  it('SeatSlot paints the marker for a noted villain and never for the hero', () => {
    expect(seat).toMatch(/hasNote\?: boolean/);
    expect(seat).toMatch(/\{hasNote && !player\.isHero && \(/);
    expect(seat).toContain('className="seat__note-marker"');
    expect(seat).toContain('aria-label="You Have A Note On This Player"');
  });

  it('a change in hasNote re-renders the seat', () => {
    expect(seat).toContain('if (prev.hasNote !== next.hasNote) return false;');
  });

  it('the marker is painted in the sanctioned brass and is not interactive', () => {
    const block = seatCss.slice(seatCss.indexOf('.seat__note-marker {'));
    expect(block).toMatch(/pointer-events: none;/);
    expect(seat).toContain('#d6ad52');
  });

  it("TablePage feeds the marker from the signed-in user's own notes and excludes the hero", () => {
    expect(table).toContain(
      "import { usePlayerNoteMarkers } from '../hooks/usePlayerNoteMarkers';"
    );
    expect(table).toContain('const notedPlayerIds = usePlayerNoteMarkers(userId);');
    expect(table).toMatch(
      /hasNote=\{\s*!!displayPlayer &&\s*!displayPlayer\.isHero &&\s*displayPlayer\.id !== userId &&\s*notedPlayerIds\.has\(displayPlayer\.id\)\s*\}/
    );
  });

  it('the Notes Library has a door: the hero hub opens it with no target', () => {
    const hub = read('src/components/table/HeroHubPanel.tsx');
    expect(hub).toContain(
      "item('Player Notes', 'Your Private Notes On Other Players', onOpenNotesLibrary)"
    );
    expect(table).toMatch(
      /onOpenNotesLibrary=\{\(\) => \{\s*setSelectedPlayerForNotes\(null\);\s*setShowPlayerNotes\(true\);\s*\}\}/
    );
  });

  it('every note writer announces the change through the service', () => {
    expect(service).toContain(
      'this.notifyChanged({ userId, targetUserId: targetId, hasNote: true });'
    );
    expect(service).toContain(
      'this.notifyChanged({ userId, targetUserId: targetId, hasNote: false });'
    );
    expect(panel.match(/playerNotesService\.notifyChanged\(/g)?.length ?? 0).toBeGreaterThanOrEqual(
      2
    );
    expect(panel).toContain('await playerNotesService.deleteNote(requestedUserId, targetUserId);');
  });
});
