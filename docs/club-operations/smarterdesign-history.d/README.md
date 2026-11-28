# #SmarterDesign batch history: one file per batch

Dan, 2026-11-27, on the bottom of Player Management: "NO DO NOT USE THOSE
BULKY FRAMES, THATS THE OLD STYLE... USE THE #SMARTERDESIGN STYLE".

Each file here records what one #SmarterDesign batch converted and why. It is
history, not the current state: the current state of every routed page is
printed from the code by `node scripts/smarterdesign-inventory.mjs`, and the
pages that read as converted are held by the ratchet in
[`../smarterdesign.d/`](../smarterdesign.d/README.md).

Read the whole history in order (by date, then by file name):

```bash
node scripts/smarterdesign-history.mjs
```

## Adding your batch

**One new file per batch. Never edit another batch's file or a shared document.**

    docs/club-operations/smarterdesign-history.d/YYYY-MM-DD-<batch>.md

- `<batch>` is lowercase letters, digits and hyphens: `2026-11-29-p7-friends-and-vip.md`.
- The first line is the batch heading at level two: `## Batch P7: Friends and VIP`.
- Then the same content the batches before you wrote: a table of surface, file
  and what changed, what was pinned, and what was left alone and why.

Two lanes that each add their own file can never conflict, which is the whole
idea (the same rule as `docs/changelog/README.md`).
`tests/the-smarterdesign-history-is-one-file-per-batch.law.test.ts` refuses a
malformed name or heading, conflict markers, and the retired shared file.

Until 2026-11-28 this history was one file, `SMARTERDESIGN-HISTORY.md`, that
every batch appended to, so every merge to main made every other open lane
conflict on its last line. Its content was split into the dated files here,
section for section, and the file was removed.
