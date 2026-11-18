# Hand detail header and hole-card order

The Hand Detail header now prints the game name below the title on the left and the hand number on the right, without the painted number frame. Its text bands fit their line heights at phone and desktop widths; the original crest and outer rails remain.

Summary, detail, own-card and reveal rows reuse the hero's high-to-low card sorting helper. Sorting copies the visible array and highlights still follow card identity. Board chronology and made-hand grouping remain intact.

Regression coverage renders the real hand-history adapter and modal through both tabs, checks PLO5 card order and played-card highlights, and verifies the source record stays unchanged. Local renders cover 375, 393, 430 and 1024 pixels; delivery evidence lives in this task's SSD2 checkpoint.
