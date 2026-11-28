# #SmarterDesign is the page standard, written down (2026-11-27)

Dan rejected a Club Operations rebuild made from the painted console plates: "THAT IS NOT THE #SMARTERDESIGN. WTF?!" and "DO NOT USE THOSE BULKY FRAMES, THATS THE OLD STYLE... USE THE #SMARTERDESIGN STYLE". The agent had followed the repo's own instructions: CLAUDE.md sent every redesign to `.claude/skills/club-arena-console/SKILL.md`, the painted-chassis standard. As long as that pointer stood, the next agent asked to upgrade a page would build the plates again.

## What changed

- **New skill `.claude/skills/smarter-design/SKILL.md`:** Dan's rulings verbatim, the reference pages, every piece of the arena workspace kit (mast, meters, cases, keys, rows, wells and `ArenaState`), the rules the tests enforce, the traps that cost time, and the approval step before a design ships.
- **`.claude/skills/smarter-design/harness/`:** a full-page before/after render harness. It serves the real app with `supabase`, `ClubWorkspaceContext`, `useClubNavigationAccess` and `useAuthUser` swapped for offline stand-ins, so any club route renders as Kings Club's owner with fixture data. It includes `run.sh`, `shot.mjs` (the page captured at full height with fixed bars in place) and `sheet.py` (side-by-side sheets). Nothing in it is imported by the app.
- **CLAUDE.md:** the redesign pointer now names #SmarterDesign for pages, sub pages and workspaces, records the ruling, and limits #ClubArenaConsole to the case where Dan names it or a specific painted master.
- **`club-arena-console` skill:** its description and opening now say the same, so an agent that loads it directly is turned toward the right standard.
- **New law `tests/club-operations-pages-stay-smarterdesign.law.test.ts`:** every Club Operations rail page renders on the arena workspace with the shared mast and imports no painted plates, the rail keeps its chrome frame and gold numbers, and CLAUDE.md keeps the pointer.
