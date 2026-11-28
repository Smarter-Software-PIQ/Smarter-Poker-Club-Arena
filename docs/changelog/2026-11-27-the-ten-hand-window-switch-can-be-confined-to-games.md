# The Ten-Hand Window Switch Can Be Confined To Games (horse.vpipFloorTenHandWindowGame.<variant>, Default: Every Game)

Owner, 2026-11-17 14:34 Chicago: "Table VPIP must limp fold for a bb. smh nothing else if there vpip drops." And 18:38: a Horse the limp cannot keep over the floor is booted and replaced; the floor never buys a call of a raise.

## Why

Tables known to be judged at ten hands still run the old floor (the integrator's exception of 2026-11-18, `vpipFloorLimpOnlyTenHandTable`): it widens ranges and calls raises (`vpip_floor_call_down` 6,970 fires on 2026-11-26). `vpipFloorLimpOnlyTenHandWindow` ends that exception, but it is one global switch row, and its measured eviction cost differs by game (per table-hour, six-Horse model: PLO5 0.52, inside the 0.52 the owner accepted on thirty-hand tables; PLO4 0.65; hold'em 0.99). The lead's plan is PLO5 first. `horse.omahaGameScope.<option>` cannot do this: it lists only omaha\* options and only switches an option off inside a PLO4/PLO5 decision, so hold'em and every other variant would run the window as published.

## What changed

- Three engine runtime settings, `horse.vpipFloorTenHandWindowGame.nlh`, `.plo4`, `.plo5` (integer 0..1, compiled default 0; `HorseVpipFloorTenHandWindowGames.ts`, `runtimeSettings/registry.ts`). The variants set to 1 travel in the decision request as the parameter `vpipFloorLimpOnlyTenHandWindowGames` (absent when none is 1).
- One read site, `vpipFloorLimpOnlyTenHandWindowOn`, used by both readers of the switch (`vpipFloorLimpOnlyGovernsTenHandTable`, `vpipFloorLimpOnlyApplies`). No list: the switch as published. A list: the switch is on only at a table whose variant is listed; at every other table it reads as off, which is today's exception. The list never turns the switch on.

## Off

Nothing published (every key 0) or the switch row off: every decision byte for byte and draw for draw the one it was; the request, its key and its journal are byte-identical. No migration, no new switch.

## Order of operations

A serving engine refuses a whole runtime-settings version that names a key it does not register, so the key is published only after a build containing this change serves on every engine host. Then: publish the settings with `horse.vpipFloorTenHandWindowGame.plo5 = 1`, check it was accepted, then switch `vpipFloorLimpOnlyTenHandWindow` on.

Tests: `server/src/engine/aVpipFloorTenHandWindowIsScopedByGame.law.test.ts`.
