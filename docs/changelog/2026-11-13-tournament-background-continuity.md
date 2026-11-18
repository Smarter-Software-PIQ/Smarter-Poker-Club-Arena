# Tournament Background Continuity

The shared data-table stylesheet used the same `.table-container` class as
the poker scene. Its translucent fill, border and backdrop blur leaked into
gameplay while the transparent tournament dock showed the unfiltered room,
creating a horizontal seam behind the tournament information panel.

Namespace the wrapper used by `Table` and `SimpleTable` as
`.data-table-container`. The selected room now remains one continuous
background, and data tables retain their existing styling. Gameplay layout,
tournament controls and approved artwork are unchanged.

Regression coverage renders both shared components and checks stylesheet
selector matching against the gameplay container and tournament dock. Both
cases fail against the original source. Client-only delivery uses the existing
protected merge and static publisher; no engine replacement is required.
