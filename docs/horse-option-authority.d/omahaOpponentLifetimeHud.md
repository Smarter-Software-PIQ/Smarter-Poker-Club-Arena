# omahaOpponentLifetimeHud: Authority For The Live Switch

Built 2026-11-20 by PLO-OWNER lane OPPONENT-HUD on the owner's orders of 2026-11-20 3:15 PM Chicago ("OPPONENTS PLAY IS SUPPOSED TO BE INSIDE THE HORSES SHARED MEMORY ... ACCESS THE LIFETIME HAND KNOWLEDGE DATA BASE AGAINST THAT HUMAN (OR HORSE) ... IT SHOULD BE FROM HAND #1"), 3:18 PM ("THEY SHOULDN'T HAVE ACCESS TO HOLE CARDS, BUT THEY SHOULD HAVE ACCESS TO ALL PREVIOUSLY PLAYED HANDS") and 3:20 PM (load on sit-down, Lightning re-seat and table move, within 15 seconds; harden the helpers), and the lead's ruling of 3:19 PM (a per-opponent read from his lifetime public record through one mechanism and one formula for every opponent; no person/Horse branch, no named player, no unshown card, no PLO6 change). This file does not authorize switching the option on: switches are made only by the lead through the delivery path.

## What It Does

PLO4/PLO5 cash (tables and Lightning). The engine keeps one lifetime public profile per opponent and family (`server/src/engine/opponentHud/OpponentHudProfile.ts`: 114 statistics as opportunities and hits in a lifetime and a 7-day recency layer, hand-level recall cells), warms it on seat events (`server/src/services/OpponentHudStore.ts`) and, while this option reads on, attaches the live opponents' profiles to each decision request (`opponentHud`, journaled with it). In the worker, `HorseMind.opponentRead` then takes each opponent's counters from his lifetime profile (`OpponentHudExploit.ts`, capped at 300 hands) instead of the 30-hand decayed window, so every PLO exploit read (the presumption, the maniac and pressure reads, the corroboration, the fold models) uses his whole history from his first hand. Any rule may read any statistic through the one accessor `hudStat` / `hudRecall` (`OpponentHud.ts`), shrunk toward the population prior with weight n / (n + k).

Public information only: the action log, sizes, positions, stacks, board, pot, results and the made-hand names revealed at showdown. The profile never reads `hand_history.players[].cards` or `hole_cards` (law test). Persons and Horses take the same path. PLO6, PLO8, hold'em and tournaments are untouched.

Default OFF in source (read `=== true`); off, requests, keys and decisions are byte-identical (the snapshot field is absent). Registered in the option switch, switchable live, not off-only; scopable per game (`horse.omahaGameScope.omahaOpponentLifetimeHud`).

Receipts: `opponent_hud_*` (reads by family and source, recall found/none, exploit counters used, warm events, event-to-ready latency buckets, packet opponent ready/missing/late, loads, persistence).

## What Was Measured

- Audit (OPPONENT-HUD.md): the existing memory caps every read at 43.8 effective hands per fragment, is never loaded ahead of a hand, and presumes every Omaha opponent a maniac until 15 decayed hands (24 h: 4,747,996 presumed vs 882,394 disproved).
- Dry run of the builder on 33,689 PLO4/PLO5 cash hands (Nov 19-20) and both watched persons' lifetime: profiles p50 26 KB, max 60 KB; WooWoo 10,171 PLO5 hands, nevin 943.
- The profile is infrastructure: the real-chip grade belongs to each consuming rule under its own declared criteria. Replay: exact-replay byte identity with the option off is the release check.
