# Give the original Inspector read its full allowance

The read-only observation for failed release `41927652583` exhausted its shared
18-second deadline while reading the original endpoint's bounded log interval
(`41931755859`, `inspector_history: command_deadline`). It established neither
closure nor ownership, so another activation could not treat it as cleanup proof.

The owner's November 4 fourfold timing instruction increases only the
`legacy_checkpoint_inspector` observation to 72 seconds and its enclosing SSH
transport to 120 seconds. The existing observation job allows four minutes for
checkout, its required native reader tests, the read and artifact retention.
Every other reader mode retains its 30-second transport allowance. The exact
original operation, endpoint and identity bookends, read-only operations, byte
bounds, typed refusal and unknown outcomes are unchanged.

The maintained regression exercises the actual Inspector reader's common
deadline through history, both native probes and both identity bookends, plus
the actual local transport entry point. It also preserves the ordinary reader's
30-second bound. This delivery does not extend the engine census or certify any
engine activation; that connected maintenance change is separate.
