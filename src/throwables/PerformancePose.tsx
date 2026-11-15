import type { CSSProperties } from 'react';
import { throwableAtlasUrl } from './atlasUrl';
import './performancePose.css';

/** Each row holds eight complete, articulated poses. The fixed viewport keeps
 * the rig's original pivot even when cheeks, cloth, or a prop move inside it. */
export function PerformancePose({
  src,
  row,
  rows,
  x,
  y,
  width,
  height,
  duration,
  delay = 0,
  repeats = 1,
}: {
  src: string;
  row: number;
  rows: number;
  x: number;
  y: number;
  width: number;
  height: number;
  duration: number;
  delay?: number;
  repeats?: number;
}) {
  return (
    <foreignObject x={x} y={y} width={width} height={height} pointerEvents="none">
      <div
        className="thr-performance-pose"
        style={
          {
            backgroundImage: `url(${throwableAtlasUrl(src)})`,
            backgroundSize: `800% ${rows * 100}%`,
            backgroundPositionY: rows === 1 ? '0%' : `${(100 * row) / (rows - 1)}%`,
            '--pose-duration': duration + 'ms',
            '--pose-delay': delay + 'ms',
            '--pose-repeats': repeats,
          } as CSSProperties
        }
      />
    </foreignObject>
  );
}
