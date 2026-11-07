# Financial Admin verification admits the maintenance state read

The global shell calls `fn_maintenance_break_state()` to display the current break. The Financial Admin guard blocked this POST in run 42338748197. The installed SQL reads the break and active release boundary, including the clock. The guard now forwards this exact RPC with an empty argument object or no body. The guard records attempts with arguments, malformed payloads, lookalike paths and write methods as violations.
