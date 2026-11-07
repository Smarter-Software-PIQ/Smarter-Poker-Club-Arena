# tests/a-file-url-is-decoded-before-it-is-a-path.law.test.ts

Every tracked script and test turns a file URL into a path with fileURLToPath and a path into a URL with pathToFileURL, never by hand (`new URL(...).pathname`, a hand-built `file://` string or a stripped `import.meta.url`), so a worktree whose path contains a space - such as `/Volumes/SmarterWork 1` - runs every pre-push check instead of crashing or silently checking nothing.
