# Visible Table Avatars Load Immediately

Post-deploy mobile WebKit continuity caught all nine opponent portraits missing
through natural hands and reconnect, then appearing together when the viewport
changed. The retained trace shows the live felt before and after that resize.
SeatSlot had marked every opponent portrait lazy even on the visible spectator
table, where there is no eager hero.

TablePage now requests avatars eagerly on visible tables and leaves hidden
retained tables lazy. The seat memo comparison carries visibility admission
through to an already mounted portrait; hero and Lightning arrival overrides
remain eager. No game, roster, chip, account or engine rules change.

Regression checks cover visible spectator admission, hidden-to-visible memo
updates and the existing hero override. The maintained Horse seat continuity
witness remains strict and must pass against the published client.
