import { PerformancePose } from '../PerformancePose';
import { AtlasSprite } from '../AtlasSprite';
import { RIG_VIEWBOX, type RigProps, type ThrowableRig } from '../rig';
import type { ThrowableSpec } from '../spec';
import { preloadThrowableCues } from '../cues';
import './laughing_emoji.css';
export const spec: ThrowableSpec = {
  id: 'laughing_emoji',
  name: 'Laugh With Tears',
  tier: 'free',
  category: 'emoticons',
  spawn: 'avatar-face',
  spawnMs: 167,
  flight: { ms: 300, mode: 'straight', upright: true },
  arrival: 'blink-pop',
  payload: { sizeU: 1.3, anchor: 'face', coversAvatar: true, ms: 3900 },
  beats: [
    { at: 300, marker: 'smug' },
    { at: 867, marker: 'laugh-start' },
    { at: 1267, marker: 'laugh-two' },
    { at: 1667, marker: 'tears' },
    { at: 2867, marker: 'laugh-swell' },
    { at: 4200, marker: 'cut' },
  ],
  audio: [
    { at: 867, sample: 'laugh_short', gain: 0.75 },
    { at: 1667, sample: 'drip', gain: 0.35 },
    { at: 2867, sample: 'laugh_swell', gain: 0.9 },
  ],
};
preloadThrowableCues(spec.audio.map((c) => c.sample));
function Projectile(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <AtlasSprite
        src="laughing_emoji"
        rect={[40, 70, 570, 550]}
        x={-60}
        y={-60}
        width={120}
        height={120}
      />
    </svg>
  );
}
function Payload(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <g className="thr-laughing_emoji__rock">
        <g className="thr-laughing_emoji__smug">
          <AtlasSprite
            src="laughing_emoji"
            rect={[40, 70, 570, 550]}
            x={-60}
            y={-60}
            width={120}
            height={120}
          />
        </g>
        <g className="thr-laughing_emoji__laugh">
          <PerformancePose
            src="laughing_emoji-acting"
            row={0}
            rows={2}
            x={-60.0}
            y={-58.929}
            width={120.0}
            height={117.857}
            duration={410}
            delay={530}
            repeats={6}
          />
        </g>
        <g className="thr-laughing_emoji__tears">
          <PerformancePose
            src="laughing_emoji-acting"
            row={1}
            rows={2}
            x={-69.0}
            y={-59.764}
            width={138.0}
            height={119.528}
            duration={360}
            delay={2500}
            repeats={4}
          />
        </g>
      </g>
      <g className="thr-laughing_emoji__left">
        <AtlasSprite
          src="laughing_emoji"
          rect={[1147, 1039, 64, 77]}
          x={-68}
          y={-12}
          width={14}
          height={18}
        />
      </g>
      <g className="thr-laughing_emoji__right">
        <AtlasSprite
          src="laughing_emoji"
          rect={[1147, 1039, 64, 77]}
          x={68}
          y={-12}
          width={14}
          height={18}
        />
      </g>
    </svg>
  );
}
export const rig: ThrowableRig = { Projectile, Payload };
