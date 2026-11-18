/** A Lightning hero stays mounted while the engine assigns a new physical chair. */
export function lightningSeatKey(
  lightning: boolean,
  seat: number,
  heroSeat: number
): string | number {
  return lightning && heroSeat > 0 && seat === heroSeat ? 'lightning-hero' : seat;
}
