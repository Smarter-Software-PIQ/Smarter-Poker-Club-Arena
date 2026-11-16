# Full Tournament Blind Structure

The shared tournament lobby Blinds tab now lists every published blind level with small/big blinds, ante and level duration. MTTs, Spins, Sit & Gos and satellites use the same tab and normalized structure; there is no fixed 50-level cutoff.

Existing current/next panels, committed current amounts, clock anchors and break subscriptions remain intact. The schedule highlights current and next rows, identifies the final configured entry/rebuy levels, and displays late registration and optional add-on timing through the existing entry-terms reader. Minute-based entry limits stay explicit rather than being converted into a guessed level.

Validation: 185 focused assertions passed, including nine new schedule cases; eight schedule assertions fail against the original implementation. TypeScript app check and all four copy gates passed. A real Chromium preview at 393px showed the complete table and highlights without horizontal overflow. Publication and production evidence are recorded in the owning task checkpoint.
