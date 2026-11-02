# Effective engine capacity evidence

The existing manual, read-only runtime incident reader now includes numeric host memory availability, Docker memory/CPU/PID configuration, process file/process limits, and engine-volume free bytes/inodes. For the inspected container's exact supported cgroup v2 path it reads the leaf and both ancestors, including memory/swap/PID limits, current usage and memory pressure counters. A parent limit can constrain a container whose own limit says `max`.

All fields are allowlisted and bounded. Missing reads remain null, zero remains zero, unsupported cgroup layouts remain unknown, and membership changes discard the cgroup sample. The existing container identity/start bookends and four-second subprocess budget remain in force. No environment, command line, arbitrary path, core contents, restart or production mutation is added. A stopped container retains its previous exit-only evidence.

The maintained native fixture executes the actual host collector against controlled proc/cgroup contents, verifies ancestor limits, changed membership, unrelated container rejection and output redaction, and remains invoked by the existing required test wrapper. This is capacity evidence, not a memory-leak repair or a claim that the runtime has been upgraded. Production readback is required separately.
