# Explain a natural-board UNKNOWN with bounded public wire counts

Live41358918407 sampled3219 eligible DOM frames with no3-card or4-card board,
so no same-hand turn/river receipt could be admitted. Its receipt lacked public
street-event counts and could not distinguish absent natural streets from a
wire-to-DOM gap. That observation does not establish a rendering or engine defect.

The existing journal now supplies closed aggregate snapshot/subscription/replay,
board-shape and natural single-board street counts. Same-hand event co-occurrence
is counted separately; it never substitutes for DOM reveal acceptance. The export
contains no card values, hand IDs, user IDs, raw payloads or timestamps. Work is
bounded to8192 frames and128 hand groups with explicit truncation flags.

Natural acceptance, timing,120-second observation, transport/refusal rules and
account cleanup remain unchanged. Three focused regressions cover informative
UNKNOWN, privacy, replay/foreign/malformed/multiple-board exclusion and bounds.
No production retry or new live operation was performed by this source change.
