/** Club access exclusion controls. Route: /clubs/:clubId/blacklist */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import ClubIntegrityHeader from '../components/club/ClubIntegrityHeader';
import { ArenaState } from '../components/ops/ArenaOps';
import '../components/lobby/ArenaWorkspace.css';
import '../components/ops/ArenaOps.css';
import { useAuthUser } from '../hooks/useAuthUser';
import { supabase } from '../lib/supabase';
import type { BlacklistEntry } from '../types/club.types';
import { resolveClubUUID } from '../utils/clubIdResolver';
import { safeErrorMessage } from '../utils/safeErrorMessage';
import { adminRemovePlayerFromClubTables } from '../services/IntegrityActionService';
import { playerDisplayName, PLAYER_NAME_COLUMNS } from '../utils/playerDisplayName';
import styles from './BlacklistManagerPage.module.css';

interface MemberOption {
  user_id: string;
  display_name: string;
  status: string | null;
}

/** A seat this player still occupies in this club after being excluded. */
interface SeatedTable {
  table_id: string;
}

export default function BlacklistManagerPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { user } = useAuthUser();
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  /* THE FORM USED TO TAKE A RAW UUID, TYPED BY HAND, WITH NO VALIDATION AND NO
     WAY TO SEE WHO IT BELONGED TO. An exclusion is a decision about a person;
     it is now made by picking that person out of this club's own roster. */
  const [memberSearch, setMemberSearch] = useState('');
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberOption | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [seatedAfterExclusion, setSeatedAfterExclusion] = useState<{
    member: MemberOption;
    tables: SeatedTable[];
  } | null>(null);
  const [removingFromPlay, setRemovingFromPlay] = useState(false);
  const [removalStatus, setRemovalStatus] = useState<string | null>(null);
  const [clearingExpired, setClearingExpired] = useState(false);
  const [newUserId, setNewUserId] = useState('');
  const [newReason, setNewReason] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(null);

  const scopeKey = `${clubId || ''}:${user?.id || ''}`;
  const activeScopeRef = useRef(scopeKey);
  activeScopeRef.current = scopeKey;
  const readVersionRef = useRef(0);

  useEffect(() => {
    activeScopeRef.current = scopeKey;
    readVersionRef.current += 1;
    searchSeq.current += 1;
    setEntries([]);
    setNames({});
    setError(null);
    setLoadFailed(false);
    setLoading(true);
    resetForm();
    setSearchingMembers(false);
    setSeatedAfterExclusion(null);
    setRemovalStatus(null);
    setConfirmingRemoval(null);
    setAdding(false);
    setRemoving(null);
    setRemovingFromPlay(false);
    setClearingExpired(false);
    return () => {
      if (activeScopeRef.current === scopeKey) activeScopeRef.current = '';
      readVersionRef.current += 1;
      searchSeq.current += 1;
    };
  }, [scopeKey]);

  const loadEntries = useCallback(async () => {
    if (!clubId) {
      setLoading(false);
      return;
    }
    const requestScope = scopeKey;
    const requestId = ++readVersionRef.current;
    const isCurrent = () =>
      activeScopeRef.current === requestScope && readVersionRef.current === requestId;
    setLoading(true);
    setError(null);
    setLoadFailed(false);
    try {
      // Public club routes use slugs, while blacklists.club_id is a UUID.
      const resolvedClubId = await resolveClubUUID(clubId);
      const { data, error: fetchError } = await supabase
        .from('blacklists')
        .select('*')
        .eq('club_id', resolvedClubId)
        .order('banned_at', { ascending: false });
      if (!isCurrent()) return;
      if (fetchError) throw fetchError;
      setEntries(data || []);
    } catch (loadError) {
      if (!isCurrent()) return;
      setEntries([]);
      setLoadFailed(true);
      setError(safeErrorMessage(loadError, 'The exclusion list could not be loaded.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [clubId, scopeKey]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  /* The ledger printed a bare uuid in its first column, which is not a person.
     One batched read gives every excluded player their name. */
  useEffect(() => {
    const ids = [...new Set(entries.map((entry) => entry.user_id).filter(Boolean))];
    const missing = ids.filter((id) => !(id in names));
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data, error: nameError } = await supabase
        .from('profiles')
        .select(`id, ${PLAYER_NAME_COLUMNS}`)
        .in('id', missing);
      if (cancelled || nameError || !data) return;
      setNames((current) => {
        const next = { ...current };
        for (const row of data) next[row.id] = playerDisplayName(row);
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [entries, names]);

  /* Search this club's own roster. 300ms of quiet before asking, and the last
     answer wins, so a fast typist does not paint a stale list. */
  const searchSeq = useRef(0);
  useEffect(() => {
    if (!showAddForm || !clubId) return;
    const term = memberSearch.trim();
    if (term.length < 2) {
      setMemberOptions([]);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      void (async () => {
        setSearchingMembers(true);
        try {
          const resolvedClubId = await resolveClubUUID(clubId);
          // Identity only (2026-10-19): this picker shows a name, so it asks
          // for a name. The full roster reader carries balances it never shows.
          const { data, error: searchError } = await supabase.rpc('ca_club_member_search', {
            p_club_id: resolvedClubId,
            p_search: term,
            p_limit: 8,
          });
          if (seq !== searchSeq.current) return;
          if (searchError) throw searchError;
          setMemberOptions((data || []) as MemberOption[]);
        } catch (searchFailure) {
          if (seq !== searchSeq.current) return;
          setMemberOptions([]);
          setError(safeErrorMessage(searchFailure, 'The member search could not be completed.'));
        } finally {
          if (seq === searchSeq.current) setSearchingMembers(false);
        }
      })();
    }, 300);
    return () => {
      clearTimeout(timer);
      searchSeq.current += 1;
    };
  }, [clubId, memberSearch, showAddForm]);

  const expiredEntries = useMemo(
    () =>
      entries.filter(
        (entry) => Boolean(entry.expires_at) && new Date(entry.expires_at!) < new Date()
      ),
    [entries]
  );

  const resetForm = () => {
    setShowAddForm(false);
    setNewUserId('');
    setNewReason('');
    setNewExpiry('');
    setMemberSearch('');
    setMemberOptions([]);
    setSelectedMember(null);
  };

  /**
   * AN EXCLUSION DOES NOT EMPTY A SEAT. Every buy-in path checks the ledger, so
   * an excluded player cannot re-enter - but the one they are already sitting
   * in is untouched until they stand up. The operator was never told that.
   */
  const checkSeated = useCallback(async (member: MemberOption, resolvedClubId: string) => {
    const requestScope = activeScopeRef.current;
    const { data, error: seatError } = await supabase
      .from('table_seats')
      .select('table_id, tables!table_seats_table_id_fkey!inner(club_id, status)')
      .eq('user_id', member.user_id)
      .is('left_at', null)
      .eq('tables.club_id', resolvedClubId);
    if (activeScopeRef.current !== requestScope) return;
    if (seatError || !data || data.length === 0) return;
    const tables = [
      ...new Map(
        (data as SeatedTable[]).map((row) => [row.table_id, { table_id: row.table_id }])
      ).values(),
    ];
    setSeatedAfterExclusion({ member, tables });
  }, []);

  const removeFromPlay = async () => {
    if (!seatedAfterExclusion) return;
    const actionScope = scopeKey;
    const isCurrent = () => activeScopeRef.current === actionScope;
    setRemovingFromPlay(true);
    setRemovalStatus(null);
    setError(null);
    try {
      const outcome = await adminRemovePlayerFromClubTables(
        seatedAfterExclusion.tables.map((table) => table.table_id),
        seatedAfterExclusion.member.user_id,
        'Excluded from the club by an operator'
      );
      if (!isCurrent()) return;
      if (outcome.removed === 0 && !outcome.pending) {
        throw new Error(outcome.firstError || 'The engine did not remove this player.');
      }
      if (outcome.pending > 0 || outcome.failed > 0) {
        setRemovalStatus(
          `Removed From ${outcome.removed} Tables; ${outcome.pending} Pending Until Their Hands Finish; ${outcome.failed} Failed. ${outcome.firstError || ''}`.trim()
        );
      } else setSeatedAfterExclusion(null);
    } catch (removeError) {
      if (!isCurrent()) return;
      setError(safeErrorMessage(removeError, 'The player could not be removed from play.'));
    } finally {
      if (isCurrent()) setRemovingFromPlay(false);
    }
  };

  /**
   * Expired rows are honoured at the gate - every buy-in path checks
   * `expires_at` - but nothing has ever swept them, so they accumulate in the
   * ledger forever and the Active figure drifts away from the record. This is
   * the operator's broom.
   */
  const clearExpired = async () => {
    if (expiredEntries.length === 0) return;
    const actionScope = scopeKey;
    const isCurrent = () => activeScopeRef.current === actionScope;
    setClearingExpired(true);
    setError(null);
    try {
      const ids = expiredEntries.map((entry) => entry.id);
      /* `.select('id')` IS WHAT MAKES A REFUSAL VISIBLE. Under RLS a DELETE
         that matches no row returns 204 with `error` null, so this button
         reported nothing and appeared simply not to work. The row count is the
         only evidence the exclusions actually went. */
      const { data: cleared, error: deleteError } = await supabase
        .from('blacklists')
        .delete()
        .in('id', ids)
        .select('id');
      if (!isCurrent()) return;
      if (deleteError) throw deleteError;
      if (!cleared || cleared.length === 0) {
        throw new Error(
          'Those exclusions were not cleared - you may not have permission to remove them.'
        );
      }
      await loadEntries();
    } catch (clearError) {
      if (!isCurrent()) return;
      setError(safeErrorMessage(clearError, 'The expired exclusions could not be cleared.'));
    } finally {
      if (isCurrent()) setClearingExpired(false);
    }
  };

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!clubId || !user || !newUserId.trim() || !newReason.trim()) return;
    const actionScope = scopeKey;
    const isCurrent = () => activeScopeRef.current === actionScope;
    setAdding(true);
    setError(null);
    setLoadFailed(false);
    try {
      const resolvedClubId = await resolveClubUUID(clubId);
      if (!isCurrent()) return;
      const entry: Partial<BlacklistEntry> = {
        club_id: resolvedClubId,
        user_id: newUserId.trim(),
        reason: newReason.trim(),
        banned_by: user.id,
        banned_at: new Date().toISOString(),
      };
      if (newExpiry) entry.expires_at = new Date(newExpiry).toISOString();
      const { error: insertError } = await supabase.from('blacklists').insert(entry);
      if (!isCurrent()) return;
      if (insertError) throw insertError;
      const excluded = selectedMember;
      resetForm();
      await loadEntries();
      if (isCurrent() && excluded) await checkSeated(excluded, resolvedClubId);
    } catch (addError) {
      if (!isCurrent()) return;
      setError(safeErrorMessage(addError, 'The player could not be excluded.'));
    } finally {
      if (isCurrent()) setAdding(false);
    }
  };

  const handleRemove = async (entryId: string) => {
    const actionScope = scopeKey;
    const isCurrent = () => activeScopeRef.current === actionScope;
    setRemoving(entryId);
    setError(null);
    setLoadFailed(false);
    try {
      /* THE WORST SHAPE ON THIS PAGE, BEFORE THIS CHANGE. A DELETE with no
         `.select()` returns 204 and no error when RLS matches nothing, and the
         line below then removed the row from local state - so the exclusion
         disappeared from the operator's screen while the player stayed excluded
         in the database, and the optimistic filter replaced the read that would
         have corrected it. The returned row is now the proof. */
      const { data: removed, error: deleteError } = await supabase
        .from('blacklists')
        .delete()
        .eq('id', entryId)
        .select('id');
      if (!isCurrent()) return;
      if (deleteError) throw deleteError;
      if (!removed || removed.length === 0) {
        throw new Error('That exclusion was not removed - you may not have permission to lift it.');
      }
      setEntries((current) => current.filter((entry) => entry.id !== entryId));
      setConfirmingRemoval(null);
    } catch (removeError) {
      if (!isCurrent()) return;
      setError(safeErrorMessage(removeError, 'The exclusion could not be removed.'));
    } finally {
      if (isCurrent()) setRemoving(null);
    }
  };

  const isExpired = (entry: BlacklistEntry) =>
    Boolean(entry.expires_at && new Date(entry.expires_at) < new Date());
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const activeCount = entries.filter((entry) => !isExpired(entry)).length;
  const permanentCount = entries.filter((entry) => !entry.expires_at).length;

  return (
    <div className={`${styles.page} arena-workspace`}>
      <ClubIntegrityHeader
        clubId={clubId}
        active="blacklist"
        title="Club Exclusion Control"
        description="Apply Deliberate, Auditable Club-Access Exclusions With A Stated Reason And An Optional Expiry."
        metrics={[
          { label: 'Active', value: activeCount, tone: activeCount ? 'risk' : 'neutral' },
          { label: 'Permanent', value: permanentCount },
          { label: 'Total Records', value: entries.length },
        ]}
        action={
          <div className="arena-switch arena-ops-keys arena-ops-primary">
            <button type="button" onClick={() => setShowAddForm(true)}>
              Add Exclusion
            </button>
          </div>
        }
      />

      <main className={styles.workspace}>
        <div className={styles.workspaceHeading}>
          <div>
            <p className="arena-ops-eyebrow">Controlled Access Ledger</p>
            <h2 className="arena-section-title">Excluded Players</h2>
          </div>
          {clubId && (
            <div className="arena-switch">
              <Link to={`/clubs/${clubId}/operations`}>Return To Operations</Link>
            </div>
          )}
        </div>

        {error && (
          <ArenaState
            tone="error"
            title={loadFailed ? 'Exclusion Ledger Unavailable' : 'Control Action Incomplete'}
            message={error}
            actions={
              loadFailed ? (
                <button type="button" onClick={() => void loadEntries()}>
                  Retry
                </button>
              ) : (
                <button type="button" onClick={() => setError(null)}>
                  Dismiss
                </button>
              )
            }
          />
        )}

        {showAddForm && (
          <form className="arena-case arena-ops-case" onSubmit={handleAdd}>
            <div className={styles.panelHeader}>
              <div>
                <p className="arena-ops-eyebrow">New Control Record</p>
                <h2 className="arena-section-title">Exclude A Player</h2>
              </div>
              <span className={styles.required}>Reason Required</span>
            </div>
            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label htmlFor="blacklist-member-search">Player</label>
                {selectedMember ? (
                  <div className={`arena-ledger-row arena-ops-row ${styles.selectedMember}`}>
                    <span className="arena-ops-row__copy">
                      <strong>{selectedMember.display_name}</strong>
                    </span>
                    <div className="arena-switch">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMember(null);
                          setNewUserId('');
                          setMemberSearch('');
                        }}
                      >
                        Change
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <input
                      id="blacklist-member-search"
                      className="arena-ops-well"
                      autoComplete="off"
                      placeholder="Search This Club's Roster By Name"
                      value={memberSearch}
                      onChange={(event) => setMemberSearch(event.target.value)}
                      aria-describedby="blacklist-member-help"
                    />
                    <p id="blacklist-member-help" className="arena-ops-live">
                      {searchingMembers
                        ? 'Searching The Roster'
                        : memberSearch.trim().length < 2
                          ? 'Type At Least Two Characters'
                          : memberOptions.length === 0
                            ? 'No Member Of This Club Matches That Name'
                            : 'Choose The Player To Exclude'}
                    </p>
                    {memberOptions.length > 0 && (
                      <ul className="arena-ops-rows arena-ops-rows--single">
                        {memberOptions.map((option) => (
                          <li key={option.user_id}>
                            <button
                              type="button"
                              className={`arena-ledger-row arena-ops-row ${styles.optionRow}`}
                              onClick={() => {
                                setSelectedMember(option);
                                setNewUserId(option.user_id);
                                setMemberOptions([]);
                              }}
                            >
                              <span className="arena-ops-row__copy">
                                <strong>{option.display_name}</strong>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
              <div className={styles.field}>
                <label htmlFor="blacklist-reason">Reason</label>
                <input
                  id="blacklist-reason"
                  className="arena-ops-well"
                  placeholder="Document The Control Decision"
                  value={newReason}
                  onChange={(event) => setNewReason(event.target.value)}
                  required
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="blacklist-expiry">Expiry Date (Optional)</label>
                <input
                  id="blacklist-expiry"
                  className="arena-ops-well"
                  type="date"
                  value={newExpiry}
                  onChange={(event) => setNewExpiry(event.target.value)}
                />
              </div>
            </div>
            <div className="arena-switch arena-ops-keys arena-ops-primary">
              <button type="submit" disabled={adding || !selectedMember || !newReason.trim()}>
                {adding ? 'Applying Exclusion…' : 'Apply Exclusion'}
              </button>
              <button type="button" onClick={resetForm}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {seatedAfterExclusion && (
          <div className={`arena-case arena-ops-case ${styles.seatedPanel}`} role="alert">
            <div>
              <strong className={styles.seatedTitle}>
                {seatedAfterExclusion.member.display_name} Is Still Seated At{' '}
                {seatedAfterExclusion.tables.length} Table
                {seatedAfterExclusion.tables.length === 1 ? '' : 's'}
              </strong>
              <p className="arena-ops-copy">
                The Exclusion Stops Every Future Buy In, Rebuy And Tournament Entry. It Does Not
                Empty A Seat They Are Already In. Removing Them Now Cashes Their Stack Out To Their
                Club Wallet.
              </p>
            </div>
            {removalStatus && (
              <p className="arena-ops-live" role="status">
                {removalStatus}
              </p>
            )}
            <div className="arena-switch arena-ops-keys arena-ops-primary">
              <button
                type="button"
                onClick={() => void removeFromPlay()}
                disabled={removingFromPlay}
              >
                {removingFromPlay ? 'Removing From Play…' : 'Remove From Play'}
              </button>
              <button type="button" onClick={() => setSeatedAfterExclusion(null)}>
                Leave Them Seated
              </button>
            </div>
          </div>
        )}

        {!loadFailed && (
          <section className="arena-case arena-ops-case" aria-labelledby="blacklist-ledger-title">
            <div className={styles.panelHeader}>
              <div>
                <p className="arena-ops-eyebrow">Live Club Control</p>
                <h2 id="blacklist-ledger-title" className="arena-section-title">
                  Exclusion Ledger
                </h2>
              </div>
              <div className={styles.ledgerTools}>
                <span className={styles.total}>{entries.length} Total</span>
                {expiredEntries.length > 0 && (
                  <div className="arena-switch">
                    <button
                      type="button"
                      onClick={() => void clearExpired()}
                      disabled={clearingExpired}
                    >
                      {clearingExpired
                        ? 'Clearing Expired…'
                        : `Clear ${expiredEntries.length} Expired`}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {loading ? (
              <ArenaState tone="loading" title="Loading Exclusion Records…" />
            ) : entries.length === 0 ? (
              <ArenaState
                tone="empty"
                title="No Club Exclusions"
                message="Players With An Active Or Historical Exclusion Will Appear In This Ledger."
              />
            ) : (
              <ul
                className="arena-ops-rows arena-ops-rows--single"
                aria-label="Club Player Exclusion Records"
              >
                {entries.map((entry) => {
                  const expired = isExpired(entry);
                  const confirming = confirmingRemoval === entry.id;
                  return (
                    <li key={entry.id}>
                      <div className={`arena-ledger-row arena-ops-row ${styles.entryRow}`}>
                        <span className="arena-ops-row__copy">
                          <strong>
                            {names[entry.user_id] || 'Loading Name'}{' '}
                            <code className={styles.playerId}>{entry.user_id.substring(0, 8)}</code>
                          </strong>
                          <small>{entry.reason}</small>
                          <small>
                            Applied {formatDate(entry.banned_at)} · Expires{' '}
                            {entry.expires_at ? formatDate(entry.expires_at) : 'Permanent'}
                          </small>
                        </span>
                        <span
                          className="arena-ops-row__signal"
                          data-tone={expired ? 'attention' : 'danger'}
                        >
                          {expired ? 'Expired' : 'Active'}
                        </span>
                        {confirming ? (
                          <div className={`arena-switch arena-ops-primary ${styles.entryKeys}`}>
                            <button
                              type="button"
                              onClick={() => void handleRemove(entry.id)}
                              disabled={removing === entry.id}
                            >
                              {removing === entry.id ? 'Removing…' : 'Confirm'}
                            </button>
                            <button type="button" onClick={() => setConfirmingRemoval(null)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className={`arena-switch ${styles.entryKeys}`}>
                            <button type="button" onClick={() => setConfirmingRemoval(entry.id)}>
                              Remove Access Control
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
