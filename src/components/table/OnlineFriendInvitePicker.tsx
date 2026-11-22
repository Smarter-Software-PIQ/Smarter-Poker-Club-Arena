/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ONLINE FRIEND INVITE PICKER - One-Tap In-App Table Invite Surface
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Reusable in two modes:
 *   - mode="modal"  : standalone native <dialog> hosting SpadeConsole (e.g. TablePage)
 *   - mode="inline" : embedded directly inside another surface (e.g. HeadsUpWaitingModal)
 *
 * Live online status comes solely from useProfilePresence (fn_profile_presence).
 * Online friends and clubmates sort to the top; one tap writes a real
 * `table_invite` notification and transitions cleanly to a cooldown-guarded
 * "Invited" state without ever faking success on DB failure.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthUser } from '../../hooks/useAuthUser';
import { useIsMounted } from '../../hooks/useIsMounted';
import { useProfilePresence } from '../../hooks/useProfilePresence';
import { playerDisplayName } from '../../utils/playerDisplayName';
import { PlayerAvatar } from '../avatars/PlayerAvatar';
import { SpadeConsole } from '../console/SpadeConsole';
import {
  buildTableInviteTargetKey,
  fetchInvitableContacts,
  getTableInviteCooldownRemainingMs,
  sendInAppTableInvite,
  type InvitableContact,
  type TableInviteKind,
} from '../../services/TableInviteService';
import './OnlineFriendInvitePicker.css';

export interface OnlineFriendInvitePickerProps {
  /** 'modal' renders inside a native <dialog>; 'inline' embeds directly in parent layout. */
  mode?: 'modal' | 'inline';
  /** Controls visibility when mode === 'modal' (default true). */
  isOpen?: boolean;
  /** Called when modal is dismissed via Close, Esc, or backdrop click. */
  onClose?: () => void;
  /** Current user ID (falls back to signed-in auth user if omitted). */
  senderUserId?: string | null;
  /** Current player display name (falls back to signed-in auth user if omitted). */
  senderName?: string | null;
  /** Target game type. */
  kind: TableInviteKind;
  /** Cash or seat-first table ID. */
  tableId?: string | null;
  /** Tournament ID when inviting to a tournament. */
  tournamentId?: string | null;
  /** Cluster ID for Lightning or clustered cash tables. */
  clusterId?: string | null;
  /** Optional club ID to include active clubmates alongside accepted friends. */
  clubId?: string | null;
  /** Display name of the table or event. */
  tableName: string;
  /** Optional invite code preserved in the deep link. */
  inviteCode?: string | null;
  /** Optional invite token preserved in the deep link (?i=). */
  inviteToken?: string | null;
  /** Optional fallback callback to switch to external link sharing. */
  onShareLink?: () => void;
  /** Optional callback fired after a confirmed in-app invite insert. */
  onInviteSent?: (contact: InvitableContact, actionUrl: string) => void;
}

interface EnrichedContact extends InvitableContact {
  isOnline: boolean;
}

function eyebrowForKind(kind: TableInviteKind): string {
  if (kind === 'lightning') return 'Lightning Invite';
  if (kind === 'tournament') return 'Tournament Invite';
  return 'Table Invite';
}

export function OnlineFriendInvitePicker({
  mode = 'modal',
  isOpen = true,
  onClose,
  senderUserId,
  senderName,
  kind,
  tableId,
  tournamentId,
  clusterId,
  clubId,
  tableName,
  inviteCode,
  inviteToken,
  onShareLink,
  onInviteSent,
}: OnlineFriendInvitePickerProps) {
  const { user } = useAuthUser();
  const isMounted = useIsMounted();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const effectiveSenderId = (senderUserId ?? user?.id ?? '').trim();
  const effectiveSenderName =
    (senderName ?? '').trim() || (user ? playerDisplayName(user) : 'A Friend');

  const isVisible = mode === 'inline' ? true : isOpen;
  const targetKey = useMemo(
    () => buildTableInviteTargetKey({ kind, tableId, tournamentId, clusterId }),
    [kind, tableId, tournamentId, clusterId]
  );

  const [contacts, setContacts] = useState<InvitableContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [sendingIds, setSendingIds] = useState<Set<string>>(() => new Set());
  const [invitedIds, setInvitedIds] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  // Sync native <dialog> visibility in modal mode.
  useEffect(() => {
    if (mode !== 'modal') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen) {
      if (!dialog.open && dialog.isConnected && typeof dialog.showModal === 'function') {
        try {
          dialog.showModal();
        } catch {
          /* ignore InvalidStateError if already open or detached */
        }
      }
    } else if (dialog.open && typeof dialog.close === 'function') {
      dialog.close();
    }
  }, [mode, isOpen]);

  // Listen for native <dialog> close (Esc, backdrop light dismiss, programmatic close).
  useEffect(() => {
    if (mode !== 'modal') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      dialog.returnValue = '';
      onCloseRef.current?.();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [mode]);

  // Progressive backdrop dismiss for browsers without closedby="any".
  useEffect(() => {
    if (mode !== 'modal') return;
    const dialog = dialogRef.current;
    if (!dialog || typeof HTMLDialogElement === 'undefined') return;
    if ('closedBy' in HTMLDialogElement.prototype) return;

    const outside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = outside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutside && outside(e) && dialog.open) {
        dialog.close();
      }
      pressedOutside = false;
    };
    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('pointerup', onPointerUp);
    return () => {
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('pointerup', onPointerUp);
    };
  }, [mode]);

  // Load accepted friends and optional clubmates whenever visible.
  useEffect(() => {
    if (!isVisible) return;
    if (!effectiveSenderId) {
      setContacts([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setActionError(null);

    fetchInvitableContacts(effectiveSenderId, clubId)
      .then((list) => {
        if (cancelled || !isMounted.current) return;
        setContacts(list);
        // Hydrate any contacts currently under an active invite cooldown.
        if (targetKey) {
          const alreadyInvited = new Set<string>();
          for (const c of list) {
            if (getTableInviteCooldownRemainingMs(c.userId, targetKey) > 0) {
              alreadyInvited.add(c.userId);
            }
          }
          setInvitedIds(alreadyInvited);
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled || !isMounted.current) return;
        setLoadError('Could Not Load Friends Right Now. Please Try Again.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isVisible, effectiveSenderId, clubId, targetKey, isMounted]);

  const contactIds = useMemo(
    () => (isVisible ? contacts.map((c) => c.userId) : []),
    [isVisible, contacts]
  );
  const livePresence = useProfilePresence(contactIds);

  const enrichedContacts = useMemo<EnrichedContact[]>(() => {
    return contacts
      .map((contact) => ({
        ...contact,
        isOnline: livePresence.get(contact.userId) === true,
      }))
      .sort((a, b) => {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        if (a.source !== b.source) return a.source === 'friend' ? -1 : 1;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [contacts, livePresence]);

  const onlineCount = useMemo(
    () => enrichedContacts.filter((c) => c.isOnline).length,
    [enrichedContacts]
  );

  const filteredContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedContacts.filter((contact) => {
      if (onlineOnly && !contact.isOnline) return false;
      if (!q) return true;
      return (
        contact.displayName.toLowerCase().includes(q) || contact.username.toLowerCase().includes(q)
      );
    });
  }, [enrichedContacts, onlineOnly, searchQuery]);

  const handleInvite = useCallback(
    async (contact: EnrichedContact) => {
      if (!effectiveSenderId) {
        setActionError('Sign In Required To Send Invites.');
        return;
      }
      if (sendingIds.has(contact.userId)) return;

      setActionError(null);
      setSendingIds((prev) => {
        const next = new Set(prev);
        next.add(contact.userId);
        return next;
      });

      try {
        const result = await sendInAppTableInvite({
          recipientUserId: contact.userId,
          senderUserId: effectiveSenderId,
          senderName: effectiveSenderName,
          kind,
          tableId,
          tournamentId,
          clusterId,
          tableName,
          inviteCode,
          inviteToken,
        });

        if (!isMounted.current) return;

        if (result.ok) {
          setInvitedIds((prev) => {
            const next = new Set(prev);
            next.add(contact.userId);
            return next;
          });
          onInviteSent?.(contact, result.actionUrl);
        } else if (result.reason === 'cooldown') {
          setInvitedIds((prev) => {
            const next = new Set(prev);
            next.add(contact.userId);
            return next;
          });
          setActionError(result.message);
        } else {
          setActionError(result.message);
        }
      } catch {
        if (isMounted.current) {
          setActionError('Could Not Send Invite Right Now. Please Try Again.');
        }
      } finally {
        if (isMounted.current) {
          setSendingIds((prev) => {
            const next = new Set(prev);
            next.delete(contact.userId);
            return next;
          });
        }
      }
    },
    [
      effectiveSenderId,
      effectiveSenderName,
      sendingIds,
      kind,
      tableId,
      tournamentId,
      clusterId,
      tableName,
      inviteCode,
      inviteToken,
      isMounted,
      onInviteSent,
    ]
  );

  const pickerBody = (
    <div
      className={`friend-invite-picker friend-invite-picker--${mode}`}
      data-testid="online-friend-invite-picker"
    >
      {mode === 'inline' && (
        <div className="friend-invite-picker__inline-header">
          <div className="friend-invite-picker__inline-title-group">
            <h3 className="friend-invite-picker__inline-title">Invite Online Friends</h3>
            <span className="friend-invite-picker__online-pill">
              <span
                className="friend-invite-picker__dot friend-invite-picker__dot--online"
                aria-hidden="true"
              />
              {onlineCount} Online
            </span>
          </div>
          {onShareLink && (
            <button type="button" className="friend-invite-picker__share-btn" onClick={onShareLink}>
              Share Link Instead
            </button>
          )}
        </div>
      )}

      <div className="friend-invite-picker__controls">
        <div className="friend-invite-picker__search-wrap">
          <svg
            className="friend-invite-picker__search-icon"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            className="friend-invite-picker__search"
            placeholder="Search Friends Or Clubmates..."
            aria-label="Search Friends Or Clubmates"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <button
          type="button"
          className={`friend-invite-picker__toggle ${onlineOnly ? 'friend-invite-picker__toggle--active' : ''}`}
          aria-pressed={onlineOnly}
          onClick={() => setOnlineOnly((prev) => !prev)}
        >
          Online Only
        </button>
      </div>

      {loadError && (
        <div className="friend-invite-picker__error" role="alert">
          {loadError}
        </div>
      )}

      {actionError && (
        <div className="friend-invite-picker__error" role="alert">
          {actionError}
        </div>
      )}

      <div className="friend-invite-picker__list" role="list" aria-label="Invitable Players">
        {loading ? (
          <div className="friend-invite-picker__state" role="status">
            Loading Players...
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="friend-invite-picker__state">
            {searchQuery.trim()
              ? 'No Players Match Your Search.'
              : onlineOnly
                ? 'No Friends Or Clubmates Are Online Right Now.'
                : 'No Friends Or Clubmates Found Yet.'}
          </div>
        ) : (
          filteredContacts.map((contact) => {
            const isSending = sendingIds.has(contact.userId);
            const isInvited =
              invitedIds.has(contact.userId) ||
              getTableInviteCooldownRemainingMs(contact.userId, targetKey) > 0;
            const roleLabel = contact.source === 'friend' ? 'Friend' : 'Clubmate';
            const statusText = contact.isOnline ? 'Online Now' : 'Offline';

            return (
              <div
                key={contact.userId}
                className="friend-invite-picker__row"
                role="listitem"
                data-user-id={contact.userId}
                data-online={contact.isOnline ? 'true' : 'false'}
              >
                <div className="friend-invite-picker__avatar-wrap">
                  <PlayerAvatar
                    src={contact.avatarUrl}
                    name={contact.displayName}
                    size="sm"
                    vipTier={contact.vipTier}
                    level={contact.level}
                    presenceStatus={contact.isOnline ? 'online' : 'offline'}
                    showPresence={true}
                    showLevelBadge={false}
                    showVipRing={!!contact.vipTier}
                  />
                </div>

                <div className="friend-invite-picker__meta">
                  <span className="friend-invite-picker__name">{contact.displayName}</span>
                  <span className="friend-invite-picker__sub">
                    <span
                      className={`friend-invite-picker__dot ${
                        contact.isOnline
                          ? 'friend-invite-picker__dot--online'
                          : 'friend-invite-picker__dot--offline'
                      }`}
                      aria-hidden="true"
                    />
                    <span>{statusText}</span>
                    <span className="friend-invite-picker__sep" aria-hidden="true">
                      /
                    </span>
                    <span>{roleLabel}</span>
                  </span>
                </div>

                <button
                  type="button"
                  className={`friend-invite-picker__invite-btn ${
                    isInvited ? 'friend-invite-picker__invite-btn--invited' : ''
                  }`}
                  disabled={isSending || isInvited}
                  aria-busy={isSending || undefined}
                  aria-label={
                    isInvited ? `${contact.displayName} Invited` : `Invite ${contact.displayName}`
                  }
                  onClick={() => void handleInvite(contact)}
                >
                  {isSending ? (
                    <>
                      <span className="friend-invite-picker__spinner" aria-hidden="true" />
                      <span>Sending...</span>
                    </>
                  ) : isInvited ? (
                    'Invited'
                  ) : (
                    'Invite'
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  if (mode === 'inline') {
    return pickerBody;
  }

  return (
    <dialog
      ref={dialogRef}
      className="friend-invite-dialog"
      aria-labelledby="friend-invite-dialog-title"
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      {isOpen && (
        <div className="friend-invite-dialog__shell">
          <SpadeConsole
            as="div"
            onClose={onClose}
            eyebrow={eyebrowForKind(kind)}
            title="Invite Online Friends"
            titleId="friend-invite-dialog-title"
            pill={`${onlineCount} Online`}
            pillInk="blue"
            plates={
              onShareLink
                ? {
                    secondary: {
                      label: 'Done',
                      onClick: () => onClose?.(),
                    },
                    primary: {
                      ink: 'white',
                      label: 'Share Link Instead',
                      onClick: onShareLink,
                    },
                  }
                : {
                    secondary: {
                      label: 'Done',
                      onClick: () => onClose?.(),
                    },
                  }
            }
          >
            <p className="friend-invite-dialog__caption">
              Send A Direct Table Notification For {tableName || 'This Table'}.
            </p>
            {pickerBody}
          </SpadeConsole>
        </div>
      )}
    </dialog>
  );
}

export default OnlineFriendInvitePicker;
