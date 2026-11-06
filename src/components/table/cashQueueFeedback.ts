/** Server-owned eligibility, printed in the existing waiting-list surface. */
export function cashQueueFeedback(reason: string | null | undefined): string | null {
  switch (reason) {
    case 'insufficient_funds':
      return 'Your Balance Is Below The Entry Amount. Add Funds To Receive A Seat Offer. Your Queue Place Is Kept.';
    case 'offer_limit':
      return 'You Already Have A Seat Offer. Complete That Buy-In Before Receiving Another Offer.';
    case 'expired':
      return 'Your Waiting List Entry Has Expired. Join Game Again To Request A Seat.';
    case 'seat_reserved':
      return 'A Seat Is Reserved For You. Complete Your Buy-In Before The Countdown Ends.';
    case 'seat_available':
      return 'A Seat Is Available. Select Join Game To Confirm Your Admission.';
    case 'table_opening':
      return 'Waiting For The Game To Open A Table.';
    case 'game_closed':
      return 'This Game Is Not Taking Players Right Now.';
    case 'barred':
      return 'Your Rejoin Restriction Is Still Active. Select Join Game To See The Remaining Time.';
    case 'waiting_for_seat':
      return 'Waiting For An Unreserved Seat. Your Buy-In Opens When A Seat Is Offered.';
    default:
      return null;
  }
}
