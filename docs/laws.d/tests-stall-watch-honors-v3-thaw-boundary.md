# tests/stall-watch-honors-v3-thaw-boundary.law.test.ts

Guards that `fn_ca_table_stall_watch_tick` and `fn_ca_table_stall_watch_ingest` honor bounded complete v3 maintenance thaws (`engine_maintenance_thaws`) and refresh `v_now` after the HTTP `/metrics` scrape so tables resuming cleanly from combined breaks never fire false `TableStoppedDealing` alerts (incident 6684eba0).
