import { PerformancePose } from '../PerformancePose';
import { AtlasSprite } from '../AtlasSprite';
import { RIG_VIEWBOX, type RigProps, type ThrowableRig } from '../rig';
import type { ThrowableSpec } from '../spec';
import { preloadThrowableCues } from '../cues';
import './doge.css';
export const spec: ThrowableSpec = {
  id: 'doge',
  name: 'Doge',
  tier: 'vip',
  category: 'characters',
  spawn: 'avatar-face',
  spawnMs: 167,
  flight: { ms: 200, mode: 'straight', upright: true },
  arrival: 'blink-pop',
  payload: { sizeU: 2.2, anchor: 'face', coversAvatar: true, ms: 4133 },
  beats: [
    { at: 200, marker: 'head-pop' },
    { at: 320, marker: 'overshoot' },
    { at: 500, marker: 'settle' },
    { at: 1433, marker: 'glasses-slide' },
    { at: 1600, marker: 'glasses-on' },
    { at: 1633, marker: 'sunburst' },
    { at: 3333, marker: 'wink' },
    { at: 4333, marker: 'cut' },
  ],
  audio: [
    { at: 200, sample: 'dog_huff', gain: 0.88 },
    { at: 1600, sample: 'finger_snap', gain: 0.8 },
    { at: 3333, sample: 'chime_shimmer', gain: 0.22 },
  ],
};
preloadThrowableCues(spec.audio.map((c) => c.sample));
function Projectile(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <AtlasSprite src="doge" rect={[25, 805, 685, 320]} x={-62} y={-34} width={124} height={58} />
    </svg>
  );
}
function Payload(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <g className="thr-doge__sun">
        <AtlasSprite
          src="doge"
          rect={[720, 700, 520, 510]}
          x={-110}
          y={-110}
          width={220}
          height={220}
        />
      </g>
      <g className="thr-doge__pop">
        <g className="thr-doge__neutral">
          <PerformancePose
            src="doge-acting"
            row={0}
            rows={2}
            x={-56.993}
            y={-65.0}
            width={113.986}
            height={130.0}
            duration={340}
            delay={0}
            repeats={2}
          />
        </g>
        <g className="thr-doge__wink">
          <PerformancePose
            src="doge-acting"
            row={1}
            rows={2}
            x={-56.051}
            y={-65.0}
            width={112.101}
            height={130.0}
            duration={410}
            delay={3130}
            repeats={1}
          />
        </g>
        <g className="thr-doge__glasses">
          <AtlasSprite
            src="doge"
            rect={[25, 805, 685, 320]}
            x={-62}
            y={-34}
            width={124}
            height={58}
          />
        </g>
      </g>
    </svg>
  );
}
export const rig: ThrowableRig = { Projectile, Payload };
