/**
 *  REPORT PLAYER PAGE - on the arena workspace (#SmarterDesign, batch P7)
 *
 *  One flow, one chrome case: reason buttons in a chrome switch lit by
 *  aria-pressed, description and hand ID in dark search-well fields, chat-log
 *  toggle on a chrome ledger row, and Cancel / Submit Report on a chrome
 *  switch with Submit Report lit. Every handler, guard, ARIA role and string
 *  is unchanged (tests/components/reportPlayerPageIsPinned.test.tsx).
 */

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthUser } from '../hooks/useAuthUser';
import { sanitizeInput } from '../utils/sanitizeInput';
import ArenaWorkspaceHeader from '../components/lobby/ArenaWorkspaceHeader';
import '../components/ops/ArenaOps.css';
import './ReportPlayerPage.css';
import { reportError } from '../utils/errorReporter';
import { safeErrorMessage } from '../utils/safeErrorMessage';

type ReportReason = 'collusion' | 'abuse' | 'cheating' | 'harassment' | 'other';

interface ReportForm {
  reason: ReportReason;
  description: string;
  hand_id?: string;
  include_chat_logs: boolean;
}

export default function ReportPlayerPage() {
  const navigate = useNavigate();
  const { playerId } = useParams();
  const { user } = useAuthUser();

  const [form, setForm] = useState<ReportForm>({
    reason: 'abuse',
    description: '',
    include_chat_logs: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!form.description.trim()) {
      setError('Please Describe The Issue');
      return;
    }
    if (!playerId || !user?.id) return;

    setSubmitting(true);
    setError(null);
    try {
      // Canonical table is user_reports (reporter_id, reported_user_id, reason, details,
      // status). hand_id + chat-log preference are folded into the details text since
      // user_reports has no dedicated columns for them.
      const detailParts = [sanitizeInput(form.description)];
      if (form.hand_id) detailParts.push(`Hand: ${sanitizeInput(form.hand_id)}`);
      if (form.include_chat_logs) detailParts.push('(reporter requested chat logs be reviewed)');
      const { error: submitError } = await supabase.from('user_reports').insert({
        reporter_id: user.id,
        reported_user_id: playerId,
        reason: form.reason,
        details: detailParts.join('\n'),
        status: 'pending',
      });

      if (submitError) throw submitError;
      setSubmitted(true);
    } catch (err: any) {
      reportError(err, 'ReportPlayerPage.Failed_to_submit_report');
      setError(safeErrorMessage(err, 'Failed to submit report'));
    }
    setSubmitting(false);
  };

  const reasonOptions: { value: ReportReason; label: string }[] = [
    { value: 'collusion', label: 'Collusion' },
    { value: 'cheating', label: 'Cheating' },
    { value: 'abuse', label: 'Abusive Behavior' },
    { value: 'harassment', label: 'Harassment' },
    { value: 'other', label: 'Other' },
  ];

  if (submitted) {
    return (
      <main className="report-page arena-workspace">
        <ArenaWorkspaceHeader
          area="reports"
          title="Report Submitted"
          context="Player Safety"
          summary="Your Private Player Safety Report Has Been Filed For Review By Our Safety Team."
        />
        <section
          className="arena-case arena-ops-case report-page__case"
          aria-labelledby="report-player-title"
        >
          <p className="arena-ops-eyebrow">Player Safety</p>
          <h2 id="report-player-title" className="arena-section-title">
            Report Submitted
            <small className="report-page__pill report-page__pill--sent">Sent</small>
          </h2>
          <p className="report-page__success-body">
            Thank You For Helping Keep Our Community Safe. Our Team Will Review Your Report Within
            24 Hours.
          </p>
          <div className="arena-switch arena-ops-primary report-page__actions">
            <button type="button" onClick={() => navigate(-1)}>
              Go Back
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="report-page arena-workspace">
      <ArenaWorkspaceHeader
        area="reports"
        title="Report Player"
        context="Player Safety"
        summary="File A Private Player Safety Report With Reason, Details, Optional Hand ID, And Chat Log Review Preference."
      />
      <section
        className="arena-case arena-ops-case report-page__case"
        aria-labelledby="report-player-title"
      >
        <p className="arena-ops-eyebrow">Player Safety</p>
        <h2 id="report-player-title" className="arena-section-title">
          Report Player
          <small className="report-page__pill">Private</small>
        </h2>

        {error && (
          <p className="report-page__error" role="alert">
            {error}
          </p>
        )}

        <p className="report-page__warning">
          False Reports May Result In Account Suspension. Please Only Report Genuine Violations.
        </p>

        <div className="report-page__section">
          <h3 className="report-page__label">Reason For Report</h3>
          <div
            className="arena-switch arena-ops-keys report-page__reasons"
            role="group"
            aria-label="Reason For Report"
          >
            {reasonOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={form.reason === opt.value}
                onClick={() => setForm((prev) => ({ ...prev, reason: opt.value }))}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="report-page__section">
          <h3 className="report-page__label">
            <label htmlFor="report-description">Description</label>
          </h3>
          <textarea
            id="report-description"
            className="report-page__field report-page__field--area"
            placeholder="Please Describe What Happened In Detail..."
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            rows={5}
          />
        </div>

        <div className="report-page__section">
          <h3 className="report-page__label">
            <label htmlFor="report-hand-id">Hand ID (Optional)</label>
          </h3>
          <input
            id="report-hand-id"
            type="text"
            className="report-page__field"
            placeholder="Enter Hand ID If Applicable..."
            value={form.hand_id || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, hand_id: e.target.value }))}
          />
        </div>

        <div className="arena-ledger-row report-page__check-row">
          <input
            type="checkbox"
            id="include-chat"
            className="report-page__check"
            checked={form.include_chat_logs}
            onChange={(e) => setForm((prev) => ({ ...prev, include_chat_logs: e.target.checked }))}
          />
          <label htmlFor="include-chat" className="report-page__check-label">
            Include Recent Chat Logs With This Player
          </label>
        </div>

        <div className="arena-switch arena-ops-primary report-page__actions">
          <button
            type="button"
            className="report-page__submit"
            onClick={handleSubmit}
            disabled={submitting || !form.description.trim()}
          >
            {submitting ? 'Submitting...' : 'Submit Report'}
          </button>
          <button type="button" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
      </section>
    </main>
  );
}
