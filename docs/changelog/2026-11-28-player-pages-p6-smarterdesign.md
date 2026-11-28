# VIP, Daily Bonus and Community Search wear #SmarterDesign (player pages P6)

2026-11-28. Dan's order of 2026-11-27: "THE SAME #SMARTERDESIGN UPGRADE TO
EVERY SINGLE PAGE". This batch moves three player pages onto the arena
workspace (`.claude/skills/smarter-design/SKILL.md`).

## What changed

- `/bonuses` (`src/pages/DailyBonusPage.tsx`, `DailyBonusPage.css`): the
  Rewards Circuit header's painted console is gone. The chrome mast, then
  one arena case around the sheet's frameless glass: readouts and the week
  on chrome tiles (today on the lit rim), every reward and note a chrome
  row, Claim the one lit key.
- `/vip` (`src/pages/VIPPage.tsx`, `VIPPageArena.css`): the chrome mast; the
  membership, the card and perks, Diamond Activity, the balance and Buy
  Features each an arena case, figures on tiles, records on chrome rows,
  Buy Diamonds and each Buy lit. `VIPMembershipPlate` and
  `VIPActivityHistory` take an opt-in `arena` prop only `/vip` passes.
- `/search` (`src/pages/SearchPage.tsx`, `SearchPage.module.css`): the
  chrome mast with Results on a chrome meter; the scanner one arena case
  with the query in a dark well, index health and categories on chrome
  switches, every hit a chrome ledger row with its primary lit.

## What did not change

Every reward, claim, diamond figure, VIP allowance and price, every word and
every key's behaviour. The pins were recorded on unchanged main first and
are unchanged after: `tests/components/dailyBonusPageIsPinned.test.tsx`,
`vipPageIsPinned.test.tsx`, `searchPageIsPinned.test.tsx`.

`DailyBonusSheet.tsx` was not edited (open PR #12313 edits it); the entry
modal keeps its console. The painted VIP sheets stay as
`tests/marketplace-console-visual-contract.test.ts` pins them and are
overridden only under the page's arena root
(`tests/unit/playerPagesP6ArenaDressIsScoped.test.ts`).

Before and after renders at 393 and 1280 were made with the render harness
(`.claude/skills/smarter-design/harness/`) using harness-only fixtures.
