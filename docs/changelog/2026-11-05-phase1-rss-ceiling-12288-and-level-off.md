# Phase 1 memory ceiling raised to 12 GB, and memory must level off

The post-release certification checker failed any 15-minute resource window
above 8,192 MB of process memory. Measured on the November 5 release, the
eight horse-decision workers keep bounded per-opponent memories that settle
around 8.5 GB or more, so the old ceiling could never be met at any uptime.
The server has ample headroom and there was no restart or out-of-memory event.

Dan decided: "Raise the Phase 1 RSS ceiling to 12288 MB and require it to
level off".

The checker now fails a window above 12,288 MB, and also fails unless memory is
leveling off: across the second half of the window, from at least eight
samples, process memory may rise by no more than 2 MB per active minute. A
window that is still climbing, like the November 5 window at about 17 MB per
minute, does not pass. The 2,048 MB heap ceiling is unchanged.
