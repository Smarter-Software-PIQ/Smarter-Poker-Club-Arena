# Horses get a daily scorecard, and a complaint becomes an exact replay

Club Arena horse brain, Phase 5 of 6 of the Horse NLH and Omaha Improvement
Program, 2026-11-05.

## What this adds

**A daily scorecard you can run read-only.** For any UTC day, the horse
measurement kit now prints a short list of read-only statements to run
through the database console: one "core" statement for the whole day plus
small time slices for the heavier cells. The core statement reports, per game
and format (cash or tournament): whether the brain's telemetry is alive (the
decide counters), whether every upgrade receipt fired that day (including the
new Hybrid v1 cash and tournament profiles and the cash 3-bet size), how
often a horse 4-bet and then folded, and how horses and people did against
each other in hands where a person was seated. The slices cover the top-pair
call cells (V79/V80), the Omaha call cells (V81) and tournament reshoves. An
assembler turns the saved results into one JSON file and one readable report,
with confidence intervals counted per hand and a coverage section that says
plainly when a slice is missing. Measured on 2026-11-04: the core statement
runs in seconds for the whole day.

**A complaint becomes an exact replay in minutes.** Given a hand id (or a
table and a time) and what was said, the kit extracts the hand read-only, and
a replay script rebuilds the exact table state at every decision a horse made
in it, runs today's brain there for the live Hybrid profile and every base
style over fixed seeds, and reports whether today's brain still makes the
action complained about, which brain rule fired, and which scorecard cell the
spot belongs to with its measured value. A person's cards are never
extracted; fixtures keep seat numbers only.

**Each confirmed complaint becomes a permanent law.** One command turns the
hand into an anonymised fixture and a law test from a template, so the brain
can never again take the complained-about path in that exact spot. The first
one is the Phase 3 QQ hand (4-bet from the big blind, then a fold to the
deeper opener's jam): today's brain takes that path in no profile and no seed.

## What did not change

Nothing in the engine, the release files or the database. Every statement is
a single SELECT, checked by the kit's read-only guard and its tests. The
daily delivery (dashboard and scheduled run) is the next step and is not in
this change.
