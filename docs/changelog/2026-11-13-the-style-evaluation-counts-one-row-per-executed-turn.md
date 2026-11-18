# The style evaluation counts one row per executed turn

The offline tool that re-runs journaled Horse decisions with each style option on and off (the input to the
pre-registered style evaluation) counted some decisions twice. A fast decision and its deep second look are two
requests of one turn, but the journal's turn key includes the request id, so the two never shared a key, and the tool
marked both as executed whenever a witness existed. A turn with a second look therefore counted twice toward the
30-changed-decisions bar and the value interval, and a retired decision counted as executed.

Found by independent review before any evaluation data was opened. The tool now writes a lane-independent
`turn_identity` (generation, fence, decision key and decision time), takes `executed` from the witness's own status
(executed, not executed, unknown) and adds `execution_status`. The journal copy is read as a stream, so a full day
works; a count argument that is not a positive whole number is an error; output files are owner-only. New tests use
the journal's real fast and deep records of one turn and a row produced through the real exact replay.

Offline tooling only: no Horse decision changes, and every style option is still off.
