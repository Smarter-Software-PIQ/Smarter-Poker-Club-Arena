# Folded mobile portraits keep their full artwork

The live WebKit proof after #10725 exposed clipped folded portraits: filtering and fading the smaller avatar wrapper cropped its enlarged descendant. Portrait phones now apply fold opacity to the painted image, leaving the wrapper unfiltered. Existing image dimming, actions, cards and player panels remain intact.

The live layout matrix now creates four fresh phone contexts with matching screen and viewport dimensions (320, 375, 393 and 430px). Resizing a fixed 393px iPhone screen after the table captured its stable 600px canvas produced an invalid 430px device and stale height. Both occupied six- and nine-seat tables remain mandatory at every size. Existing hand/reconnect witnesses retain their device geometry.

Regression coverage checks folded parent compositing, complete cards and unobstructed player plates, including the real waiting-list control. Production measurements also reject bottom-control overlap and clipping fold groups. Source previews are separate from the required post-publication live screenshots.
