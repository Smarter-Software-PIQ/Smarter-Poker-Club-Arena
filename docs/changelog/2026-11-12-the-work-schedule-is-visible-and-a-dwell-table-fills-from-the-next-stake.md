# The work schedule is visible, and a dwell table fills from the next stake (2026-11-12)

Owner order (Dan, 2026-11-12 16:53 Chicago): build, fix and enhance the follow-ups
to the cash relaunch (#10607), fully wired in and tested.

- `/health` carries `horseWorkSchedule`: off-duty leaves by reason (rest day,
  daily cap, off shift), leaves deferred by HIT AND RUN or the big-pot orbit,
  seat calls an off-duty horse let lapse, waiting-list rows cancelled for an
  off-duty horse, and the fleet's latest census: seating refusals by reason and,
  per host, eligible cash bodies, how many are on duty and the occupancy target.
  Counts only, no identities; a diagnostic that never moves routing.
- The on-duty supply in that census is the measure of whether the work schedule,
  rather than the tripled occupancy target, limits the floor.
- A table inside its 20-30 minute post-human dwell with fewer than four seated
  waives only the horse's preferred-stake tag, as a person short at a table
  already does, so on-duty horses who usually play a neighbouring stake keep the
  game going. Work hours, rest day, daily cap, variant, merit band, bankroll and
  club still apply.
- `StableHand.forceLeaveReason` and `SMALL_WIN_OK` (never called) are removed.
- The uncapped-tick drift law also catches the older `'public.fn'::regproc`
  spelling.

Not in this change, on purpose: dropping the capped tick
(`fn_cash_cluster_tick(uuid,integer)`, `fn_cash_clusters_tick_all(jsonb)`) and
the second/third-table pickers. The serving engine still calls them, so they are
retired only after an engine containing #10607 has served past its rollback
horizon.
