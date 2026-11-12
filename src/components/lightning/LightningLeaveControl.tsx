import { useEffect, useRef, useState } from 'react';
import { useFitText } from '../lobby/game-cards/useFitText';
import { stopLightningPlaying } from '../../lightning/lightningSessionApi';
import { useToast } from '../common/Toast';
import { reportError } from '../../utils/errorReporter';
import './LightningLeaveControl.css';

/**
 * Stop matchmaking at once; the leave itself happens after the current hand
 * (Dan 2026-11-12: "AFTER THE END OF THE CURRENT HAND, YOU LEAVE THE TABLE.
 * NOT AT THAT EXACT MOMENT"). The page owns the wait; `queued` says it is armed.
 */
export function LightningLeaveControl({
  clusterId,
  onLeave,
  ensureStopped,
  onLeaveIntentChange,
  queued = false,
  onCancel,
}: {
  clusterId: string;
  onLeave: () => Promise<void>;
  ensureStopped?: () => Promise<boolean>;
  onLeaveIntentChange?: (leaving: boolean) => void;
  /** The stop is confirmed and the page will leave when this hand ends. */
  queued?: boolean;
  /** Tapping a queued leave cancels it; resolves true when play resumes. */
  onCancel?: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const toast = useToast();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  /* Dan 2026-11-09: 'it should just say, "Leave Next Hand"'. The behaviour is
     unchanged - the durable stop refuses every new deal and the hand in front
     of the player still finishes through the original leave owner - so the
     label now says what the button has always done. */
  // A cancelled leave sends the stop again next time.
  useEffect(() => {
    if (!queued) setStopped(false);
  }, [queued]);
  const label = busy
    ? queued
      ? 'Staying...'
      : 'Leaving...'
    : queued
      ? 'Leaving After Hand'
      : 'Leave Next Hand';
  const labelRef = useFitText<HTMLSpanElement>(label, 1, 0.5);
  const cancel = async () => {
    if (inFlight.current || !onCancel) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await onCancel();
    } catch (error) {
      reportError(error, 'LightningLeaveControl.cancel');
      if (mounted.current) toast.warning('Could Not Cancel Your Leave. Please Try Again.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const leave = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      onLeaveIntentChange?.(true);
      if (!stopped) {
        const confirmed = ensureStopped
          ? await ensureStopped()
          : (await stopLightningPlaying(clusterId))?.ok === true;
        if (!mounted.current) return;
        if (!confirmed) {
          onLeaveIntentChange?.(false);
          toast.warning('Could Not Confirm Your Stop Request. Please Try Again.');
          return;
        }
        setStopped(true);
      }
      // The durable stop already refuses every new deal. The hand in front of
      // the player is still theirs to play: onLeave waits for it to end.
      if (mounted.current) await onLeave();
    } catch (error) {
      if (mounted.current) onLeaveIntentChange?.(false);
      reportError(error, 'LightningLeaveControl.leave');
      if (mounted.current) toast.warning('Could Not Confirm Your Leave. Please Try Again.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className="lightning-leave-control"
      disabled={busy || (queued && !onCancel)}
      aria-busy={busy}
      data-queued={queued ? 'true' : undefined}
      title={queued && onCancel ? 'Tap To Keep Playing' : undefined}
      onClick={() => void (queued ? cancel() : leave())}
    >
      <img
        className="lightning-leave-control__chip"
        src={`${import.meta.env.BASE_URL}game-card-icons/classic-spade-chip-v1.png`}
        alt=""
        aria-hidden="true"
      />
      <span ref={labelRef}>{label}</span>
    </button>
  );
}
