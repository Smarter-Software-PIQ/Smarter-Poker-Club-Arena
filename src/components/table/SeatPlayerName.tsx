import { useFitText } from '../lobby/game-cards/useFitText';
import './SeatSlot.css';

/** Keep the complete display name on one line inside the existing seat plate. */
export function SeatPlayerName({ name }: { name: string }) {
  const ref = useFitText<HTMLSpanElement>(name, 1, 0.05);
  return (
    <span className="seat__name" title={name}>
      <span ref={ref} className="seat__name-text">
        {name}
      </span>
    </span>
  );
}
