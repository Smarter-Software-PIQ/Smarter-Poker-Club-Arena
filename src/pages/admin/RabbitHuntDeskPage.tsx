/**
 * RABBIT HUNT CORRECTION DESK (2026-11-02).
 *
 * Platform staff give back what one rabbit hunt reveal consumed (a credit use
 * or one monthly VIP count) through fn_staff_correct_rabbit_hunt_charge, the
 * staff door to the same audited core the service correction uses: bound to
 * the reveal's own receipts, one correction per reveal, every correction
 * recorded under the staff member's name in an append-only audit. Diamond
 * charges are refused there. The player keeps the cards they saw.
 *
 * PlatformStaffGuard closes the route; the database checks staff again.
 */
import { useCallback, useState, type FormEvent } from 'react';
import PageBar from '../../components/help/PageBar';
import { confirmDialog } from '../../components/common/confirmDialog';
import { supabase } from '../../lib/supabase';
import '../AdminDashboardPage.css';

export interface DeskCharge {
  table_id: string;
  hand_number: number;
  charged_at: string;
  source: string | null;
  credit_source: string | null;
  consumed: boolean;
  correction: { id: string; correction: string; operator: string; at: string } | null;
}
export interface DeskCredit {
  id: string;
  source: string | null;
  uses_remaining: number | null;
  expires_at: string | null;
  created_at: string;
}
interface DeskLookup {
  found: boolean;
  player?: { id: string; username: string | null; player_number: number | null };
  charges?: DeskCharge[];
  credits?: DeskCredit[];
}

const SOURCE_LABEL: Record<string, string> = {
  lifetime_vip: 'Lifetime VIP Count',
  vip_monthly: 'Monthly VIP Count',
  purchased: 'Credit',
  diamonds: 'Diamonds',
};

/** Which charges the desk offers to correct, and with which credits. */
export function correctableCharge(c: DeskCharge): boolean {
  return (
    c.consumed &&
    !c.correction &&
    (c.source === 'purchased' || c.source === 'lifetime_vip' || c.source === 'vip_monthly')
  );
}
export function creditsFor(c: DeskCharge, credits: DeskCredit[], now = Date.now()): DeskCredit[] {
  if (c.source !== 'purchased') return [];
  const charged = Date.parse(c.charged_at);
  return credits.filter(
    (k) =>
      k.source === c.credit_source &&
      Date.parse(k.created_at) <= charged &&
      (k.expires_at === null ||
        (Date.parse(k.expires_at) > charged && Date.parse(k.expires_at) > now))
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export default function RabbitHuntDeskPage() {
  const [query, setQuery] = useState('');
  const [lookup, setLookup] = useState<DeskLookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [credit, setCredit] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async (player: string) => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: e } = await supabase.rpc('fn_staff_rabbit_hunt_receipts', {
        p_player: player,
      });
      if (e) throw e;
      setLookup((data ?? { found: false }) as DeskLookup);
    } catch {
      setError('Could Not Load That Player. Staff Only');
      setLookup(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const onSearch = (ev: FormEvent) => {
    ev.preventDefault();
    setNotice(null);
    setOpen(null);
    if (query.trim()) void load(query.trim());
  };

  const correct = async (c: DeskCharge) => {
    if (!lookup?.player) return;
    if (reason.trim().length < 20) {
      setError('Write A Reason Of At Least 20 Characters. It Is Kept In The Audit');
      return;
    }
    if (c.source === 'purchased' && !credit) {
      setError('Choose The Credit This Reveal Used');
      return;
    }
    const ok = await confirmDialog({
      title: 'Correct This Charge?',
      message: `Hand ${c.hand_number.toLocaleString()}: Give Back ${
        c.source === 'purchased' ? 'One Credit Use' : 'One Monthly VIP Count'
      }. It Is Recorded Under Your Name And Can Only Be Done Once.`,
      confirmText: 'Correct',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: e } = await supabase.rpc('fn_staff_correct_rabbit_hunt_charge', {
        p_user_id: lookup.player.id,
        p_table_id: c.table_id,
        p_hand_number: c.hand_number,
        p_credit_id: c.source === 'purchased' ? credit : null,
        p_reason: reason.trim(),
      });
      if (e) throw e;
      const r = (data ?? {}) as { ok?: boolean; replayed?: boolean; reason?: string };
      if (!r.ok) {
        setError(`Refused: ${String(r.reason ?? 'unknown').replace(/_/g, ' ')}`);
      } else {
        setNotice(r.replayed ? 'Already Corrected. Nothing Changed' : 'Corrected And Recorded');
        setOpen(null);
        setReason('');
        setCredit('');
        await load(lookup.player.id);
      }
    } catch {
      setError('The Correction Did Not Go Through');
    } finally {
      setBusy(false);
    }
  };

  const charges = lookup?.charges ?? [];
  const credits = lookup?.credits ?? [];

  return (
    <div className="admin-page">
      <div className="admin-container">
        <PageBar
          title="Rabbit Hunt Desk"
          summary="Give Back What One Rabbit Hunt Reveal Used. One Correction Per Reveal, Recorded Under Your Name."
          steps={[
            {
              title: 'Find A Player',
              body: 'Search By Username, Player Number Or Account Id.',
              target: '.rh-desk__search',
            },
          ]}
        />
        <form className="admin-card rh-desk__search" onSubmit={onSearch}>
          <label className="admin-label">
            Player
            <input
              className="admin-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Username, Player Number Or Id"
              aria-label="Player"
            />
          </label>
          <button className="admin-btn admin-btn-primary" disabled={busy || !query.trim()}>
            Find
          </button>
        </form>
        {error ? (
          <div className="admin-error-banner" role="alert">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="admin-success-banner" role="status">
            {notice}
          </div>
        ) : null}
        {lookup && !lookup.found ? <div className="admin-empty-state">No Player Found</div> : null}
        {lookup?.found && lookup.player ? (
          <div className="admin-card">
            <h2 className="admin-section-title">
              {lookup.player.username ?? 'Player'}
              {lookup.player.player_number ? ` · #${lookup.player.player_number}` : ''}
            </h2>
            {charges.length === 0 ? (
              <div className="admin-empty-state">No Rabbit Hunt Charges</div>
            ) : null}
            {charges.map((c) => {
              const key = `${c.table_id}:${c.hand_number}`;
              const options = creditsFor(c, credits);
              return (
                <div key={key} className="admin-panel-soft" data-testid="rh-charge">
                  <div>
                    Hand {c.hand_number.toLocaleString()} · {when(c.charged_at)} ·{' '}
                    {SOURCE_LABEL[c.source ?? ''] ?? c.source ?? 'Unknown'}
                    {c.credit_source ? ` (${c.credit_source.replace(/_/g, ' ')})` : ''}
                  </div>
                  {c.correction ? (
                    <div className="admin-text-secondary">
                      Corrected {when(c.correction.at)} By {c.correction.operator}
                    </div>
                  ) : !correctableCharge(c) ? (
                    <div className="admin-text-secondary">
                      {c.source === 'diamonds'
                        ? 'Diamond Charges Are Refunded Through The Diamond Desk'
                        : 'Nothing To Correct'}
                    </div>
                  ) : open === key ? (
                    <div className="rh-desk__form">
                      {c.source === 'purchased' ? (
                        <label className="admin-label">
                          Credit Used
                          <select
                            className="admin-input"
                            value={credit}
                            onChange={(e) => setCredit(e.target.value)}
                          >
                            <option value="">Choose</option>
                            {options.map((k) => (
                              <option key={k.id} value={k.id}>
                                {(k.source ?? 'credit').replace(/_/g, ' ')} ·{' '}
                                {k.uses_remaining ?? 0} Left
                                {k.expires_at ? ` · Expires ${when(k.expires_at)}` : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <label className="admin-label">
                        Reason (Kept In The Audit)
                        <textarea
                          className="admin-input"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          minLength={20}
                          rows={2}
                        />
                      </label>
                      <button
                        type="button"
                        className="admin-btn admin-btn-primary admin-btn-sm"
                        disabled={busy}
                        onClick={() => void correct(c)}
                      >
                        Correct This Charge
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="admin-btn admin-btn-ghost admin-btn-sm"
                      onClick={() => {
                        setOpen(key);
                        setCredit(options.length === 1 ? options[0].id : '');
                        setError(null);
                      }}
                    >
                      Correct
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
