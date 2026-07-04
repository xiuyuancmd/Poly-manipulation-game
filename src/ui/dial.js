// Dial mapping for the similarity gauge arc. The raw similarity score spends
// most of a level in the 60–90 band, so a linear arc would sit near-full the
// whole time and read as "already done". A gamma curve stretches the top of
// the scale across more arc length: the needle visibly climbs exactly where
// the player is doing the fine shaping work.
//
// VISUAL mapping only — the numeric readout, the cutoff comparison and the
// hold timer all use the raw score. Because pow is strictly monotonic, the
// arc passes the cutoff tick on exactly the frame the raw score passes the
// cutoff value; the two presentations can never disagree.

export const DIAL_GAMMA = 2.2;

/** Map a 0–100 score to a 0–1 arc fraction (clamped, strictly monotonic). */
export function dialFrac(v) {
  const c = Math.min(100, Math.max(0, v));
  return Math.pow(c / 100, DIAL_GAMMA);
}
