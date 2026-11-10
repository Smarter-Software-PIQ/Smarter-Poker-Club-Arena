# Run-it decisions keep their ten-second clock

Optional run-once/twice/three-times offers have one ten-second server deadline. Unanimous consent records the agreed count immediately, but its completion announcement and board runout wait for that deadline. An explicit participant decline or chooser Run Once still ends the offer early. Mandatory table modes are unchanged.

The client opens the existing consent panel immediately instead of consuming part of the clock in an animation-speed-scaled opening delay. It continues to honor the serving engine's deadline, including older engines during client rollout. Payout and board evaluation logic are unchanged.

Regression coverage exercises the real decision scheduler and host runout wait for both consent orders, two/three runs, no response, early refusal, and a weekly pause. The client law executes the real offer handler and checks immediate controls and legacy-engine compatibility. Source, protected merge, client publication and certified engine adoption are separate delivery states; the owning checkpoint records their evidence.
