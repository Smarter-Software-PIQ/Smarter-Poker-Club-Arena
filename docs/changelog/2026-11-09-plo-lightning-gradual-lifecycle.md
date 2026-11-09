# 1/2 PLO Lightning grows through its feeder

The canonical 1/2 PLO game starts with a funded heads-up opponent, then admits
Horses individually. Its existing seat transaction holds a durable per-game
admission deadline; concurrent fills, offered seats and restarted workers share
it. Deadlines start from each successful admission, so delayed work cannot
catch up in a burst. Ready participants, pending holds and hand reservations
count once per player. Occupied rebuy, sit-out and disconnected chairs retain
their slot until the original participant leaves, so an ordinary return cannot
follow an extra admission past ten. Humans keep normal access to available seats.

The owner specified ten eligible participants for Lightning activation. This
scoped ruleset uses ON10/OFF4 and restores population-driven conversion instead
of forcing an empty pool always on. Five is the supported hand minimum; below
that, the original settlement barrier returns play to the feeder. The original
physical table owners allow heads-up dealing for this game. A lone human's
actual table receives the first opponent before another empty feeder can.

From one human, the first Horse establishes heads-up play; eight further
individual admissions reach ten. The maintained30second fleet tick and70–90
second admission deadlines target roughly12–14minutes including the existing
conversion dwell. Funding/eligibility failures and delayed execution can extend
that target; they never authorize a batch admission or count unready players.

A human departure no longer turns admission policy into a mass exit order for
existing Horse sessions. Normal bankroll, tournament, session, waitlist and
hand-boundary departure rules remain authoritative; valid remaining play
continues. No new scheduler, balance adjustment or alternate cash-out exists.

Migration20261109141301 uses ordinary protected-main installation. The engine
change requires exact Backup qualification and the maintained production release
route. Local qualification and actual installation, engine adoption, seal/thaw,
measured production startup and post-departure play are recorded separately in
CHECKPOINT-plo-lightning-lifecycle.md. This source record is not a live claim.
