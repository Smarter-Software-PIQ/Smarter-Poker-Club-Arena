# #SmarterDesign sweep, batch 3: Welcome Message, Banner Displays, Settlement, Table Bomb Settings, Disputes

Dan, 2026-11-27: the painted console frames are "the old style"; routed page
sections wear #SmarterDesign (`.claude/skills/smarter-design/SKILL.md`). Same
patterns as batches 1 and 2: the painted `SpadeConsole` is aliased to
`ClubPageSection` with `arena`, and the chrome comes from the shared
workspace classes.

- Welcome Message: chrome case, the selects and the message in dark wells,
  Reload / Save Message chrome keys with Save lit.
- Banner Displays: chrome case, the preview under a chrome section title, the
  file picker a dark well, Remove Club Banner and Reload chrome keys.
- Settlement: shell only. The case and the Back key changed; the accounting
  workspace inside, its figures, handlers and hooks, is byte-for-byte
  untouched. `family` and `foot` stay on the tag for the flat-foot contract.
- Table Bomb Settings: the trigger is one chrome switch lit by aria-pressed,
  every number and choice is a dark well, rows sit under chrome hairlines. The
  refusal line keeps its `sc-ink--red` / `sc-ink--muted` hooks, which the
  interval test reads.
- Disputes (body): the docket moved to the chrome case under the arena
  integrity mast; the status filter is a chrome switch lit by aria-selected;
  each case is a chrome row; Start Review, Resolve, Escalate and Withdraw are
  chrome keys, with Resolve green and Escalate and Withdraw red. The
  `data-player-name` literals the name-marking test reads are unchanged. The
  authority test stubs `ClubPageSection` with its existing stand-in.

Markup and CSS only. Every handler, guard, string, number format, role and
aria label is unchanged. Renders: before and after at 393px and 1440px, plus an
opened dispute.
