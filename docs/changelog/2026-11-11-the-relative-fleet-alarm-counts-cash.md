# The relative fleet alarm counts cash, not tournaments (2026-11-11)

Incident 71fdf977 (HorseFleetThroughputRelativeDrop) was still the only
critical alert firing at 14:55Z after #10500 deployed.

The rule compared table-engine hands plus Lightning hands with the same hour
on the previous six days. Table-engine hands are mostly tournament hands, and
the seat-first ladder (Dan, 2026-11-08) cut Spin and Sit & Go starts from about
11,000 a day to about 110. The days before 2026-11-10 therefore carry tournament
volume the room no longer plays. That gave 2.22/s against a threshold of 2.84,
while the cash floor was flat: 134,852 to 143,913 cash hands a day on
2026-11-07..10.

The rule now reads settled Lightning hands, which make up the cash floor
(1.1-1.9/s all week; the table engines deal about 0.1 cash hands/s). The
baseline floor drops from 2/s to 0.5/s. Replayed over the previous three days,
it would have fired only 2026-11-10 06:38-09:48Z, which was a real cash dip.
The ratio at 15:00Z was 1.85. promtool fixtures cover the production shape and
every earlier scenario.
