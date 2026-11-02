# Action badges reserve their resting space

The wager allocator now reserves the permanent action badge border box while its pop-in animation plays. Both obstacle readers derive that box from the existing fractional layout coordinates, individual translate and table scale, rather than its temporary animated transform. This prevents an admitted wager from overlapping the badge when the animation finishes. Existing artwork, animations and landed wager retention remain unchanged.

The regression uses the failing native 480px nine-seat geometry and authored animation poses. It proves the old reader can admit that three-pixel resting collision, then checks the permanent projection across poses and table scales. It does not claim the retained trace recorded the original allocation pose. Required browser geometry qualification remains necessary on this candidate.
