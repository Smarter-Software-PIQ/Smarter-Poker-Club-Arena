# Club Operations and every page it opens, in #SmarterDesign (2026-11-27)

Dan, verbatim: "INSIDE THE PLAYER MANAGEMENT PAGE AT THE TOP ... YOU SEE THE 'CLUB OPERATIONS'. THAT NEEDS TO BE ENHANCED WITH THE #SMARTERDESIGN, AS WELL AS EVERY SINGLE ONE OF THESE PAGES, WHEN CLICKED NEED THE SAME UPGRADE, ENHANCEMENT AND IMPROVEMENT TO THEM ALL."

A first pass built on the painted console plates was rejected ("THAT IS NOT THE #SMARTERDESIGN"). #SmarterDesign is the arena workspace language that Player Management, the Cashier and Club Data already use (`src/components/lobby/ArenaWorkspace.css`): an illustrated mast with the chrome "?", thin chrome cases, chrome readout tiles, chrome buttons that light blue when selected, and chrome list rows. No painted plates are used anywhere in this change.

## Shared pieces

- `ArenaWorkspaceHeader` has new areas (operations, dashboard, reports, integrity, handreview, finance, control, settings). Each has a scene from the existing hero art, a help summary and a medallion emblem. A new `emblem` prop seats the club's own logo on the Dashboard.
- `src/components/ops/ArenaOps.tsx` + `.css`: `ArenaReadings` (chrome meters) and `ArenaRow` (chrome list row with numeral, title, line, gold or red signal and chevron), plus layout helpers. The live metrics under a Club Operations mast sit in one even row of meters.

## Pages

- **Rail:** chrome-case chassis, chrome-stat keys, blue lit key for the current page, gold numbers in place of the brown badge boxes. Phones scroll sideways with end padding, and desktops show every section in two even rows.
- **Overview, Finance Overview, Control Overview:** a mast, readings in chrome meters, "Waiting For You" rows toned by urgency, and tool rows. Control's club message and joining controls sit in chrome cases.
- **Reports, Hand Review** (and Disputes, Blacklist and Anti-Cheat through the shared integrity header): a mast, meters, the casework switch, lit filter tabs, chrome rows and cases.
- **Dashboard:** a mast with the club logo, chrome switches for actions, time range and tabs, chrome meters, and the chart in smarter.poker blue and gold (it was purple and amber). The hands axis now prints whole hands instead of "20,000.00".
- **Settings:** a mast, section keys, chrome cases, chrome buttons with the primary lit, and dark field wells.
- **Players and Club Data** already used #SmarterDesign and are unchanged.

No behaviour, data reads, routes or wording changed. No hover rules were added, and every animation still plays.
