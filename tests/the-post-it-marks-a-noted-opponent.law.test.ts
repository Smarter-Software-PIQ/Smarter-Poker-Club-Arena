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
    expect(seat).toContain('className={`seat__note-marker${');
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

  it('the post-it is tinted with the note colour the player chose', () => {
    expect(seat).toContain('seat__note-marker--${noteColor}');
    expect(seat).toContain('if (prev.noteColor !== next.noteColor) return false;');
    for (const c of ['red', 'orange', 'yellow', 'green', 'blue', 'purple']) {
      expect(seatCss).toContain(`.seat__note-marker--${c} {`);
    }
    expect(table).toContain(
      'noteColor={displayPlayer ? notedPlayerIds.get(displayPlayer.id) : undefined}'
    );
  });

  it('the player menu opens with Add Note or Edit Note, and shows the note colour and tags', () => {
    const picker = read('src/components/table/ThrowableSelector.tsx');
    expect(picker).toContain("{hasNote ? 'Edit Note' : 'Add Note'}");
    expect(picker).toContain('throwable-selector__note-preview');
    const modals = read('src/components/table/TableModalsLayer.tsx');
    expect(modals).toContain('hasNote={selectedPlayerHasNote}');
    expect(modals).toContain('targetUserId={selectedPlayerForNotes?.id}');
  });

  it('tags are free: the notes panel neither checks VIP nor sells a tag pack', () => {
    expect(panel).not.toContain('tag_pack');
    expect(panel).not.toContain('checkVIPStatus');
    expect(panel).not.toContain('showDiamondTopUp');
  });

  it('a note written on another device reaches the open table over realtime', () => {
    const hook = read('src/hooks/usePlayerNoteMarkers.ts');
    expect(hook).toContain("table: 'player_notes'");
    expect(hook).toContain('filter: `user_id=eq.${userId}`');
    const migration = read(
      'supabase/migrations/20261104193818_player_notes_realtime_for_the_seat_post_it.sql'
    );
    expect(migration).toContain(
      'ALTER PUBLICATION supabase_realtime ADD TABLE public.player_notes;'
    );
    /* Never widen the replica identity: Supabase applies no RLS to DELETE
       events, so FULL would broadcast deleted note text to every subscriber. */
    const migrationSql = migration
      .split('\n')
      .filter((line) => !line.startsWith('--'))
      .join('\n');
    expect(migrationSql).not.toMatch(/REPLICA IDENTITY/i);
    expect(hook).toContain("{ event: 'INSERT', ...scope }");
    expect(hook).toContain("{ event: 'UPDATE', ...scope }");
    expect(hook).not.toContain("event: '*'");
    expect(hook).not.toContain("'DELETE'");
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
      'this.notifyChanged({ userId, targetUserId: targetId, hasNote: true, colorLabel });'
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
