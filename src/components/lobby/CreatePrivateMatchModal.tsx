/**
 * CREATE PRIVATE HEADS-UP MATCH / PRIVATE SPIN MODAL (2026-11-23)
 *
 * Players pick ONLY Game, Stakes (Buy-In), and Starting Chips from the club /
 * union's currently offered boards. Blind levels, rake, payout shape, and all
 * other structure rules come automatically from the matched offered board.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { SpadeConsole } from '../console/SpadeConsole';
import {
  createPrivateSeatFirstMatch,
  offeredGamesFor,
  offeredStacksFor,
  offeredStakesFor,
  resolveOfferedTemplate,
  stackBandLabel,
  type OfferedPrivateTemplate,
  type PrivateMatchFormat,
} from '../../lib/privateSeatFirstMatch';
import { privateGameRefusalText, type PrivateGameHold } from '../../lib/privateGameInvite';
import '../table/HeadsUpWaitingModal.css';
import './CreatePrivateMatchModal.css';

export interface CreatePrivateMatchModalProps {
  isOpen: boolean;
  format: PrivateMatchFormat;
  templates: readonly OfferedPrivateTemplate[];
  onCreated: (hold: PrivateGameHold) => void;
  onClose: () => void;
}

export function CreatePrivateMatchModal({
  isOpen,
  format,
  templates,
  onCreated,
  onClose,
}: CreatePrivateMatchModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const games = useMemo(() => offeredGamesFor(templates), [templates]);
  const [selectedGame, setSelectedGame] = useState<string>(() => games[0]?.gameType ?? '');

  useEffect(() => {
    if (!games.some((g) => g.gameType === selectedGame)) {
      setSelectedGame(games[0]?.gameType ?? '');
    }
  }, [games, selectedGame]);

  const stakes = useMemo(
    () => offeredStakesFor(templates, selectedGame),
    [templates, selectedGame]
  );
  const [selectedStake, setSelectedStake] = useState<number>(() => stakes[0] ?? 0);

  useEffect(() => {
    if (!stakes.includes(selectedStake)) {
      setSelectedStake(stakes[0] ?? 0);
    }
  }, [stakes, selectedStake]);

  const stacks = useMemo(
    () => offeredStacksFor(templates, selectedGame, selectedStake),
    [templates, selectedGame, selectedStake]
  );
  const [selectedStack, setSelectedStack] = useState<number>(() => stacks[0] ?? 0);

  useEffect(() => {
    if (!stacks.includes(selectedStack)) {
      setSelectedStack(stacks[0] ?? 0);
    }
  }, [stacks, selectedStack]);

  const matched = useMemo(
    () => resolveOfferedTemplate(templates, selectedGame, selectedStake, selectedStack),
    [templates, selectedGame, selectedStake, selectedStack]
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) setError(null);
  }, [isOpen, format]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen) {
      if (!dialog.open && dialog.isConnected && typeof dialog.showModal === 'function') {
        try {
          dialog.showModal();
        } catch {
          // Dialog already open or detached mid-transition.
        }
      }
    } else if (dialog.open && typeof dialog.close === 'function') {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onCloseRef.current();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, []);

  const handleCreate = async () => {
    if (!matched || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createPrivateSeatFirstMatch(matched.id);
      if (!res.ok || !res.hold) {
        setError(privateGameRefusalText(res.reason));
        return;
      }
      onCreated(res.hold);
    } catch {
      setError(privateGameRefusalText(undefined));
    } finally {
      setBusy(false);
    }
  };

  const title = format === 'spin' ? 'Create Private Spin' : 'Create Private Heads-Up Match';
  const eyebrow = format === 'spin' ? 'Private Spin (3-Max)' : 'Private Heads-Up (2-Max)';

  return (
    <dialog
      ref={dialogRef}
      className="hu-waiting-dialog"
      aria-labelledby="private-create-title"
      data-testid="create-private-match-modal"
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      {isOpen && (
        <div className="hu-waiting-dialog__shell">
          <SpadeConsole
            as="div"
            onClose={() => {
              if (!busy) onClose();
            }}
            eyebrow={eyebrow}
            title={title}
            titleId="private-create-title"
            pill="Invite Link Only"
            pillInk="gold"
            plates={{
              secondary: {
                label: 'Cancel',
                disabled: busy,
                onClick: () => {
                  if (!busy) onClose();
                },
              },
              primary: {
                ink: 'white',
                label: busy
                  ? 'Creating...'
                  : matched
                    ? `Create & Buy In (${matched.totalBuyIn.toLocaleString()})`
                    : 'Create & Buy In',
                disabled: busy || !matched,
                onClick: () => void handleCreate(),
              },
            }}
          >
            {templates.length === 0 ? (
              <p className="hu-waiting-dialog__prompt">
                No Offered Games Are Currently Available For This Format.
              </p>
            ) : (
              <>
                <div className="private-create-modal__section">
                  <span className="private-create-modal__label">Game</span>
                  <div
                    className="private-create-modal__choices"
                    role="group"
                    aria-label="Choose Offered Game"
                    data-testid="private-game-choices"
                  >
                    {games.map((g) => (
                      <button
                        key={g.gameType}
                        type="button"
                        className={`private-create-modal__chip${selectedGame === g.gameType ? ' is-selected' : ''}`}
                        aria-pressed={selectedGame === g.gameType}
                        disabled={busy}
                        onClick={() => setSelectedGame(g.gameType)}
                      >
                        {g.gameLabel}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="private-create-modal__section">
                  <span className="private-create-modal__label">Stakes (Buy-In)</span>
                  <div
                    className="private-create-modal__choices"
                    role="group"
                    aria-label="Choose Offered Stakes"
                    data-testid="private-stake-choices"
                  >
                    {stakes.map((stake) => (
                      <button
                        key={stake}
                        type="button"
                        className={`private-create-modal__chip${selectedStake === stake ? ' is-selected' : ''}`}
                        aria-pressed={selectedStake === stake}
                        disabled={busy}
                        onClick={() => setSelectedStake(stake)}
                      >
                        {stake.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="private-create-modal__section">
                  <span className="private-create-modal__label">Starting Chips</span>
                  <div
                    className="private-create-modal__choices"
                    role="group"
                    aria-label="Choose Offered Starting Chips"
                    data-testid="private-stack-choices"
                  >
                    {stacks.map((stack) => (
                      <button
                        key={stack}
                        type="button"
                        className={`private-create-modal__chip${selectedStack === stack ? ' is-selected' : ''}`}
                        aria-pressed={selectedStack === stack}
                        disabled={busy}
                        onClick={() => setSelectedStack(stack)}
                      >
                        {stackBandLabel(stack)}
                      </button>
                    ))}
                  </div>
                </div>

                {matched && (
                  <div
                    className="private-create-modal__summary"
                    data-testid="private-match-summary"
                  >
                    <div className="private-create-modal__fact">
                      <span>Buy-In & Rake</span>
                      <strong>{matched.totalBuyIn.toLocaleString()} Total (Auto Rake)</strong>
                    </div>
                    <div className="private-create-modal__fact">
                      <span>Blind Levels</span>
                      <strong>{`${matched.levelMinutes} Min Levels (Auto)`}</strong>
                    </div>
                    <div className="private-create-modal__fact">
                      <span>Seats</span>
                      <strong>{format === 'spin' ? '3 Seats (Spin)' : '2 Seats (Heads-Up)'}</strong>
                    </div>
                    <div className="private-create-modal__fact">
                      <span>Access</span>
                      <strong>Link Only (Private)</strong>
                    </div>
                  </div>
                )}

                <p className="hu-waiting-dialog__hint">
                  Only Players With Your Invite Link Can Join. You Can Unregister And Close This
                  Event At Any Time Before It Starts.
                </p>
              </>
            )}

            {error && (
              <p className="hu-waiting-dialog__error" role="alert">
                {error}
              </p>
            )}
          </SpadeConsole>
        </div>
      )}
    </dialog>
  );
}
