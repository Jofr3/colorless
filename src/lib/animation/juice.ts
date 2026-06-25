// Shared "juice" envelope, ported from Balatro's move_juice (moveable.lua:250-276)
// and used identically by CardView (Pixi), useDeckDrag (CSS transform), and
// useTiltJuice (CSS vars). A fired juice is a decaying oscillation over 0.4s:
// sin(50.8·t) on scale under a cubic envelope, sin(40.8·t) on rotation under a
// squared envelope. evaluateJuice returns the RAW oscillation — each consumer
// applies its own framing (scale → 1 + value, rotation → value × 2).

export const JUICE_DURATION = 0.4;
export const JUICE_SCALE_FREQ = 50.8;
export const JUICE_ROT_FREQ = 40.8;
export const JUICE_INITIAL_SQUISH = 0.6; // VT.scale = 1 - 0.6·amount on frame one

export interface JuiceState {
  scaleAmt: number;
  rotAmt: number;
  startTime: number;
  endTime: number;
}

export interface JuiceValue {
  scale: number;
  rotation: number;
}

/** Build a JuiceState from a start time (seconds) and the standard duration. */
export function startJuice(
  scaleAmt: number,
  rotAmt: number,
  startTime: number,
  duration = JUICE_DURATION,
): JuiceState {
  return { scaleAmt, rotAmt, startTime, endTime: startTime + duration };
}

/**
 * The raw juice oscillation at `time` (seconds), or null once the envelope has
 * elapsed (or there is no active juice). Callers apply their own framing.
 */
export function evaluateJuice(state: JuiceState | null, time: number): JuiceValue | null {
  if (!state || time >= state.endTime) {
    return null;
  }
  const elapsed = time - state.startTime;
  const total = state.endTime - state.startTime;
  const remaining = Math.max(0, (state.endTime - time) / total);
  const scaleEnvelope = remaining * remaining * remaining;
  const rotEnvelope = remaining * remaining;
  return {
    scale: state.scaleAmt * Math.sin(JUICE_SCALE_FREQ * elapsed) * scaleEnvelope,
    rotation: state.rotAmt * Math.sin(JUICE_ROT_FREQ * elapsed) * rotEnvelope,
  };
}

/** Frame-one squish so a freshly fired juice already reads as pressed. */
export function initialSquish(amount: number): number {
  return 1 - JUICE_INITIAL_SQUISH * amount;
}
