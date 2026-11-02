# Desktop sticky catalogue verification

Live run 41415306289 passed the phone family reopen and sticky rail checks, then passed the expanded desktop frame geometry. Its next step incorrectly retained the phone-only `lobby-game-row` test selector after resizing, so it never reached the desktop scroll assertion. The live screenshot confirms the desktop cash rows are present.

The desktop segment now selects the actual visible `.lobby-table` cash rows, requires more than one row, scrolls their first and last rows natively, and retains the positive inner catalogue `scrollTop`, rail visibility, painted frame, registration ink and screenshot assertions. The phone selector, ten-second action deadlines, one-case scope, zero retries, 77 source pins, stable deployment identity and isolated-account cleanup stay unchanged. No product runtime, artwork or publication workflow changes.
