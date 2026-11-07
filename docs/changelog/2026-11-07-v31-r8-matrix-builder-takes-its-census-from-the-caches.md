# V31 R8: the public215 matrix builder takes its census from the caches

`server/src/scripts/buildPublicHist215Features.ts` builds the public feature matrices
that every public215 model is trained on. It refused anything but R7's census: 107
contexts, 57 boards per context, 6,099 targets, written as constants in five places
(cache header check, cache row count, request context count, per-context board count,
the global domain check) and in the index it writes (`source_count`, `context_count`).

R8 is 100 cash contexts x 57 boards = 5,700 targets, so the R8 matrices could not be
built without editing the builder.

Now the census comes from the public WTL caches themselves. Each cache header already
states `contexts`, `boards_per_context`, `planned_targets` and `completed_targets`;
`public215CacheCensus` accepts them only when planned = completed = contexts x boards,
boards per context is 57 (three folds of 19, unchanged), and the current and terminal
caches agree. Every later check (rows per cache, contexts in the request, boards per
context group, the global exact target/context domain) and the written index use that
census. R7's caches state 107 x 57 = 6,099, so R7 builds exactly as before.

Test: `public215CacheCensus` accepts R7 (107 x 57) and R8 (100 x 57) and refuses a
mixed count, an incomplete batch, a board count other than 57, zero and fractional
counts.
