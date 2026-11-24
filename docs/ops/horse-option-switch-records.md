# Horse option switch records

A live switch write and its records are one step. Since 2026-11-24 the records PR comes from the tool.

## What the records are

- `docs/horse-option-switch-state.json`: the committed copy of `public.ca_horse_style_switch`.
- Each option's authority doc under `docs/horse-option-authority.d/`, through its machine-read
  `**State: ...**` token.

`tests/an-authority-doc-states-the-live-switch.law.test.ts` fails when a doc's State disagrees with the
committed snapshot, and when an option with a live row has a doc whose State it cannot read. CI never
reads the database, so the law is only as current as the committed snapshot.

## Why the tool opens the PR

On 2026-11-24 `cashDefenceTrimColdCalls` was switched on (audit #193) through a private wrapper that calls
the switch RPCs directly. Hours later its doc still said "default OFF" and the committed snapshot still
held audit max 189, so the law stayed green while production differed. Nothing made anyone commit the
records.

## How it works now

- `node scripts/ops/horse-option-switch.mjs set ...` opens the records PR itself after every verified
  write. Dry runs and refused writes open nothing. `--no-records-pr` skips it.
- `node scripts/ops/horse-option-switch.mjs records` opens it on demand. **A lane that writes the switch
  through its own wrapper runs this after its read-back.** `records --dry-run` prints what it would change,
  judged against the current checkout, and writes nothing.

The PR is built in a throwaway worktree of `origin/main` (under `$CA_RECORDS_ROOT`, else `$TMPDIR`), so it
judges main and not the operator's branch:

- the snapshot rewritten from the live rows (a read-only query);
- every authority doc whose State disagrees, with only its State token rewritten. The literal
  `Evidence MET` or `Evidence NOT MET` clause inside that token is kept word for word, because
  `holdem-blanket-scoreboard-lib.mjs` and the activation tools parse it;
- one commit, pushed with `scripts/agent-push.sh`, then `gh pr create`. The URL is printed.

It never guesses. An option whose release default is ON with no row, or a doc whose State token cannot be
rewritten safely, is listed in the PR body as needing a person.

The records PR never changes the switch. If it cannot be opened, the switch write stands, nothing is
retried, and the tool prints the one command that finishes it: `node scripts/ops/horse-option-switch.mjs records`.
