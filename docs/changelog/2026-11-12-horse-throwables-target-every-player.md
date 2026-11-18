# 2026-11-12: Horse Throwables Target Every Player

Dan, verbatim: "MAKE SURE THE 'THROWABLES' AREN'T ONLY TARGETING HUMANS, ITS SHOULD BE TARGETING ANY AND ALL PLAYERS AT THE TABLE" / "THE THROWABLES THROWN BY HORSES".

## Cause

`detectAfterHand` in `server/src/services/HorseTableGestures.ts` chose the annoy needle's target from `input.seated.filter((s) => !s.isHorse)`. A horse never threw at another horse, and a horses-only table never produced an annoy throw. The rationale (do not spend throws on an empty rail) was already covered by `hasAudience()`, which counts watchers rather than seat types. The lost, won and all-in paths already targeted any player.

## Fix

The annoy target is now any seated player except the thrower, ordered by seat and picked by the same persona hash. Horse identity is read only to find the thrower (CLAUDE.md 10.5).

## Pins

- `server/src/services/HorseTableGestures.test.ts`: a horses-only table needles another horse; a horse targets both horses and humans across hands; a lone horse throws at nobody.
- `tests/a-horse-throws-at-every-player.law.test.ts` (registered in `docs/laws.d/`): no target pool in the gestures service may exclude horses or keep only humans. Fails against the previous source.

Engine change: activates in the 04:00 America/Chicago daily maintenance window.
