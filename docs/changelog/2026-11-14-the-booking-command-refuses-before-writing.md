# The booking command refuses before writing

Independent review of #10806 found two places where the command could leave a partly written tree. It accepted window ids up to 80 characters while the runtime floor refuses ids longer than 64, so a long id wrote all fourteen files and only then failed the floor suite; the id rule now matches the runtime. And the write loop wrote files one by one, so an error part way (disk full, a read-only file) left the earlier files changed; every file is now staged beside its target and renamed into place, and any failure restores every original and removes every created file before refusing. Both are pinned in `tests/operations/book-owner-engine-window.test.py`.

## Review follow-up

- A booking keeps each edited file's mode, so the two tracked-executable release scripts stay executable.
- A failure or interrupt at any point (reading, staging, renaming) restores every replaced file through its own atomic rename, removes every created file and temp, and re-raises an interrupt after cleaning up.
- If a restore itself cannot complete, the command prints `FAILED, the tree is PARTLY WRITTEN` with each file it could not undo and exits 1, instead of claiming nothing was written.
- Three new tests pin the mode, a failure while staging, and a restore that cannot complete.
