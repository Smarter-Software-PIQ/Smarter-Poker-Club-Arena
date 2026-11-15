import { AtlasSprite } from '../AtlasSprite';
import { AvatarCopy } from '../AvatarCopy';
import { preloadThrowableCues } from '../cues';
import { RIG_VIEWBOX, type RigProps, type ThrowableRig } from '../rig';
import type { ThrowableSpec } from '../spec';
import './lightning_bolt.css';

export const spec: ThrowableSpec = {
  id: 'lightning_bolt',
  name: 'Lightning Bolt',
  tier: 'vip',
  category: 'objects',
  spawn: 'none',
  spawnMs: 0,
  flight: { ms: 0, mode: 'none' },
  arrival: 'none',
  payload: { sizeU: 1.8, anchor: 'face', coversAvatar: true, ms: 2800 },
  beats: [
    { at: 0, marker: 'storm-cloud' },
    { at: 600, marker: 'warning' },
    { at: 700, marker: 'strike' },
    { at: 800, marker: 'smoking-silhouette' },
    { at: 1200, marker: 'hair-and-smoke' },
    { at: 2400, marker: 'recover' },
    { at: 2800, marker: 'cut' },
  ],
  // Thunder/strike recordings remain in the final sound review.
  audio: [
    { at: 600, sample: 'swell_low', gain: 0.35 },
    { at: 700, sample: 'zap_short', gain: 0.67 },
    { at: 800, sample: 'thunder_crack', gain: 0.9 },
  ],
};
preloadThrowableCues(spec.audio.map((cue) => cue.sample));
function Projectile(_props: RigProps) {
  return <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false" />;
}
function Payload({ targetAvatar }: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <g className="thr-lightning_bolt__cloud">
        <AtlasSprite
          src="lightning_bolt"
          rect={[0, 0, 627, 627]}
          x={-65}
          y={-133}
          width={130}
          height={92}
        />
      </g>
      <g className="thr-lightning_bolt__soot">
        <AvatarCopy snapshot={targetAvatar} />
      </g>
      <g className="thr-lightning_bolt__reaction">
        <AtlasSprite
          src="impact-details"
          rect={[627, 0, 627, 627]}
          x={-28}
          y={-30}
          width={56}
          height={56}
        />
        <g className="thr-lightning_bolt__hair">
          <AtlasSprite
            src="impact-details"
            rect={[0, 627, 627, 627]}
            x={-40}
            y={-85}
            width={80}
            height={72}
          />
        </g>
      </g>
      <g className="thr-lightning_bolt__smoke">
        <AtlasSprite
          src="lightning_bolt"
          rect={[627, 627, 627, 627]}
          x={-45}
          y={-110}
          width={90}
          height={90}
        />
      </g>
      <g className="thr-lightning_bolt__bolt">
        <AtlasSprite
          src="lightning_bolt"
          rect={[627, 0, 627, 627]}
          x={-40}
          y={-115}
          width={80}
          height={155}
        />
      </g>
      <g className="thr-lightning_bolt__flash">
        <AtlasSprite
          src="lightning_bolt"
          rect={[0, 627, 627, 627]}
          x={-90}
          y={-90}
          width={180}
          height={180}
        />
      </g>
      <g className="thr-lightning_bolt__fork">
        <path
          d="M-7 -62 L-15 -36 -8 -38 -32 -8 -24 -28 -35 -24 -18 -44 M-7 -38 L12 -30 9 -18 31 -7 17 -24 22 -25"
          fill="none"
          stroke="#a9eaff"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
export const rig: ThrowableRig = { Projectile, Payload, needsTargetAvatar: true };
