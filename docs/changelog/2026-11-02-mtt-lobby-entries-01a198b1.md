# MTT Lobby Entries And Matching Typography

The tournament lobby previously displayed the remaining field under Players, which fell as players were eliminated. It now labels that figure Entries and reads initial registrations plus every recorded rebuy/re-entry from one bounded database aggregate. Add-ons do not add entries. The remaining-player count is preserved for admission and other gameplay decisions.

Existing committed tournament updates refresh the aggregate, including rebuy prize-pool updates. Hidden-tab recovery and returning online refresh it too. Failed or incomplete reads never substitute the remaining field; a new unreadable count displays an ellipsis, and a retained count identifies itself as Last Known Entries. Superseded responses cannot replace the current board. No new polling loop or per-tournament roster download is introduced.

Buy-In and Entries share the same label and value font sizes, spacing and vertical alignment in the approved painted card. The separate count-column overrides caused the mismatch and were removed. A real-font 393px browser render verified identical label sizes and number positions on three cards.

Validation: focused client tests cover rebuy refresh, elimination stability, stale response rejection, failed/incomplete reads and unchanged-render request suppression. The required PostgreSQL accounting workflow runs the actual migration against disposable PG17 with entry arithmetic, empty fields, duplicate IDs, ACL, RLS and input bounds checks. Production installation, publication and live readback must be recorded separately in the task checkpoint.
