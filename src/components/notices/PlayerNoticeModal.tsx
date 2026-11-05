/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PLAYER NOTICE - a platform notice that must be read, closed only by OK
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan, 2026-11-04, after the tournament server update: "WHEN THEY LOGIN TO
 * KINGS CLUB, THEY SHOULD HAVE A NEW NOTIFICATION AS WELL THAT REQUIRES AN
 * "OK" TO CLOSE". The notice text lives in the database
 * (public.ca_player_notices, migration 20261105033238), so the next one needs
 * a row, not a release. fn_ca_pending_player_notice() hands the signed-in
 * player the one active notice they have not acknowledged; tapping OK calls
 * fn_ca_ack_player_notice(id), and the receipt row means it never shows that
 * player again on any device.
 *
 * It is a GATE on the prompt lane (src/lib/promptLane.ts): the daily bonus,
 * analytics and push asks wait behind it, and it waits behind the first-run
 * welcome and the profile gate, so a new player still meets things in order.
 * No overlay tap, no Escape, no X: the one way through is the OK plate.
 *
 * Portaled to <body> at the welcome's layer (9999) for the same reason the
 * welcome is: the bottom nav must not cover the plate.
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { reportError } from '../../utils/errorReporter';
import { SpadeConsole } from '../console/SpadeConsole';
import { useHoldPromptLane } from '../../lib/promptLane';
import styles from '../modals/ClubArenaWelcomeModal.module.css';

export interface PlayerNotice {
  id: string;
  slug: string;
  title: string;
  body: string;
  ok_label: string;
}

function normalizeNotice(raw: unknown): PlayerNotice | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.body !== 'string' || !r.body.trim()) return null;
  return {
    id: r.id,
    slug: typeof r.slug === 'string' ? r.slug : '',
    title: typeof r.title === 'string' && r.title.trim() ? r.title : 'Notice',
    body: r.body,
    ok_label: typeof r.ok_label === 'string' && r.ok_label.trim() ? r.ok_label : 'OK',
  };
}

export async function readPendingPlayerNotice(): Promise<PlayerNotice | null> {
  if (typeof supabase?.rpc !== 'function') return null;
  try {
    const { data, error } = await supabase.rpc('fn_ca_pending_player_notice');
    if (error) {
      reportError(error, 'PlayerNoticeModal.readPendingPlayerNotice');
      return null;
    }
    return normalizeNotice(data);
  } catch (err) {
    reportError(err, 'PlayerNoticeModal.readPendingPlayerNotice_exception');
    return null;
  }
}

/**
 * Loads the caller's pending notice once per signed-in session (and again on
 * every sign-in). `suspended` keeps it from reading while an earlier gate is up.
 */
export function usePendingPlayerNotice(userId: string | null | undefined, suspended = false) {
  const [notice, setNotice] = useState<PlayerNotice | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!userId || suspended) return undefined;
    let alive = true;
    void readPendingPlayerNotice().then((n) => {
      if (!alive) return;
      setNotice(n);
      setChecked(true);
    });
    return () => {
      alive = false;
    };
  }, [userId, suspended]);

  useEffect(() => {
    if (!userId) {
      setNotice(null);
      setChecked(false);
    }
  }, [userId]);

  const acknowledge = useCallback(async () => {
    const current = notice;
    setNotice(null);
    if (!current) return;
    try {
      const { error } = await supabase.rpc('fn_ca_ack_player_notice', { p_notice_id: current.id });
      if (error) reportError(error, 'PlayerNoticeModal.acknowledge');
    } catch (err) {
      reportError(err, 'PlayerNoticeModal.acknowledge_exception');
    }
  }, [notice]);

  return { notice, checked, acknowledge };
}

interface PlayerNoticeModalProps {
  notice: PlayerNotice | null;
  onAcknowledge: () => void;
}

export function PlayerNoticeModal({ notice, onAcknowledge }: PlayerNoticeModalProps) {
  const [mounted, setMounted] = useState(false);
  const isOpen = !!notice;

  useHoldPromptLane('notice', isOpen);

  useEffect(() => {
    if (!isOpen) {
      setMounted(false);
      return undefined;
    }
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, [isOpen]);

  if (!notice) return null;

  return createPortal(
    <div className={styles.overlay} data-testid="player-notice-overlay">
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-notice-title"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(8px)',
          transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        }}
      >
        <div className={styles.scroller}>
          <SpadeConsole
            as="div"
            className={styles.console}
            eyebrow="Midway Union"
            title={notice.title}
            titleId="player-notice-title"
            pill="Notice"
            pillInk="gold"
            foot="foot"
          >
            <p
              className={`sc-copy sc-copy--center ${styles.lead} sc-ink--silver`}
              data-testid="player-notice-body"
              style={{ padding: '3cqw 1cqw 3cqw', lineHeight: 1.6 }}
            >
              {notice.body}
            </p>
            <button
              type="button"
              className={`${styles.enter} sc-ink--white`}
              onClick={onAcknowledge}
              data-testid="player-notice-ok"
            >
              {notice.ok_label}
            </button>
          </SpadeConsole>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * What the app shell mounts. AppLayout loads this module lazily, so the modal,
 * its console art and its styles stay out of the entry chunk every player
 * downloads before first paint; the shell renders it only once the welcome
 * and profile gates are down.
 */
export default function PlayerNoticeGate({ userId }: { userId: string | null | undefined }) {
  const { notice, acknowledge } = usePendingPlayerNotice(userId, false);
  return <PlayerNoticeModal notice={notice} onAcknowledge={acknowledge} />;
}
