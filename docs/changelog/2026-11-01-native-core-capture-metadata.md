# Native core capture metadata in the existing restart observation

A retained engine Docker die event now proves exit 139 at 06:48 UTC, but the existing systemd-coredump read found no records. Absence of those records does not establish that core capture is disabled or that no file exists.

The existing fixed four-second container observation now also classifies the host core pattern and reads explicit Docker core limits plus the current container process's core limits. It uses two one-second Docker metadata reads to verify the same full container identity, process ID and start time. No environment, arguments, core contents, arbitrary paths or native inventory are read or exported. All five original restart sources and their four-second budgets remain unchanged.

Only the exact `core` pattern with `core_uses_pid=0` and the maintained image's fixed `/app` working directory permits a candidate metadata check. The app directory must open with `O_NOFOLLOW`, and the candidate is inspected without following symlinks. A regular file exposes bounded size, modification time and its relation to the incident window. Other patterns, missing access and unreadable identity remain unknown. Candidate metadata does not prove that the file belongs to the incident. Current process limits do not describe the crashed process.

This changes observation only. It does not enable core capture, alter runtime state, attach a debugger, signal a process, repair the restart cause or certify a release.
