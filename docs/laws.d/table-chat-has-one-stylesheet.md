# tests/table-chat-has-one-stylesheet.law.test.ts

Only `src/components/table/TableChat.css` may style the `.table-chat` sheet (the zero-specificity popup chassis may paint it, never place or move it), and the sheet must be on screen at rest: no resting translate, no reliance on `animation-fill-mode`, and its entry keyframes end in place. A second, April-era rule in TablePage.css parked the open chat off screen once stylesheet order flipped on 2026-11-15, and no human could send a table chat message for four days.
