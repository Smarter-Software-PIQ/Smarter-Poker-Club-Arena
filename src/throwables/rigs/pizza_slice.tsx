import { PerformancePose } from '../PerformancePose';
import { AtlasSprite } from '../AtlasSprite';
import { RIG_VIEWBOX, type RigProps, type ThrowableRig } from '../rig';
import type { ThrowableSpec } from '../spec';
import { preloadThrowableCues } from '../cues';
import './pizza_slice.css';

export const spec: ThrowableSpec = {
  id: 'pizza_slice',
  name: 'Pizza Slice',
  tier: 'free',
  category: 'objects',
  spawn: 'avatar-face',
  spawnMs: 167,
  flight: { ms: 333, mode: 'straight', upright: true },
  arrival: 'blink-pop',
  payload: { sizeU: 1.4, anchor: 'face', coversAvatar: true, ms: 3667 },
  beats: [
    { at: 333, marker: 'face-down' },
    { at: 1000, marker: 'slide-smear' },
    { at: 1800, marker: 'cheese-stretch' },
    { at: 2200, marker: 'peel' },
    { at: 2900, marker: 'drop' },
    { at: 3500, marker: 'pepperoni-stays' },
    { at: 4000, marker: 'cut' },
  ],
  audio: [
    { at: 333, sample: 'splat_wet_small', gain: 0.6 },
    { at: 1800, sample: 'cheese_pull', gain: 0.75 },
    { at: 2200, sample: 'cheese_pull', gain: 0.54 },
    { at: 2900, sample: 'pop_soft', gain: 0.35 },
  ],
};
preloadThrowableCues(spec.audio.map((c) => c.sample));
function Projectile(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <AtlasSprite
        src="pizza_slice"
        rect={[0, 35, 507, 701]}
        x={-42}
        y={-58}
        width={84}
        height={116}
      />
    </svg>
  );
}
function Payload(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <g className="thr-pizza_slice__smear">
        <AtlasSprite
          src="pizza_slice"
          rect={[0, 764, 535, 478]}
          x={-39}
          y={-25}
          width={78}
          height={70}
        />
      </g>
      <g>
        <AtlasSprite
          src="pizza_slice"
          rect={[541, 810, 390, 390]}
          x={-16}
          y={-40}
          width={32}
          height={32}
        />
      </g>
      <g className="thr-pizza_slice__tether">
        <PerformancePose
          src="pizza_slice-acting"
          row={0}
          rows={1}
          x={-16.245}
          y={-16.0}
          width={32.491}
          height={95.0}
          duration={700}
          delay={1420}
          repeats={2}
        />
      </g>
      <g className="thr-pizza_slice__slice">
        <AtlasSprite
          src="pizza_slice"
          rect={[507, 45, 471, 675]}
          x={-45}
          y={-64}
          width={90}
          height={129}
        />
      </g>
      <g className="thr-pizza_slice__drip">
        <AtlasSprite
          src="pizza_slice"
          rect={[976, 818, 250, 423]}
          x={8}
          y={12}
          width={16}
          height={27}
        />
      </g>
      <g className="thr-pizza_slice__strand0">
        <path
          d="M-14 2 q7 19 3 36 t8 35"
          fill="none"
          stroke="#ffcf72"
          strokeWidth="2.7"
          strokeLinecap="round"
        />
      </g>
      <g className="thr-pizza_slice__strand1">
        <path
          d="M4 2 q7 19 3 36 t8 35"
          fill="none"
          stroke="#ffcf72"
          strokeWidth="2.0"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
export const rig: ThrowableRig = { Projectile, Payload };
