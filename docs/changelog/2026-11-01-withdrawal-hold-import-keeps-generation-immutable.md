# Withdrawal hold imports preserve the immutable generation

The cancellation announcement predicate imports the pinned generation's real
Lightning hold reader. Python can create a generation-local `__pycache__` during
that import even though the helper is used only to read custody. The local
workflow's `-B` option does not propagate to its separate remote Python process.
The hold-reader import now temporarily disables bytecode and restores the prior
flag in `finally`, including when importing fails. Selection, custody reads,
cancellation admission and release behavior are unchanged.

The existing isolated E9 announcement fixture now executes the actual pinned
hold source through the actual announcement predicate, inside an exact
manifest inventory containing the required core files. With bytecode initially
enabled, the old implementation creates an extra cache directory on both the
success and import-error paths (two failing matrix cells). The correction keeps
the inventory and file bytes unchanged for both initial flag values and both
outcomes. Database thaw and external command boundaries remain isolated.

This is generic source prevention. It does not establish that this import caused
production intake 41316608416 to fail, and includes no host cleanup or retry.
The separate own-thaw import prevention remains with its existing PR9161 owner.

Validation: withdrawal Python suite 43 total, 42 passed and one existing
Linux-only skip on Darwin; RED evidence retained separately from GREEN.
