import { usePlayerPreference } from '../../hooks/usePlayerPreference';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PLAYER NOTES PANEL — In-Game Note Taking
 * Take and view notes on opponents during gameplay
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useStaggerAnimation } from '../../hooks/useStaggerAnimation';
import { useAuthUser } from '../../hooks/useAuthUser';
import {
  LABEL_TO_HEX,
  NOTE_COLORS,
  PLAYER_TAGS,
  playerNotesService,
} from '../../services/PlayerNotesService';
import { useToast } from '../common/Toast';
import styles from './PlayerNotesPanel.module.css';
import { SpadeConsole } from '../console/SpadeConsole';
import { reportError } from '../../utils/errorReporter';
import {
  playerDisplayName,
  PLAYER_NAME_COLUMNS,
  type NameableProfile,
} from '../../utils/playerDisplayName';
import { selectInBatches } from '../../lib/inBatches';

interface PlayerNote {
  id: string;
  targetUserId: string;
  targetName: string;
  targetAvatar?: string;
  note: string;
  tags: string[];
  color: string;
  lastUpdated: string;
}

interface PlayerNotesPanelProps {
  targetUserId?: string;
  targetName?: string;
  targetAvatar?: string;
  onClose?: () => void;
  compact?: boolean;
}

// Use canonical constants from PlayerNotesService
const PRESET_TAGS = PLAYER_TAGS;

export default function PlayerNotesPanel({
  targetUserId,
  targetName,
  targetAvatar,
  onClose,
  compact = false,
}: PlayerNotesPanelProps) {
  const { user } = useAuthUser();
  const [notes, setNotes] = useState<PlayerNote[]>([]);
  const [currentNote, setCurrentNote] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedColor, setSelectedColor] = useState('none');
  const [loading, setLoading] = useState(true);
  /* When the existing note could not be read, saving would overwrite a note
     the player cannot see. The save button refuses until a reload succeeds. */
  const [noteLoadFailed, setNoteLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  /** Whether a row for this opponent existed when the editor opened. */
  const existingNoteRef = useRef(false);
  const accountRequestRef = useRef(0);
  const [searchQuery, setSearchQuery] = usePlayerPreference('playerNotes.search', '', 'global');
  const toast = useToast();
  const { style: staggerStyle } = useStaggerAnimation(notes.length);
  const activeScope = `${user?.id || 'anonymous'}:${targetUserId || 'library'}`;
  const activeScopeRef = useRef(activeScope);
  const [stateScope, setStateScope] = useState(activeScope);

  // Auth and target changes can replace this panel without unmounting it.
  // Move the authority ref during render so late continuations are stale even
  // before passive-effect cleanup runs.
  if (activeScopeRef.current !== activeScope) {
    activeScopeRef.current = activeScope;
    accountRequestRef.current += 1;
  }

  const stateBelongsToActiveScope = stateScope === activeScope;
  const visibleNotes = stateBelongsToActiveScope ? notes : [];
  const visibleCurrentNote = stateBelongsToActiveScope ? currentNote : '';
  const visibleSelectedTags = stateBelongsToActiveScope ? selectedTags : [];
  const visibleSelectedColor = stateBelongsToActiveScope ? selectedColor : 'none';
  const visibleLoading = !stateBelongsToActiveScope || loading;
  const visibleLoadFailed = stateBelongsToActiveScope && noteLoadFailed;

  useEffect(() => {
    let mounted = true;
    const requestedUserId = user?.id;
    const requestedTargetUserId = targetUserId;
    const requestedScope = activeScope;
    const requestId = ++accountRequestRef.current;
    const isCurrent = () =>
      mounted &&
      activeScopeRef.current === requestedScope &&
      accountRequestRef.current === requestId;

    setStateScope(requestedScope);
    setNotes([]);
    setCurrentNote('');
    setSelectedTags([]);
    setSelectedColor('none');
    setSaving(false);
    savingRef.current = false;
    setNoteLoadFailed(false);
    existingNoteRef.current = false;
    setLoading(!!requestedUserId);

    if (!requestedUserId) {
      setLoading(false);
      return () => {
        mounted = false;
      };
    }

    const loadSingleNote = async () => {
      const { data, error } = await supabase
        .from('player_notes')
        .select('id, user_id, target_user_id, notes, color_label, tags')
        .eq('user_id', requestedUserId)
        .eq('target_user_id', requestedTargetUserId)
        .maybeSingle();

      if (!isCurrent()) return;
      if (error) {
        reportError(error, 'PlayerNotesPanel.loadSingleNote');
        setNoteLoadFailed(true);
        setLoading(false);
        toast.error('Your Note On This Player Could Not Be Loaded');
        return;
      }
      existingNoteRef.current = !!data;
      if (data) {
        setCurrentNote(data.notes || '');
        setSelectedTags(data.tags || []);
        setSelectedColor(data.color_label || 'none');
      }
      setLoading(false);
    };

    const loadAllNotes = async () => {
      const { data, error } = await supabase
        .from('player_notes')
        .select('id, target_user_id, notes, tags, color_label, updated_at')
        .eq('user_id', requestedUserId)
        .order('updated_at', { ascending: false });

      if (!isCurrent()) return;
      if (error) {
        reportError(error, 'PlayerNotesPanel.loadAllNotes');
        setNoteLoadFailed(true);
        setLoading(false);
        return;
      }
      if (data) {
        const tIds = [...new Set(data.map((n: any) => n.target_user_id).filter(Boolean))];
        const pMap: Record<string, NameableProfile & { avatar_url?: string }> = {};
        if (tIds.length > 0) {
          try {
            const { data: profs, error: profsReadError } = await selectInBatches(tIds, (batch) =>
              supabase
                .from('profiles')
                .select(`id, ${PLAYER_NAME_COLUMNS}, avatar_url:arena_avatar_url`)
                .in('id', batch)
            );
            // A failed read keeps the name fallback, but it is reported, never silent.
            if (profsReadError) reportError(profsReadError, 'PlayerNotesPanel.profiles');
            if (!isCurrent()) return;
            if (profs) for (const p of profs) pMap[p.id] = p;
          } catch (error) {
            if (!isCurrent()) return;
            reportError(error, 'PlayerNotesPanel.Set');
          }
        }
        const mapped: PlayerNote[] = data.map((note: any) => ({
          id: note.id,
          targetUserId: note.target_user_id,
          targetName: playerDisplayName(pMap[note.target_user_id]),
          targetAvatar: pMap[note.target_user_id]?.avatar_url,
          note: note.notes,
          tags: note.tags || [],
          color: LABEL_TO_HEX[note.color_label as string] || LABEL_TO_HEX.none,
          lastUpdated: note.updated_at,
        }));
        if (isCurrent()) setNotes(mapped);
      }
      if (isCurrent()) setLoading(false);
    };

    void (requestedTargetUserId ? loadSingleNote() : loadAllNotes()).catch((error) => {
      if (!isCurrent()) return;
      reportError(error, 'PlayerNotesPanel.Load');
      setNoteLoadFailed(true);
      setLoading(false);
    });
    return () => {
      mounted = false;
      if (accountRequestRef.current === requestId) accountRequestRef.current += 1;
    };
  }, [activeScope, targetUserId, toast, user?.id, loadAttempt]);

  const saveNote = async () => {
    const requestedUserId = user?.id;
    const requestedScope = activeScope;
    const note = visibleCurrentNote.trim();
    if (
      !requestedUserId ||
      !targetUserId ||
      savingRef.current ||
      !stateBelongsToActiveScope ||
      visibleLoading
    )
      return;
    if (visibleLoadFailed) {
      toast.error('Your Existing Note Could Not Be Read. Reopen The Panel Before Saving.');
      return;
    }
    const requestId = ++accountRequestRef.current;
    const isCurrent = () =>
      activeScopeRef.current === requestedScope && accountRequestRef.current === requestId;
    savingRef.current = true;
    setSaving(true);

    try {
      /* A BLANK SAVE IS A CLEAR (2026-11-04). Saving with no text, no tags
         and no colour used to write an empty row, which then counted as "a
         note on this player" everywhere a note is counted: the Notes Library
         listed a blank card and the seat would wear the post-it for nothing.
         Clearing every field and saving now removes the row instead. */
      const isBlank =
        note === '' && visibleSelectedTags.length === 0 && visibleSelectedColor === 'none';
      if (isBlank) {
        if (existingNoteRef.current) {
          await playerNotesService.deleteNote(requestedUserId, targetUserId);
          existingNoteRef.current = false;
          if (isCurrent()) toast.success('Note Cleared');
        }
        // Nothing to write and nothing to clear: just hand the felt back.
        if (isCurrent()) onClose?.();
        return;
      }

      const { error } = await supabase.from('player_notes').upsert(
        {
          user_id: requestedUserId,
          target_user_id: targetUserId,
          notes: note,
          tags: visibleSelectedTags,
          color_label: visibleSelectedColor,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,target_user_id' }
      );

      if (error) throw error;
      playerNotesService.clearCache();
      existingNoteRef.current = true;
      playerNotesService.notifyChanged({
        userId: requestedUserId,
        targetUserId,
        hasNote: true,
        colorLabel: visibleSelectedColor,
      });
      if (isCurrent()) {
        toast.success('Note Saved');
        onClose?.();
      }
    } catch (error) {
      reportError(error, 'PlayerNotesPanel.Save');
      if (isCurrent()) toast.error('Failed To Save Note. Your Draft Is Still Here.');
    } finally {
      if (isCurrent()) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };

  const toggleTag = (tag: string) => {
    if (!stateBelongsToActiveScope || visibleLoading || visibleLoadFailed) return;
    // Removing a tag is always free
    if (visibleSelectedTags.includes(tag)) {
      setSelectedTags((prev) => prev.filter((t) => t !== tag));
      return;
    }

    /* TAGS ARE FREE (Dan 2026-11-04). Until today a non-VIP player paid a
       diamond for the tag pack before the first tag would stick, and the
       feature had two users in production. Club Arena is free to play; a
       note's tags are part of the note. No status check, no purchase, no
       top-up sheet. Removing a tag was always free; adding one now is too. */
    if (activeScopeRef.current !== activeScope) return;
    setSelectedTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
  };

  const deleteNote = async (noteId: string) => {
    const requestedUserId = user?.id;
    const requestedScope = activeScope;
    if (!requestedUserId || !stateBelongsToActiveScope) return;
    const requestId = ++accountRequestRef.current;
    const removed = visibleNotes.find((n) => n.id === noteId);
    // SECURITY: Scope to current user to prevent deleting other users' notes
    const { error } = await supabase
      .from('player_notes')
      .delete()
      .eq('id', noteId)
      .eq('user_id', requestedUserId);
    if (activeScopeRef.current !== requestedScope || accountRequestRef.current !== requestId)
      return;
    if (error) {
      toast.error('Failed To Delete Note');
      return;
    }
    playerNotesService.clearCache();
    if (removed?.targetUserId) {
      playerNotesService.notifyChanged({
        userId: requestedUserId,
        targetUserId: removed.targetUserId,
        hasNote: false,
      });
    }
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
  };

  const filteredNotes = visibleNotes.filter(
    (n) =>
      n.targetName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.note.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Single note editor mode
  if (targetUserId) {
    const saveLabel = saving ? 'Saving...' : 'Save Note';
    const saveDisabled =
      saving || visibleLoading || visibleLoadFailed || !stateBelongsToActiveScope;
    const body = (
      <>
        <p className="sc-copy sc-ink--muted">Private Notes. Only You Can See These.</p>
        <label className={styles.srOnly} htmlFor="player-note-input">
          Notes About This Player
        </label>
        <textarea
          id="player-note-input"
          className={styles.noteInput}
          placeholder="Add Notes About This Player..."
          value={visibleCurrentNote}
          onChange={(e) => setCurrentNote(e.target.value)}
          rows={compact ? 3 : 5}
          disabled={visibleLoading || visibleLoadFailed || saving}
        />

        {visibleLoadFailed && (
          <div className={`${styles.empty} sc-ink--red`} role="alert">
            Player Note Could Not Be Loaded.
            <button
              className={`${styles.word} sc-ink--white`}
              onClick={() => setLoadAttempt((n) => n + 1)}
            >
              Retry
            </button>
          </div>
        )}

        <div className={styles.section}>
          <span className={`${styles.sectionTitle} sc-label sc-ink--blue`}>Tags</span>
          <div className={styles.tags} role="group" aria-label="Player Tags">
            {PRESET_TAGS.map((tag) => {
              const on = visibleSelectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={`${styles.word} ${styles.tag} ${on ? `${styles.selected} sc-ink--white` : 'sc-ink--muted'}`}
                  aria-pressed={on}
                  onClick={() => toggleTag(tag)}
                  disabled={
                    !stateBelongsToActiveScope || visibleLoading || visibleLoadFailed || saving
                  }
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.section}>
          <span className={`${styles.sectionTitle} sc-label sc-ink--blue`}>Color Label</span>
          <div className={styles.colors} role="group" aria-label="Note Color">
            {NOTE_COLORS.map((color) => (
              <button
                key={color.value}
                type="button"
                className={`${styles.colorBtn} ${visibleSelectedColor === color.value ? styles.selected : ''}`}
                style={{ backgroundColor: color.hex }}
                onClick={() => setSelectedColor(color.value)}
                title={color.name}
                aria-label={color.name}
                aria-pressed={visibleSelectedColor === color.value}
                disabled={
                  !stateBelongsToActiveScope || visibleLoading || visibleLoadFailed || saving
                }
              />
            ))}
          </div>
        </div>
      </>
    );
    /* TWO ACTIONS OR NONE on the painted plates: with a caller to hand the
       panel back to, Cancel and Save Note take the two plates; without one
       the foot closes flat and Save Note is a lit word on the glass. */
    if (onClose) {
      return (
        <SpadeConsole
          onClose={onClose}
          className={`${styles.console} ${compact ? styles.compact : ''}`}
          eyebrow="Player Notes"
          title={targetName || 'Player'}
          pill={visibleLoading ? 'Reading' : visibleLoadFailed ? 'Unread' : 'Note'}
          pillInk={visibleLoadFailed ? 'red' : 'blue'}
          plates={{
            secondary: { label: 'Cancel', onClick: onClose },
            primary: { label: saveLabel, ink: 'white', onClick: saveNote, disabled: saveDisabled },
          }}
        >
          {body}
        </SpadeConsole>
      );
    }
    return (
      <SpadeConsole
        onClose={onClose}
        className={`${styles.console} ${compact ? styles.compact : ''}`}
        eyebrow="Player Notes"
        title={targetName || 'Player'}
        pill={visibleLoading ? 'Reading' : visibleLoadFailed ? 'Unread' : 'Note'}
        pillInk={visibleLoadFailed ? 'red' : 'blue'}
        foot="foot"
      >
        {body}
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.word} ${styles.saveBtn} sc-ink--white`}
            onClick={saveNote}
            disabled={saveDisabled}
          >
            {saveLabel}
          </button>
        </div>
      </SpadeConsole>
    );
  }

  // Notes library mode
  const library = (
    <>
      <label className={styles.srOnly} htmlFor="player-notes-search">
        Search Notes
      </label>
      <input
        id="player-notes-search"
        type="text"
        className={styles.searchInput}
        placeholder="Search Notes..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        disabled={visibleLoading || visibleLoadFailed || saving}
      />

      <div className={styles.notesList}>
        {visibleLoading ? (
          <div className={`${styles.empty} sc-ink--muted`}>Loading Notes...</div>
        ) : visibleLoadFailed ? (
          <div className={`${styles.empty} sc-ink--red`} role="alert">
            Player Notes Could Not Be Loaded. Close And Try Again.
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className={`${styles.empty} sc-ink--muted`}>
            {searchQuery ? 'No Matching Notes' : 'No Notes Yet'}
          </div>
        ) : (
          filteredNotes.map((note, idx) => (
            <div key={note.id} className={styles.noteCard} style={staggerStyle(idx)}>
              <div className={styles.noteHeader}>
                <div className={styles.targetInfo}>
                  <span
                    className={styles.swatch}
                    style={{ backgroundColor: note.color }}
                    aria-hidden="true"
                  />
                  <div className={styles.avatar}>
                    {note.targetAvatar ? (
                      <img loading="lazy" decoding="async" src={note.targetAvatar} alt="" />
                    ) : (
                      ''
                    )}
                  </div>
                  <span className={`${styles.targetName} sc-ink--silver`}>{note.targetName}</span>
                </div>
                <span className={`${styles.noteDate} sc-ink--muted`}>
                  {formatDate(note.lastUpdated)}
                </span>
              </div>
              <p className={`${styles.noteText} sc-copy`}>{note.note}</p>
              <div className={styles.noteFoot}>
                {note.tags.length > 0 && (
                  <div className={styles.noteTags}>
                    {note.tags.map((tag) => (
                      <span key={tag} className={`${styles.noteTag} sc-ink--blue`}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className={`${styles.word} ${styles.deleteBtn} sc-ink--red`}
                  onClick={() => deleteNote(note.id)}
                  aria-label={`Delete Note On ${note.targetName}`}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
  if (onClose) {
    return (
      <SpadeConsole
        onClose={onClose}
        className={styles.console}
        eyebrow="Player Notes"
        title="Notes Library"
        pill={loading ? 'Reading' : `${notes.length.toLocaleString()} Notes`}
        foot="foot"
      >
        {library}
        <div className={styles.actions}>
          <button type="button" className={`${styles.word} sc-ink--white`} onClick={onClose}>
            Close
          </button>
        </div>
      </SpadeConsole>
    );
  }
  return (
    <SpadeConsole
      onClose={onClose}
      className={styles.console}
      eyebrow="Player Notes"
      title="Notes Library"
      pill={loading ? 'Reading' : `${notes.length.toLocaleString()} Notes`}
      foot="foot"
    >
      {library}
    </SpadeConsole>
  );
}
