# Keep visible table audio awake

The table sound service suspended its own running AudioContext after twenty seconds without a cue, including during visible play. Read-only observation found the context suspended while Sounds stayed enabled, master volume stayed at one, and hands continued. The reported desktop/iPad recovery used device volume controls; this observation does not establish a device-specific operating-system cause.

Idle suspension now applies only while the document is hidden. A visibility change cancels the old deadline and arms a background deadline when appropriate. Returning to visible play retains the existing resume and gesture handling. Saved mute and volume choices are unchanged.

Two regressions failed before the source correction: a quiet visible interval after a level-up cue, and return to the foreground before a background deadline. All three continuity cases and the existing sound service, audio session and volume suites pass (29 tests). These use a controlled Web Audio implementation; exact published identity and affected real-browser behavior remain separate requirements.
