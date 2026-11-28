# #SmarterDesign gets a written standard (2026-11-27)

Dan tags routed page sections "#SmarterDesign", and the repo had no definition of
it beyond a passing mention in PR #12179. On 2026-11-27 an agent read the tag as the
painted #ClubArenaConsole SpadeConsole frames and rebuilt the bottom of Player
Management on them. Dan: "NO DO NOT USE THOSE BULKY FRAMES, THATS THE OLD STYLE...
USE THE #SMARTERDESIGN STYLE FOR THESE." The approved result is PR #12235
(`eaef16ff5`).

## What changed

- `.claude/skills/smarter-design/SKILL.md`: the standard. #SmarterDesign on a routed
  page is the arena workspace in `src/components/lobby/ArenaWorkspace.css`: the
  `.arena-workspace` shell and its variables, the `.arena-case` chrome case, the
  `.arena-section-title`, `.arena-meter` tiles, `.arena-switch` chrome-stat buttons
  (active state and the per-section lit primary), `.arena-ledger-row` /
  `.member-row` rows, the `.members-search` field well and the inks, with the top of
  Player Management, the Cashier and Roster Records as references. It says what the
  standard is not (the SpadeConsole, the Buy-In deck, an image header for a section),
  how it splits with #ClubArenaConsole (dialogs there, page sections here), Dan's
  rules that bind it (Title Case, no em dashes, no `:hover`, the chrome "?" on every
  image header, Back To Dashboard above the header), the e2e trap from PR #12257
  and the 393px before/after verification.
- `CLAUDE.md`: one line beside the "REDESIGNING A PAGE" pointer naming the tag and
  linking the skill.

## Found while reading the code

- `.arena-meter` has no `data-tone='live'` rule in `ArenaWorkspace.css`; only
  `.ca-page-bar__metric[data-tone='live'] dd` does. Roster Export colours its live tile
  in `RosterRecords.css`. The skill documents that as the pattern.
- The lit primary button is not a workspace rule either; each section declares it
  (`.roster-records__primary`, `.members-history-action`, the transfer review's last
  button) with the same gradient and `--arena-active` rim.
- No "Back To Dashboard" control exists in `src/` yet; the rule is written for the
  next page that needs one.
