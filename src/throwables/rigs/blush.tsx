import { PerformancePose } from '../PerformancePose';
import { AtlasSprite } from '../AtlasSprite';
import { RIG_VIEWBOX, type RigProps, type ThrowableRig } from '../rig';
import type { ThrowableSpec } from '../spec';
import { preloadThrowableCues } from '../cues';
import './blush.css';
export const spec: ThrowableSpec = {
  id: 'blush',
  name: 'Blush',
  tier: 'free',
  category: 'emoticons',
  spawn: 'avatar-face',
  spawnMs: 167,
  flight: { ms: 333, mode: 'straight', upright: true },
  arrival: 'blink-pop',
  payload: { sizeU: 1.05, anchor: 'face', coversAvatar: true, ms: 3667 },
  beats: [
    { at: 433, marker: 'pop' },
    { at: 600, marker: 'cheek-bloom' },
    { at: 1000, marker: 'pink-cheeks' },
    { at: 1500, marker: 'heart-rise' },
    { at: 2200, marker: 'heart-float' },
    { at: 3000, marker: 'sway' },
    { at: 4000, marker: 'cut' },
  ],
  audio: [
    { at: 600, sample: 'sigh_soft', gain: 0.22 },
    { at: 1000, sample: 'laugh_short', gain: 0.48 },
  ],
};
preloadThrowableCues(spec.audio.map((cue) => cue.sample));
const RECTS: [number, number, number, number][] = [
  [0, 0, 627, 627],
  [627, 0, 627, 627],
  [0, 627, 627, 627],
  [627, 627, 627, 627],
];
function Tile({
  tile,
  x = -65,
  y = -65,
  width = 130,
  height = 130,
}: {
  tile: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}) {
  return (
    <AtlasSprite
      src="blush"
      rect={RECTS[tile]}
      sheetSize={[1254, 1254]}
      x={x}
      y={y}
      width={width}
      height={height}
    />
  );
}
function Projectile(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <Tile tile={0} />
    </svg>
  );
}
function Payload(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <g className="thr-blush__pop">
        <g className="thr-blush__sway">
          <g className="thr-blush__base">
            <PerformancePose
              src="blush-acting"
              row={0}
              rows={2}
              x={-65.0}
              y={-65.0}
              width={130.0}
              height={130.0}
              duration={240}
              delay={80}
              repeats={1}
            />
          </g>
          <g className="thr-blush__pink">
            <PerformancePose
              src="blush-acting"
              row={1}
              rows={2}
              x={-65.0}
              y={-65.0}
              width={130.0}
              height={130.0}
              duration={640}
              delay={345}
              repeats={2}
            />
          </g>
        </g>
        <g className="thr-blush__heart">
          <Tile tile={2} x={20} y={-50} width={60} height={60} />
        </g>
        <g className="thr-blush__sparkle">
          <Tile tile={3} x={-65} y={-35} width={35} height={35} />
        </g>
      </g>
    </svg>
  );
}
export const rig: ThrowableRig = { Projectile, Payload };
