/** Firework rocket. The separate Missile rig owns the guided strike. */
import type { ThrowableSpec } from '../spec';
import { RIG_VIEWBOX, type RigProps, type ThrowableRig } from '../rig';
import { preloadThrowableCues } from '../cues';
import './rocket.css';
import { AtlasSprite } from '../AtlasSprite';

export const rocketSpec: ThrowableSpec = {
  id: 'rocket',
  name: 'Rocket',
  tier: 'premium',
  category: 'objects',
  spawn: 'avatar-corner',
  spawnMs: 300,
  flight: { ms: 333, mode: 'straight', upright: true },
  arrival: 'none',
  payload: { sizeU: 1.3, anchor: 'face', coversAvatar: true, ms: 3400 },
  beats: [
    { at: 333, marker: 'land' },
    { at: 333, marker: 'ignition' },
    { at: 1633, marker: 'climb' },
    { at: 2267, marker: 'apex' },
    { at: 2567, marker: 'hit' },
    { at: 2633, marker: 'flame' },
    { at: 2733, marker: 'fireball' },
    { at: 2867, marker: 'orange' },
    { at: 3033, marker: 'smoke' },
    { at: 3733, marker: 'cut' },
  ],
  audio: [
    { at: 333, sample: 'fuse_ignite', gain: 0.85 },
    { at: 800, sample: 'fw_rumble', gain: 0.5 },
    { at: 1633, sample: 'fw_whistle', gain: 0.63 },
    { at: 2567, sample: 'explosion_boom', gain: 0.8 },
  ],
};

preloadThrowableCues(rocketSpec.audio.map((c) => c.sample));

function RocketBody() {
  return (
    <AtlasSprite src="rocket" rect={[5, 85, 450, 515]} x={-23} y={-26} width={46} height={52} />
  );
}
function Projectile(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <RocketBody />
    </svg>
  );
}
function Payload(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <g className="thr-rocket__ascent">
        <g transform="translate(-12 15) rotate(27)">
          <AtlasSprite
            src="rocket"
            rect={[540, 90, 224, 510]}
            x={-7}
            y={-2}
            width={14}
            height={39}
          />
        </g>
        <RocketBody />
      </g>
      <g transform="translate(6 -65)">
        <g className="thr-rocket__hitglow">
          <AtlasSprite
            src="rocket"
            rect={[25, 802, 355, 337]}
            x={-56}
            y={-56}
            width={112}
            height={112}
          />
        </g>
        <g className="thr-rocket__flame">
          <AtlasSprite
            src="rocket"
            rect={[25, 802, 355, 337]}
            x={-24}
            y={-35}
            width={48}
            height={48}
          />
        </g>
        <g className="thr-rocket__fireball">
          <AtlasSprite
            src="rocket"
            rect={[390, 685, 462, 490]}
            x={-76}
            y={-96}
            width={152}
            height={164}
          />
        </g>
        <g className="thr-rocket__ember">
          <AtlasSprite
            src="rocket"
            rect={[842, 681, 398, 491]}
            x={-59}
            y={-50}
            width={118}
            height={131}
          />
        </g>
        <g className="thr-rocket__smoke">
          <AtlasSprite
            src="rocket"
            rect={[842, 681, 398, 491]}
            x={-72}
            y={-85}
            width={144}
            height={157}
          />
        </g>
      </g>
    </svg>
  );
}
export const rocketRig: ThrowableRig = { Projectile, Payload };
