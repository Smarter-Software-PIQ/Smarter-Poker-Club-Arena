# tests/the-install-watch-hour-starts-when-the-dispatcher-may-send.law.test.ts

The merged-migration install watch's hour runs from the dispatcher's first admitted send: the SQL release schema freeze (ca_release_schema_freeze_holds, 23:45-04:15 Central) must equal RELEASE_SCHEMA_FREEZE_CHICAGO, a fix in place restarts the hour and re-pages under its own key, and a page inside the freeze never says to hand-dispatch (2026-11-19, incident dc479141, alert 445153).
