# Club Data: explanations live behind a "?" (2026-11-15)

Dan, on the KINGS CLUB Data page: "REMOVE ALL OF THIS TEXT FONT AND
DESCRIPTION FROM THE DATA PAGE ... OR ADD IT TO A ? MARK ICON ... NEVER
DISPLAY ANYTHING LIKE THIS ON ANY PAGE EVER!"

What changed:

- New `src/components/club/DataHelpTip.tsx`: a small "?" (native
  `<details>`) that opens a panel. Closed by default. The "?" turns red when
  a note inside it is an incomplete-data warning.
- `/clubs/:club/data` (ClubDataSimplePage): the day rule, Union Invoice
  Basis paragraph, provisional and incomplete notices, downline-fee notes,
  net-money-flow notes, "Figures Begin", and the date-picker window sentence
  moved behind one "?" beside the Live line. Labels shortened to
  "Unfinished MTT Entries" and "On The Felt Now".
- `/clubs/:club/data/advanced` (ClubDataPage): the same notes, the Agent Rake
  Production note and the player-list footnote moved behind "?" icons; the
  "(Not Added)" and long Unfinished MTT label removed.

Rule going forward: no explanatory or methodology paragraph prints on any
page. Put it behind a DataHelpTip or delete it.
