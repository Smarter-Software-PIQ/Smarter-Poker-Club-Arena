# server/src/engine/aRuntimeSourceImportsOnlyEmittedJson.law.test.ts

A Runtime Engine Source (Every server/src TypeScript File That Is Not A Test, Including Fixtures And Test-Support Modules) Imports A JSON File Only When server/tsconfig.emit.json Emits It, And The Emit List Names No JSON File That Nothing Imports, So The Engine Image Never Ships Without A File The Typechecked Build Carries (engine-build-resource-proof, Read From The Source In The Local Gate, 2026-11-20).
