/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CLUB DATA - HIT AND RUN (owner 2026-11-06)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Who in this club is in a ten-hand countdown right now, how many hands they
 * still owe in profit, and whose confirmed early leave is being blinded off -
 * so an owner can answer "why can't I leave?" from one screen.
 *
 * The scope is the database's (ca_club_hit_run_status reads
 * fn_ca_club_data_scope): owners, co-owners and admins see the whole club,
 * agents their own downline, everyone else nothing. A refused or unreadable
 * answer renders nothing: this panel never guesses.
 *
 * Refreshed every 30 seconds while the page is visible; the count itself
 * moves once per hand, so that is as fresh as it can be.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { SpadeConsole } from '../../components/console/SpadeConsole';
import styles from './ClubHitRunPanel.module.css';

export const CLUB_HIT_RUN_REFRESH_MS = 30_000;

export interface ClubHitRunRow {
  user_id: string;
  username: string;
  table_id: string;
  table_name: string;
  stakes: string;
  hands_remaining: number;
  hands_required: number;
  blind_off: boolean;
  /**
   * THE COUNT IS PAUSED (owner 2026-11-13): this player fell out of profit
   * with hands_remaining of hands_required left. They owe nothing and may
   * leave; the count resumes there when they are back in profit.
   */
  paused: boolean;
}

/** The RPC's rows, typed; anything malformed is dropped, never shown half. */
export function parseClubHitRunRows(data: unknown): ClubHitRunRow[] | null {
  const payload = data as { rows?: unknown; paused_rows?: unknown } | null;
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.rows)) return null;
  const out: ClubHitRunRow[] = [];
  // Owing rows first, then the paused ones (absent from an older database).
  const all = [
    ...(payload.rows as Array<Record<string, unknown>>).map((raw) => ({ raw, paused: false })),
    ...(Array.isArray(payload.paused_rows)
      ? (payload.paused_rows as Array<Record<string, unknown>>).map((raw) => ({
          raw,
          paused: true,
        }))
      : []),
  ];
  for (const { raw, paused } of all) {
    const hands = Math.floor(Number(raw?.hands_remaining));
    if (typeof raw?.user_id !== 'string' || !(hands > 0)) continue;
    out.push({
      user_id: raw.user_id,
      username: typeof raw.username === 'string' && raw.username ? raw.username : 'Player',
      table_id: typeof raw.table_id === 'string' ? raw.table_id : '',
      table_name: typeof raw.table_name === 'string' ? raw.table_name : '',
      stakes: typeof raw.stakes === 'string' ? raw.stakes : '',
      hands_remaining: hands,
      hands_required: Math.max(hands, Math.floor(Number(raw.hands_required)) || hands),
      blind_off: !paused && raw.blind_off === true,
      paused,
    });
  }
  return out;
}

export default function ClubHitRunPanel({
  clubId,
  className,
}: {
  clubId: string | null;
  className?: string;
}): React.ReactElement | null {
  const [rows, setRows] = useState<ClubHitRunRow[] | null>(null);

  useEffect(() => {
    if (!clubId) {
      setRows(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try {
        const { data, error } = await supabase.rpc('ca_club_hit_run_status', {
          p_club_id: clubId,
        });
        if (cancelled) return;
        setRows(error ? null : parseClubHitRunRows(data));
      } catch {
        if (!cancelled) setRows(null);
      }
    };
    void load();
    const timer = setInterval(() => void load(), CLUB_HIT_RUN_REFRESH_MS);
    const onVisible = () => void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [clubId]);

  if (rows === null) return null;
  const blindedOff = rows.filter((r) => r.blind_off).length;
  const owing = rows.filter((r) => !r.paused).length;
  const pausedCount = rows.length - owing;

  return (
    <SpadeConsole
      eyebrow="Hand Count"
      title="Hands Owed Before Leaving"
      titleId="club-data-hit-run-title"
      pill={owing > 0 ? `${owing} Owing` : pausedCount > 0 ? `${pausedCount} Paused` : 'Clear'}
      pillInk={owing > 0 ? 'red' : 'green'}
      crest="flat"
      family="spade"
      foot="foot"
      className={className}
      aria-labelledby="club-data-hit-run-title"
      data-testid="club-hit-run-panel"
    >
      {rows.length === 0 ? (
        <p className={`sc-copy ${styles.empty}`}>No Player Owes Hands Right Now.</p>
      ) : (
        <>
          <p className={`sc-copy ${styles.summary}`}>
            A Player In Profit Plays The Club Hand Count Before Leaving, Plus The Same Again For
            Every Double Up.
            {blindedOff > 0 ? ` ${blindedOff} Being Blinded Off.` : ''}
            {pausedCount > 0
              ? ` ${pausedCount} Paused: Out Of Profit, Free To Leave, And The Count Resumes Where It Stopped When They Are Back In Profit.`
              : ''}
          </p>
          <ul className={styles.rows}>
            {rows.map((r) => (
              <li key={`${r.user_id}:${r.table_id}`} className={styles.row}>
                <span className={styles.who}>
                  <span className={`sc-ink--white ${styles.name}`}>{r.username}</span>
                  <span className={`sc-ink--muted ${styles.where}`}>
                    {[r.table_name, r.stakes].filter(Boolean).join(' ')}
                  </span>
                </span>
                <span className={styles.count}>
                  <span className={`sc-ink--white ${styles.hands}`}>
                    {r.hands_remaining} Of {r.hands_required}
                  </span>
                  <span
                    className={`${r.blind_off ? 'sc-ink--red' : 'sc-ink--muted'} ${styles.state}`}
                  >
                    {r.paused ? 'Paused' : r.blind_off ? 'Blinded Off' : 'Playing'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </SpadeConsole>
  );
}
