/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CLUB ENGINE — Create Union Page
 * Multi-club network creation wizard
 *
 * #SmarterDesign (batch U1, 2026-11-28): the arena workspace. The chrome mast
 * heads the wizard with its live line under it; the steps are chrome tiles
 * (the open step lit), each step a chrome case with its fields in dark wells
 * and its switches on chrome rows, the review on readout tiles, and the
 * navigation chrome keys with the forward action lit. Every printed word and
 * control is pinned by tests/components/createUnionPageIsPinned.test.tsx.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './CreateUnionPage.css';
import { supabase } from '../lib/supabase';
import { unionApi } from '../services/UnionApiService';
import { useAuthUser } from '../hooks/useAuthUser';
import { useToast } from '../components/common/Toast';
import { masterBus } from '../core/MasterBus';
import { sanitizeInput } from '../utils/sanitizeInput';
import { reportError } from '../utils/errorReporter';

import { safeErrorMessage } from '../utils/safeErrorMessage';
import ArenaWorkspaceHeader from '../components/lobby/ArenaWorkspaceHeader';
import PageBar from '../components/help/PageBar';
import { formatPopupText } from '../utils/popupStyle';

const FORGE_SUMMARY =
  'Configure A Governed Club Network, Revenue Rules, And Shared Features Through The Existing Server-Authorized Creation Workflow.';

function ForgeMast() {
  return (
    <ArenaWorkspaceHeader
      area="settings"
      title="Forge A Union"
      context="Union Network"
      summary={FORGE_SUMMARY}
    />
  );
}
// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface UnionFormData {
  name: string;
  description: string;
  isPublic: boolean;

  // Revenue sharing
  revenueSharePercent: number;
  sharedPlayerPool: boolean;
  crossClubTournaments: boolean;

  // Settlement
  settlementDay: 'sunday' | 'monday' | 'friday';
  gracePeriodDays: number;
}

const DEFAULT_FORM: UnionFormData = {
  name: '',
  description: '',
  isPublic: true,

  revenueSharePercent: 10,
  sharedPlayerPool: true,
  crossClubTournaments: true,

  settlementDay: 'sunday',
  gracePeriodDays: 3,
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function CreateUnionPage() {
  const navigate = useNavigate();
  const { user } = useAuthUser();
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<UnionFormData>(DEFAULT_FORM);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingClubs, setCheckingClubs] = useState(true);
  const [ownsClub, setOwnsClub] = useState(false);
  const [stepVisible, setStepVisible] = useState(false);

  const totalSteps = 3;

  // Section entrance animation
  useEffect(() => {
    setStepVisible(false);
    const timer = setTimeout(() => setStepVisible(true), 50);
    return () => clearTimeout(timer);
  }, [step]);

  // Check if user owns any clubs (required to create union)
  useEffect(() => {
    let isMounted = true;
    const checkClubOwnership = async () => {
      try {
        const { count } = await supabase
          .from('clubs')
          .select('id', { count: 'exact', head: true })
          .eq('owner_id', user?.id);

        if (isMounted) setOwnsClub((count || 0) > 0);
      } catch (e) {
        reportError(e, 'CreateUnionPage.Failed_to_check_club_ownership');
        if (isMounted) {
          toast.error('Failed to verify club ownership');
          setOwnsClub(false);
        }
      } finally {
        if (isMounted) setCheckingClubs(false);
      }
    };

    checkClubOwnership();
    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  // Show "create club first" message if user doesn't own a club
  if (!checkingClubs && !ownsClub) {
    return (
      <div className="create-union arena-workspace">
        <ForgeMast />
        <div className="create-union__body">
          <section className="arena-case arena-ops-case create-union__case">
            <h2 className="arena-section-title">Create A Club First</h2>
            <p className="arena-ops-copy">
              You Need To Own At Least One Club Before You Can Create A Union.
            </p>
            <div className="arena-switch arena-ops-keys arena-ops-primary">
              <button onClick={() => navigate('/?create=club')}>Create Your First Club</button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  const updateForm = (updates: Partial<UnionFormData>) => {
    setForm((prev) => ({ ...prev, ...updates }));
    setError(null);
  };

  const validateStep = (): boolean => {
    switch (step) {
      case 1:
        if (!form.name.trim()) {
          setError('Union Name Is Required');
          return false;
        }
        if (form.name.length < 3) {
          setError('Union Name Must Be At Least 3 Characters');
          return false;
        }
        break;
    }
    return true;
  };

  const handleNext = () => {
    if (!validateStep()) return;
    if (step < totalSteps) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleCreate = async () => {
    if (!validateStep()) return;

    setCreating(true);
    setError(null);

    try {
      // UNION AUDIT FIX 2026-07-21: unions is service-role-write-only under RLS,
      // so the old direct insert silently failed for browser users. Create via
      // the World Hub manage-union API (server-side sanitization + admin/wallet/
      // BBJ-pool provisioning; creator identity comes from the bearer token).
      const result = await unionApi.createUnion(
        sanitizeInput(form.name.trim()),
        form.description.trim() ? sanitizeInput(form.description.trim()) : '',
        {
          revenue_share_percent: form.revenueSharePercent,
          shared_player_pool: form.sharedPlayerPool,
          cross_club_tournaments: form.crossClubTournaments,
          settlement_day: form.settlementDay,
          grace_period_days: form.gracePeriodDays,
        }
      );
      const data = result.union as { id: string; slug?: string } | undefined;
      if (!data) throw new Error('Union creation returned no data');

      masterBus.emit('UNION_UPDATED', { unionId: data.id });
      navigate(`/unions/${data.slug || data.id}`);
    } catch (err: any) {
      reportError(err, 'CreateUnionPage.Failed_to_create_union');
      setError(safeErrorMessage(err, 'Failed to create union'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="create-union arena-workspace">
      <ForgeMast />
      <PageBar
        titleAs={false}
        showHelp={false}
        title="Forge A Union"
        status={formatPopupText('SECURE')}
        statusTone="default"
        metrics={[
          { label: 'Step', value: `${step} / ${totalSteps}`, tone: 'attention' },
          { label: 'Club Authority', value: ownsClub ? 'Verified' : 'Checking', tone: 'live' },
        ]}
      />
      <div className="create-union__body">
        {/* Progress */}
        <div className="create-union__steps">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`create-union__step arena-meter${s === step ? ' create-union__step--open' : ''}${
                s < step ? ' create-union__step--done' : ''
              }`}
            >
              <span className="create-union__step-dot">{s < step ? '' : s}</span>
              <span className="create-union__step-label">
                {s === 1 && 'Basics'}
                {s === 2 && 'Revenue'}
                {s === 3 && 'Review'}
              </span>
            </div>
          ))}
        </div>
        <div className="create-union__track">
          <div
            className="create-union__track-fill"
            style={{ width: `${((step - 1) / (totalSteps - 1)) * 100}%` }}
          />
        </div>

        {/* Step Content */}
        <div
          className="create-union__stage"
          style={{
            opacity: stepVisible ? 1 : 0,
            transform: stepVisible ? 'translateY(0)' : 'translateY(12px)',
            transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
          }}
        >
          {step === 1 && (
            <div className="arena-case arena-ops-case create-union__case">
              <h2 className="arena-section-title"> Union Basics</h2>
              <p className="arena-ops-copy">Create A Network Of Clubs With Shared Resources.</p>

              <div className="create-union__field">
                <label>Union Name *</label>
                <input
                  type="text"
                  className="arena-ops-well create-union__input"
                  placeholder="Enter Union Name..."
                  value={form.name}
                  onChange={(e) => updateForm({ name: e.target.value })}
                  maxLength={50}
                />
              </div>

              <div className="create-union__field">
                <label>Description</label>
                <textarea
                  className="arena-ops-well create-union__input"
                  placeholder="Describe Your Union..."
                  value={form.description}
                  onChange={(e) => updateForm({ description: e.target.value })}
                  rows={4}
                  maxLength={500}
                />
              </div>

              <label className="arena-ledger-row create-union__switch">
                <input
                  type="checkbox"
                  checked={form.isPublic}
                  onChange={(e) => updateForm({ isPublic: e.target.checked })}
                />
                <span className="create-union__mark" aria-hidden="true" />
                <div>
                  <strong>Public Union</strong>
                  <p>Other Clubs Can Discover And Request To Join</p>
                </div>
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="arena-case arena-ops-case create-union__case">
              <h2 className="arena-section-title"> Revenue & Features</h2>
              <p className="arena-ops-copy">Configure Profit Sharing And Shared Features.</p>

              <div className="create-union__grid">
                <div className="create-union__field">
                  <label>Union Revenue Share</label>
                  <div className="create-union__unit">
                    <input
                      type="number"
                      className="arena-ops-well create-union__input"
                      value={form.revenueSharePercent}
                      onChange={(e) => updateForm({ revenueSharePercent: Number(e.target.value) })}
                      min={0}
                      max={50}
                    />
                    <span>%</span>
                  </div>
                  <span className="create-union__hint">% Of Club Rake To Union</span>
                </div>

                <div className="create-union__field">
                  <label>Settlement Day</label>
                  <select
                    className="arena-ops-well create-union__input"
                    value={form.settlementDay}
                    onChange={(e) =>
                      updateForm({
                        settlementDay: e.target.value as UnionFormData['settlementDay'],
                      })
                    }
                  >
                    <option value="sunday">Sunday</option>
                    <option value="monday">Monday</option>
                    <option value="friday">Friday</option>
                  </select>
                </div>

                <div className="create-union__field">
                  <label>Grace Period</label>
                  <div className="create-union__unit">
                    <input
                      type="number"
                      className="arena-ops-well create-union__input"
                      value={form.gracePeriodDays}
                      onChange={(e) => updateForm({ gracePeriodDays: Number(e.target.value) })}
                      min={1}
                      max={7}
                    />
                    <span>Days</span>
                  </div>
                </div>
              </div>

              <div className="create-union__switches">
                <label className="arena-ledger-row create-union__switch">
                  <input
                    type="checkbox"
                    checked={form.sharedPlayerPool}
                    onChange={(e) => updateForm({ sharedPlayerPool: e.target.checked })}
                  />
                  <span className="create-union__mark" aria-hidden="true" />
                  <div>
                    <strong>Shared Player Pool</strong>
                    <p>Players Can Move Between Clubs In The Union</p>
                  </div>
                </label>

                <label className="arena-ledger-row create-union__switch">
                  <input
                    type="checkbox"
                    checked={form.crossClubTournaments}
                    onChange={(e) => updateForm({ crossClubTournaments: e.target.checked })}
                  />
                  <span className="create-union__mark" aria-hidden="true" />
                  <div>
                    <strong>Cross-Club Tournaments</strong>
                    <p>Host Tournaments Across All Member Clubs</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="arena-case arena-ops-case create-union__case">
              <h2 className="arena-section-title"> Review & Create</h2>
              <p className="arena-ops-copy">Review Your Union Settings Before Creating.</p>

              <div className="create-union__preview">
                <div className="create-union__preview-head">
                  <div className="create-union__avatar">
                    {form.name.charAt(0).toUpperCase() || '?'}
                  </div>
                  <div>
                    <h3>{form.name || 'Unnamed Union'}</h3>
                    <p>{form.isPublic ? ' Public Union' : ' Private Union'}</p>
                  </div>
                </div>

                {form.description && <p className="arena-ops-copy">{form.description}</p>}

                <div className="create-union__readings">
                  <div className="arena-meter">
                    <strong>{form.revenueSharePercent}%</strong>
                    <span>Revenue Share</span>
                  </div>
                  <div className="arena-meter">
                    <strong>{form.settlementDay}</strong>
                    <span>Settlement</span>
                  </div>
                  <div className="arena-meter">
                    <strong>{form.gracePeriodDays} Days</strong>
                    <span>Grace Period</span>
                  </div>
                </div>

                <div className="create-union__tags">
                  {form.sharedPlayerPool && <span> Shared Players</span>}
                  {form.crossClubTournaments && <span> Cross-Club MTTs</span>}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && <div className="create-union__error">{error}</div>}

        {/* Navigation */}
        <div className="arena-switch arena-ops-keys create-union__nav">
          {step > 1 && <button onClick={handleBack}>← Previous</button>}
          {step < totalSteps ? (
            <button className="create-union__forward" onClick={handleNext}>
              Next →
            </button>
          ) : (
            <button className="create-union__forward" onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating...' : ' Create Union'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
