# A Sit And Go Is Unregistered Until It Actually Starts, And Register / Unregister Are One Button (2026-11-22)

Owner report (Dan): "PLAYERS NEED TO BE ABLE TO 'UNREGISTER' FROM A SIT N GO,
HEADS UP OR SPIN IF IT HASN'T STARTED YET" and "THE REGISTER / UNREGISTER BUTTON
NEED TO BE THE SAME SIZE AND STYLE, AND SHOULD NEVER BE CUT OFF."

His phone: "Satellite Into Nightly 20K", REGISTERING, buy-in 10 (9 + 1), Starts
When Full, 1 registered of 9. He tapped Unregister and was told "Unregister
Failed: This Tournament Has Started. You Can Only Unregister Before It Starts."
Beside the painted Invite To Game button the Unregister button read "REGIST",
outlined in red and cut off by the edge of the screen.

## 1. Unregister refused on an event that had not started

### Cause

`public.fn_ca_unregister_tournament_player_exact` (latest body: migration
`20261102154336`, the function every chip unregistration goes through from
`fn_unregister_from_tournament`) decides what "started" means from the format:

```sql
IF v_t.format_contract='spin-v1' THEN
  v_start_authority:='spin_actual_start';
ELSIF v_t.format_contract='sng-v1'
   AND COALESCE(v_t.max_players,0)=2 THEN
  v_start_authority:='heads_up_sng_actual_start';
END IF;
```

Everything else keeps the default `scheduled_clock` and meets

```sql
IF clock_timestamp()>=v_t.start_time THEN
  RETURN jsonb_build_object('ok',false,'reason','tournament_started');
```

The event on his phone is a fixed Sit and Go satellite: format `sng-v1`, nine
seats. `fn_ensure_fixed_sng_satellite` (`20261028163610`) creates it with
`start_time = clock_timestamp() + interval '2 minutes'`. That time opens its
fill window; the engine starts it only when the last seat is paid
(`min_players = max_players`; `GameServer` start gate, `maxReached`). So from
two minutes after the board opened until it filled, the clock branch answered
`tournament_started`. The client only printed what the database said
(`UNREGISTER_REASON_TEXT.tournament_started` in `TournamentService.ts`).

### Why and how it broke

`20260909183657` (2026-09-09) moved Spins and Heads-Up Sit and Gos off the
clock because "start_time is a human fill-window deadline, not a scheduled deal
time". It keyed the Sit and Go half on `max_players = 2` because every live Sit
and Go was heads-up then (`TournamentRecurringService`: "No such tournament
exists today - every live sng is heads-up"). On 2026-10-28 the six and nine
seat satellites were added in the same `sng-v1` format with the same fill-window
`start_time`, and nothing revisited the unregistration rule. Each change was
correct alone. The Diamond door (`fn_poker_diamond_tournament_unregister`,
`20260930235000`) copied the same branch.

### Fix (SQL migration `20261122192807_a_sit_and_go_is_unregistered_until_it_actually_starts.sql`)

Every `sng-v1` event that is not Heads-Up takes a new start authority,
`sit_and_go_actual_start`, in the chip core and the Diamond door. It is refused
only when the event has actually started: status has left ANNOUNCED /
REGISTERING, `started_at` is set, a hand is persisted, or any launch receipt
exists. Heads-Up, Spins, scheduled MTTs and the seat-first satellite (whose
start is advertised) keep the rule they had.

The race: the launch receipt is the launch's first write and
`fn_begin_tournament_launch_before_lease_generation` takes the `tournaments` row
`FOR UPDATE` before inserting it; the unregistration holds that same row lock
for its whole transaction. So either the unregistration commits first (player
removed, refunded once, the board shows one seat fewer) or the launch claims
the event first and the unregistration answers `tournament_started` with no
write. The rule is proved a second time after the refund and roster work, and a
failure there rolls everything back.

Money is untouched: the refund still leaves through
`fn_settle_tournament_refund_exact`, the refund entitlements, the fee reversal
and the immutable unregistration receipt, to wherever the entry came from.
Nothing reads `is_horse`. The receipt check constraint is widened by exactly
the one new value, and the receipt reader proves it (a Sit and Go that is not
Heads-Up, no completed launch at or before the receipt).

The migration edits the live definitions in place by anchored replacement; each
anchor must occur exactly once or the file aborts and changes nothing.

Client: the sign-up card now tells a starts-when-full entrant "You Can
Unregister Any Time Before The Tournament Starts" (it hid the line because the
rule did not exist for them).

### Checked and left alone

- Lobby cards (`ArenaLobbyGameCard`, `GameLobbyPanel`, `TournamentLobbyCard`)
  and the details page already decide Unregister from status and `started_at`,
  never from `start_time`. Only the database disagreed.
- `registration_schedule_unset` (a scheduled event with no `start_time`) is the
  same shape of answer but is no longer reachable for a Sit and Go; a scheduled
  MTT with no start time cannot start at all and is a configuration defect.
- `seat-first-satellite-v1` keeps the scheduled clock on purpose: the engine
  treats its start as advertised (`TournamentManagerBase`, "Only the seat-first
  satellite keeps the old rule").
- A narrow window that existed before and still exists for every fill-to-start
  format: the engine reads a full field, then a player unregisters before the
  launch receipt is written. The player is refunded cleanly; the launch then
  re-reads its field. Not changed here.

### Pinned by

- `tests/a-sit-and-go-is-unregistered-until-it-actually-starts.law.test.ts`
  (`docs/laws.d/` file of the same name): applies the migration's anchored
  edits to the newest recorded body of each function and asserts the rule, the
  lock order, the unchanged refund path and that no later migration replaces
  these functions without it.
- `scripts/dev/prove-sit-and-go-unregister-start-gate.sh`: installs the
  recorded function text over stub tables on a throwaway local PostgreSQL,
  reproduces `tournament_started` for the nine seat board, installs the
  migration byte for byte and shows the gate open, with every other format
  answering as before. It exercises the start gate only; the refund path is not
  executed there and was not run against any real database.

## 2. Register and Unregister were different buttons, and Unregister was cut off

### Cause

`TournamentDetails.tsx` printed Register on the painted plate
(`TournamentRegisterButton`) and Unregister as `<button class="btn
btn-unregister">`, a red outline drawn in CSS. In the header the action box was
capped at `max-width: 55%` (197px on a 390px phone). The Invite plate is 144px;
the generic rule `.details-header__actions button { flex: 1 1 0; min-width: 0 }`
gave Unregister the 47px that was left, and its label ran out of the box and
past the screen edge. Measured headless before the fix at 390px: Invite 144px,
Unregister 47px. The footer offered no Unregister at all.

### Why and how it broke

The plate arrived on 2026-10-18 for Register and on later dates for Late
Register, Watch and Invite; Unregister was never moved onto it. When Invite To
Game joined the header, the one remaining shrinkable button was the one that
gave way.

### Fix (client)

Unregister prints on the Register plate with the Register class, in the header
and the footer, with the same ink; its own CSS rule draws no outline, fill or
red. Under 768px the header actions own a whole line (they already wrapped
below the status and ID) so two plates sit side by side at their painted 144px
and wrap rather than clip. Measured headless after the fix at 320, 360, 375,
390, 393 and 430px, with and without the popup close button: Register and
Unregister are 144x48 in the header and identical in the footer, nothing
crosses either screen edge, and the page has no horizontal scroll. At 320px the
two header plates stack.

### Pinned by

`tests/register-and-unregister-are-one-button.law.test.ts` and its
`docs/laws.d/` file.

## Not verified

- The migration has not been applied to any database; its anchors are checked
  against the recorded migration text, not production's live definitions. If
  production differs, the file aborts without changing anything.
- The header was measured in a static headless render of the real CSS and
  markup, not in the running app, so the label fitting done in JavaScript
  (`useFitText`) was not exercised there.
