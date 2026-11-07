/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CLUB SETTINGS - HAND COUNT BEFORE LEAVING (owner 2026-11-06)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The hit-and-run rule is on for every cash game by default: a player in
 * profit plays 10 hands before leaving, plus 10 more for each double up. A
 * club's owner, co-owner or admin can switch it off for the cash games the
 * club hosts, or choose 5, 10, 15 or 20 hands (the same number is added per
 * double). The database decides who may change it (fn_set_club_hit_run);
 * this panel only shows the answer. A new number applies to countdowns that
 * start after it is saved; switching it off clears every open countdown at
 * the club's tables at once.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../common/Toast';
import {
  HIT_RUN_HAND_CHOICES,
  parseClubHandCountSetting,
  clubHandCountRefusalText,
  type ClubHandCountSetting,
} from '../../lib/hitAndRun';

export default function ClubHandCountPanel({ clubId }: { clubId: string | null }) {
  const toast = useToast();
  const [setting, setSetting] = useState<ClubHandCountSetting | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSetting(null);
    if (!clubId) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('fn_club_hit_run_setting', {
          p_club_id: clubId,
        });
        if (!cancelled) setSetting(error ? null : parseClubHandCountSetting(data));
      } catch {
        if (!cancelled) setSetting(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clubId]);

  const save = useCallback(
    async (enabled: boolean, hands: number) => {
      if (!clubId || !setting || busy) return;
      setBusy(true);
      try {
        const { data, error } = await supabase.rpc('fn_set_club_hit_run', {
          p_club_id: clubId,
          p_enabled: enabled,
          p_hands: hands,
        });
        const res = (data ?? {}) as { ok?: boolean; reason?: string };
        if (error || res.ok !== true) {
          toast.error(clubHandCountRefusalText(error ? '' : String(res.reason ?? '')));
          return;
        }
        setSetting({ ...setting, enabled, hands });
        toast.success(
          enabled ? `Hand Count Is On: ${hands} Hands Before Leaving` : 'Hand Count Is Off'
        );
      } catch {
        toast.error(clubHandCountRefusalText(''));
      } finally {
        setBusy(false);
      }
    },
    [clubId, setting, busy, toast]
  );

  if (!clubId || !setting) return null;
  const canEdit = setting.canEdit && !busy;

  return (
    <section className="settings-section" data-testid="club-hand-count-panel">
      <h3 id="settings-hand-count">Hand Count Before Leaving</h3>
      <small className="form-hint" style={{ display: 'block', marginBottom: 10 }}>
        At Every Cash Game This Club Hosts, A Player In Profit Plays {setting.hands} Hands Before
        Leaving, Plus {setting.hands} More For Every Double Up. Leaving Early Blinds Them Off For
        The Hands Still Owed.
      </small>
      <div className="toggle-row">
        <div className="toggle-info">
          <span className="toggle-label">Hand Count</span>
          <span className="toggle-desc">
            {setting.enabled ? 'On For Every Cash Game This Club Hosts' : 'Off For This Club'}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={setting.enabled}
          aria-label="Hand Count"
          className={`toggle-btn ${setting.enabled ? 'on' : ''}`}
          onClick={() => void save(!setting.enabled, setting.hands)}
          disabled={!canEdit}
          data-testid="club-hand-count-switch"
        >
          {setting.enabled ? 'ON' : 'OFF'}
        </button>
      </div>
      <div className="toggle-row">
        <div className="toggle-info">
          <span className="toggle-label">Hands Before Leaving</span>
          <span className="toggle-desc">Also Added For Every Double Up</span>
        </div>
        <select
          aria-label="Hands Before Leaving"
          value={setting.hands}
          disabled={!canEdit || !setting.enabled}
          onChange={(e) => void save(setting.enabled, Number(e.target.value))}
          data-testid="club-hand-count-hands"
        >
          {HIT_RUN_HAND_CHOICES.map((n) => (
            <option key={n} value={n}>
              {n} Hands
            </option>
          ))}
        </select>
      </div>
      {!setting.canEdit && (
        <small className="form-hint">{clubHandCountRefusalText('not_a_club_admin')}</small>
      )}
    </section>
  );
}
