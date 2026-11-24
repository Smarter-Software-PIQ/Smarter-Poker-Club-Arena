# The engine compile fits its memory bound with headroom

The engine image is compiled in the bounded builder by one step,
`node --max-old-space-size=1024 ./node_modules/typescript/bin/tsc --project tsconfig.emit.json` (`noCheck`,
`noResolve`). On 2026-11-24 main needed about 1001 MiB of that 1024 MiB heap (bisected on the same command), and
about 100 KB of new engine source (#11913) took it past the bound: the "Compile the engine and contain a real build
OOM" job died near 1010 MiB on every engine pull request that added code.

Where the memory went (TypeScript 5.9.3, 1,328 files, 602,167 lines, 2.72 million syntax nodes): parsing held
about 500 MiB and binding about 120 MiB more, and the emit itself kept about 376 MiB on top. Without
`isolatedModules`, the TypeScript transform asks the checker for the constant value of every property and element
access so it can inline `const enum` members, and the checker type-checks each of those expressions to resolve it:
144,161 types and 210,065 instantiations were created during an emit that is told not to check, and their node
links stayed alive to the end. The data tables and source maps were not the cause (source maps off saved about
15 MiB; emptying #11913's tables saved nothing).

`server/tsconfig.runtime.json` now sets `isolatedModules: true` (the emit project inherits it). The emit no longer
consults the checker for constants: 1,010 types, 0 instantiations, and the bisected heap need falls from about
1001 MiB to 788 MiB, 236 MiB under the bound. The full typecheck of the runtime project passes with the option on
(0 errors), so the reference build that the resource proof compares with the image keeps matching it.

The program had one `const enum`, `HoldemLineBucket` in `HorseHoldemValueAndCallsArePriced.ts`; it is now a plain
`enum` with the same members and values. Its file is the only emitted file that changes (the enum object is
emitted and its members are read from it instead of inlined); the other 1,267 emitted JavaScript files and their
source maps are byte-identical to main.

A new step in the same CI job, `scripts/ci/engine-emit-heap-headroom.mjs`, runs the exact emit with the Dockerfile's
compiler heap minus 100 MiB. If the emit cannot finish there, the step fails with the bound, the observed peak and
the largest program files, before a release build runs out of memory. Run against main's configuration it fails
(peak 919 MiB at a 924 MiB limit); with this change it passes. The bound itself is unchanged.
