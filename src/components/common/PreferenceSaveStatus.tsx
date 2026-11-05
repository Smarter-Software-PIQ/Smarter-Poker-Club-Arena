/**
 * PREFERENCE SAVE STATUS - says whether the account has the player's last
 * change (Dan 2026-11-05: "Pending or failed saves must be visible and
 * retryable; the interface should confirm that a change is saved only after
 * the backend acknowledges it").
 *
 *   Saving                       a change is waiting for the account
 *   Saved                        the account accepted it (shown briefly)
 *   Not Saved  [Retry]           the save failed; nothing was discarded
 *   Sign In To Save              the session ended; the change waits for it
 *   Changed On Another Device    the account kept a newer value, now shown
 *
 * Reads src/lib/preferenceSync.ts; renders nothing while idle.
 */
import { useEffect, useState } from 'react';
import {
  aggregateSaveStatus,
  retrySave,
  useSaveStatus,
  type SaveState,
} from '../../lib/preferenceSync';

interface Props {
  /** Owner-scoped prefixes to watch, e.g. `${userId}:lobby:${clubId}`. */
  prefixes: string[];
  floating?: boolean;
}

const RANK: Record<SaveState, number> = {
  failed: 5,
  signed_out: 4,
  conflict: 3,
  saving: 2,
  saved: 1,
  idle: 0,
};

export function PreferenceSaveStatus({ prefixes, floating = false }: Props) {
  // One subscription re-renders on any change; each prefix is then read.
  useSaveStatus(prefixes[0] ?? '');
  const watched = prefixes.map((prefix) => ({ prefix, ...aggregateSaveStatus(prefix) }));
  const top = watched.reduce(
    (best, w) => (RANK[w.status.state] > RANK[best.status.state] ? w : best),
    watched[0] ?? {
      prefix: '',
      scopeKey: null,
      status: { state: 'idle' as SaveState, conflicts: [], updatedAt: 0 },
    }
  );
  const [dismissedAt, setDismissedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const state = top.status.state;
  const updatedAt = top.status.updatedAt;

  useEffect(() => {
    if (state !== 'saved') return;
    const t = setTimeout(() => setNow(Date.now()), 2600);
    return () => clearTimeout(t);
  }, [state, updatedAt]);

  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (state === 'idle') return null;
  if (state === 'saved' && now - updatedAt > 2500 && now > updatedAt) return null;
  if (state === 'conflict' && dismissedAt >= updatedAt) return null;

  const label =
    state === 'saving'
      ? offline
        ? 'Saved On This Device, Waiting For Connection'
        : 'Saving'
      : state === 'saved'
        ? 'Saved'
        : state === 'failed'
          ? 'Not Saved'
          : state === 'signed_out'
            ? 'Sign In To Save'
            : 'Changed On Another Device';
  const tone =
    state === 'failed' || state === 'signed_out'
      ? '#f87171'
      : state === 'conflict'
        ? '#fbbf24'
        : state === 'saved'
          ? '#4ade80'
          : '#93c5fd';

  return (
    <div
      role="status"
      aria-live="polite"
      data-save-state={state}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: tone,
        background: 'rgba(15, 23, 42, 0.85)',
        border: `1px solid ${tone}`,
        ...(floating ? { position: 'fixed', bottom: 120, right: 16, zIndex: 9998 } : {}),
      }}
    >
      <span>{label}</span>
      {(state === 'failed' || state === 'signed_out') && top.scopeKey && (
        <button
          type="button"
          onClick={() => retrySave(top.scopeKey!)}
          style={{
            background: 'none',
            border: 'none',
            color: tone,
            textDecoration: 'underline',
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          Retry
        </button>
      )}
      {state === 'conflict' && (
        <button
          type="button"
          onClick={() => setDismissedAt(Date.now())}
          style={{
            background: 'none',
            border: 'none',
            color: tone,
            textDecoration: 'underline',
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

export default PreferenceSaveStatus;
