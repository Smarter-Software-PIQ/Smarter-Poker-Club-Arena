import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { SharedBoardObserver } from '../../lib/sharedBoardTiming';
import { SharedSeatObserver } from '../../lib/sharedSeatPresentation';
import type { SeatSlotProps } from './SeatSlot';

interface TableSceneProps {
  children: ReactNode;
  style: CSSProperties;
  className?: string;
  observeSeat?: (props: SeatSlotProps) => void;
  observeBoard?: (hand: string | number, count: number) => void;
}

/** Both surfaces mount game layers in this scaler. Only the actual live scene records commits. */
export const TableScene = forwardRef<HTMLDivElement, TableSceneProps>(function TableScene(
  { children, style, className, observeSeat, observeBoard },
  ref
) {
  return (
    <div
      ref={ref}
      className={className ? 'table-scaler ' + className : 'table-scaler'}
      style={style}
    >
      <SharedBoardObserver.Provider value={observeBoard ?? null}>
        <SharedSeatObserver.Provider value={observeSeat ?? null}>
          {children}
        </SharedSeatObserver.Provider>
      </SharedBoardObserver.Provider>
    </div>
  );
});
