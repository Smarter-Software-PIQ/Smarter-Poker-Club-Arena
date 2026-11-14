import { useFitText } from '../lobby/game-cards/useFitText';
import './LightningLeaveControl.css';

export function LightningLeaveControl({
  queued,
  pending,
  onLeave,
  onCancel,
}: {
  queued: boolean;
  pending: boolean;
  onLeave: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const label = pending ? 'Leaving...' : queued ? 'Leaving After Hand' : 'Leave Next Hand';
  const labelRef = useFitText<HTMLSpanElement>(label, 1, 0.5);
  return (
    <button
      type="button"
      className="lightning-leave-control"
      disabled={pending}
      aria-busy={pending}
      data-queued={queued ? 'true' : undefined}
      title={queued ? 'Tap To Keep Playing' : undefined}
      onClick={() => {
        if (queued) onCancel();
        else void onLeave();
      }}
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

export { LightningLeaveControl as LightningFeederLeaveControl };
