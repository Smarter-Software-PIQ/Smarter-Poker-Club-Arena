# 448565 nine-seat phone portraits below floor: evidence (PRIMARY, 2026-11-24T10:00Z)

- Production runs: 44992372944, 45000568246, 45064948057 (pre-#11804), 45337575189, 45343349750:
  nine-seat chairs at 129.6-133.1 against 140.
- Live nine-seat cash tables d751abf9 and e78717a2 (read 09:50Z): 9 seated each, 6-7 of 9
  avatars are Supabase storage uploads, the rest character art.
- Local render (chromium 1243, fixture fonts bypassed because the proxy refuses ca-static):
  - character reference + 8 photos, main: every opponent 126.4 (below 140), same gate message as production.
  - same, with the fix: unconstrained chairs 141.8; wide photos on own rail 125.6/128.6 with floors 123.8/126.9.
  - all character art, before and after: 141.8 (unchanged).
- `npx vitest run` opponentAvatarLayout + 5 avatar laws: 77/77.
- table-proportions "observer avatar artwork allocations" + "every top chair stands on the rail": 25/25.
