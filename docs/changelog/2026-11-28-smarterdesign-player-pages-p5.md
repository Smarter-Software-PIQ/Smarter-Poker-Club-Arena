# Settings, Profile and Connections wear #SmarterDesign (player pages batch P5)

2026-11-28. Dan's order of 2026-11-27: "THE SAME #SMARTERDESIGN UPGRADE TO
EVERY SINGLE PAGE". Three player pages move onto the arena workspace, the look
of Player Management, the Cashier and the converted Notifications, Stats,
Wallet and Hand History pages.

## What changed

- **Settings** (`/settings`): the chrome mast (Control Room) with the page
  description behind the chrome "?"; the section index a chrome switch; the
  sync status a chrome case with Reset and the lit Retry Account Sync; each
  section a chrome case under a section title; every setting a chrome ledger
  row; the toggles chrome keys that light blue when on. Every toggle is the
  same checkbox with the same label and behaviour. The Action Controller view
  tabs are a chrome switch on this page only; its controller previews are
  approved artwork and are not repainted.
- **Profile** (`/profile`): the chrome mast (Your Profile), the credential a
  chrome case with the portrait at its unchanged size, the telemetry and the
  membership figures on chrome readout tiles, Edit Profile and Open VIP Ledger
  lit, the workspace doors and every record a chrome ledger row, the four
  views a chrome switch. The name no longer shouts in capitals. The global
  header and its portrait frame (CLAUDE.md 10.7b) are untouched.
- **Connections** (`/friends`): the chrome mast (Your Poker Circle), the
  counts on chrome readout tiles with the lit Open Messenger, the Connections
  case with its views on a chrome switch, the filter a dark well, each friend
  and request a chrome ledger row with its own keys.

## How it is held

- Pinned first on unchanged main, unchanged after:
  `tests/components/settingsPageIsPinned.test.tsx`,
  `tests/components/profilePageIsPinned.test.tsx`,
  `tests/components/friendsPageIsPinned.test.tsx`.
- Scoping: `tests/unit/playerPagesP5ArenaDressIsScoped.test.ts`.
- Two older assertions followed the pages: the light-mode token check in
  `tests/player-identity-casino-realism.test.ts` (the arena reads dark in
  either theme; the Settings dialogs keep their light mode) and the gunmetal
  check in `tests/unit/communityCommandCenter.test.ts`.
- The render harness (`.claude/skills/smarter-design/harness/`) gained what
  these pages read: the player's own profile, Connections rows, the signed-in
  player in the user store, `getAuthUser` answering in the app's shape, and
  `SHOT_WAIT_MS` for a page whose reads retry before they answer.

## Left

VIP, Daily Bonus and Search. See the batch P5 entry in
`docs/club-operations/SMARTERDESIGN-HISTORY.md`.
