# The #SmarterDesign render harness renders money pages and settles before it shoots

Every money-page batch tonight hand-copied the same render-only stand-ins into
its worktree, and one copy that returned a fresh guard per render looped the
page forever. They now ship in the harness (`.claude/skills/smarter-design/harness/`):

- `cashout-scope-stub.ts`: `useCashoutScope` returns one stable always-current
  guard, so the cashout, settlement and agent money screens render instead of
  reading "Unavailable".
- `cashout-service-stub.ts`: a fixed Agent Desk cashout queue (the harness
  owner id is not a UUID, so the real read refuses it).
- `supabase-stub.ts` honours `.in()` on a column every row carries.
- `shot.mjs` waits for the page to settle (no PageSkeleton, LoadingSpinner or
  aria-busy, fonts loaded, the DOM quiet for 1.5 s) instead of a fixed 6 s, so
  the first shot after a server start is no longer a grey skeleton; it accepts
  app paths outside the club (`/wallet`, `/legal/tos`) and launches Chrome with
  `--disable-dev-shm-usage` for containers.

Render-only; nothing here is imported by the app. SKILL.md section 9 updated.
