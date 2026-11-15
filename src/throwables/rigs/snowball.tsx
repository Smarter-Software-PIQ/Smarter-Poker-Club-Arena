import { AtlasSprite } from '../AtlasSprite';
import { RIG_VIEWBOX, type RigProps, type ThrowableRig } from '../rig';
import type { ThrowableSpec } from '../spec';
import { preloadThrowableCues } from '../cues';
import './snowball.css';
export const spec: ThrowableSpec = {
  id: 'snowball',
  name: 'Snowball',
  tier: 'premium',
  category: 'objects',
  spawn: 'avatar-corner',
  spawnMs: 167,
  flight: { ms: 333, mode: 'straight', upright: true },
  arrival: 'land',
  payload: { sizeU: 1.5, anchor: 'face', coversAvatar: false, ms: 2867 },
  beats: [
    { at: 333, marker: 'arrival' },
    { at: 500, marker: 'snow-impact' },
    { at: 900, marker: 'flakes-scatter' },
    { at: 1000, marker: 'frost-forms' },
    { at: 3000, marker: 'snow-melts' },
    { at: 3200, marker: 'cut' },
  ],
  audio: [
    { at: 500, sample: 'snow_crunch', gain: 0.93 },
    { at: 900, sample: 'snow_crunch', gain: 0.37 },
  ],
};
preloadThrowableCues(spec.audio.map((cue) => cue.sample));
const RECTS: [number, number, number, number][] = [
  [117, 139, 419, 418],
  [729, 124, 433, 426],
  [55, 737, 560, 422],
  [816, 796, 267, 308],
];
function Tile({
  tile,
  x,
  y,
  width,
  height,
}: {
  tile: number;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return (
    <AtlasSprite
      src="snowball"
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
      <Tile tile={0} x={-55} y={-55} width={110} height={110} />
    </svg>
  );
}
function Payload(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <g className="thr-snowball__ball">
        <Tile tile={0} x={-55} y={-55} width={110} height={110} />
      </g>
      <g className="thr-snowball__splat">
        <Tile tile={1} x={-95} y={-90} width={190} height={180} />
      </g>
      <g className="thr-snowball__flake0">
        <Tile tile={3} x={-15} y={-15} width={30} height={30} />
      </g>
      <g className="thr-snowball__flake1">
        <Tile tile={3} x={-15} y={-15} width={30} height={30} />
      </g>
      <g className="thr-snowball__flake2">
        <Tile tile={3} x={-15} y={-15} width={30} height={30} />
      </g>
      <g className="thr-snowball__flake3">
        <Tile tile={3} x={-15} y={-15} width={30} height={30} />
      </g>
      <g className="thr-snowball__flake4">
        <Tile tile={3} x={-15} y={-15} width={30} height={30} />
      </g>
      <g className="thr-snowball__flake5">
        <Tile tile={3} x={-15} y={-15} width={30} height={30} />
      </g>
      <g className="thr-snowball__scarf">
        <Tile tile={2} x={-65} y={15} width={130} height={100} />
      </g>
      <g className="thr-snowball__clump0">
        <Tile tile={0} x={-6.0} y={-6.0} width={12} height={12} />
      </g>
      <g className="thr-snowball__clump1">
        <Tile tile={0} x={-8.0} y={-8.0} width={16} height={16} />
      </g>
      <g className="thr-snowball__clump2">
        <Tile tile={0} x={-4.5} y={-4.5} width={9} height={9} />
      </g>
      <g className="thr-snowball__clump3">
        <Tile tile={0} x={-4.0} y={-4.0} width={8} height={8} />
      </g>
    </svg>
  );
}
export const rig: ThrowableRig = { Projectile, Payload };
