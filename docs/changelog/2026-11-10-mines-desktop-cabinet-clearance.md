# Mines Desktop Cabinet Clearance

The sculpted Mines vault covered the lower board on 1280px screens. Cap the desktop vault at its 620px presentation width and reserve its height when sizing the board. Phone and short-landscape layouts retain their existing rules.

The existing real-page browser regression now checks complete board clearance and every actionable tile center at desktop heights 800, 844 and 900. Previously revealed tiles retain their intentional pointer refusal. The added clearance check failed against the published layout and passes with the source correction.

The same final review found the wide Crash cockpit covering the flight and its Auto value overlapping its label. The flight now sizes to available desktop height, while the value stays in the label/value flow with the full bay retained as its touch target. The existing launch/cashout browser case checks both clearances.
