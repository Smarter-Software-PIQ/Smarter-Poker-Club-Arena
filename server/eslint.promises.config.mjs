/**
 * ONE TABLE'S ASYNC FAILURE IS NEVER THE PROCESS'S (2026-11-26).
 *
 * server/src/index.ts treats an unhandledRejection as fatal: the engine drains
 * and restarts, and every hand in flight on every table is voided. That policy
 * is deliberate (see the 2026-08-15 note above `fatal` in index.ts), so the
 * only safe engine is one where no promise can be dropped by accident.
 *
 * This config is the build gate for that. It runs two type-aware rules over
 * the engine source and nothing else, so it stays fast and never argues with
 * the client lint:
 *
 *   - no-floating-promises: a promise must be awaited, returned, given a
 *     .catch, or marked `void` on purpose. `void` is the reviewer's signal that
 *     the call cannot reject or that its rejection is observed elsewhere.
 *   - no-misused-promises: an async function must not be handed to a caller
 *     that ignores its result (an event listener, a timer, a request listener)
 *     unless it catches its own errors.
 *
 * Run it with `npm run lint:engine-promises` from the repository root. CI runs
 * it in "TypeScript compilation and repository checks".
 */
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/*.test.ts',
      '**/*.test-support.ts',
      '**/__tests__/**',
      '**/dist/**',
      '**/node_modules/**',
    ],
  },
  {
    files: ['src/**/*.ts'],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksConditionals: false, checksSpreads: false },
      ],
    },
  },
)
