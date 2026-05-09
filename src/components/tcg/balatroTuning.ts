export interface BalatroHoverTuning {
  hoverZoom: number;
  juiceDuration: number;
  juiceScaleAmount: number;
  juiceRotationAmount: number;
  scaleEase: number;
  rotationEase: number;
  bendBase: number;
  bendCenterBoost: number;
  bendCenterRadius: number;
  minPerspectiveW: number;
  // Drag tuning (consumed by BalatroHoverCard while a card is pressed/dragged).
  // pressZoom is the extra scale added on top of base while pressed/dragging.
  // dragScaleEase / dragXyEase are exp(-k*dt) spring eases. dragSway maps the
  // dragged card's per-second X velocity to a rotation (radians per unit/sec).
  pressZoom: number;
  dragScaleEase: number;
  dragXyEase: number;
  dragSway: number;
  // Release tuning (consumed by Body.tsx animateReleaseToElement).
  // releaseXyEase / releaseScaleEase / releaseRotationEase are exp(-k*dt)
  // spring eases. releaseXyAccel scales the position spring's restoring
  // force per-frame (matching Balatro Moveable.move). releaseRotationFromXVelocity
  // maps per-second X velocity to a rotation target (radians per unit/sec).
  releaseXyEase: number;
  releaseScaleEase: number;
  releaseRotationEase: number;
  releaseXyAccel: number;
  releaseRotationFromXVelocity: number;
}

export const BALATRO_HOVER_TUNING_DEFAULTS: BalatroHoverTuning = {
  // Tuned values captured from the animation panel.
  hoverZoom: 0.02,
  juiceDuration: 0.4,
  juiceScaleAmount: 0.015,
  juiceRotationAmount: 0.012,
  scaleEase: 15,
  rotationEase: 190,
  bendBase: 0.015,
  bendCenterBoost: 0.2,
  bendCenterRadius: 0.3,
  minPerspectiveW: 0.15,
  // Drag defaults match the previous inline constants in BalatroHoverCard.tsx.
  pressZoom: 0.1,
  dragScaleEase: 60,
  dragXyEase: 50,
  dragSway: 0.015,
  // Release defaults match the previous inline constants in Body.tsx.
  releaseXyEase: 50,
  releaseScaleEase: 60,
  releaseRotationEase: 190,
  releaseXyAccel: 35,
  releaseRotationFromXVelocity: 0.015,
};

// Bumped from -v2 → -v3 because the schema gained drag/release fields.
// sanitizeTuning still merges additively over defaults, so the bump is a
// belt-and-braces guard: any pre-v3 entries simply pick up the new defaults
// for the new keys without warning.
const STORAGE_KEY = "luminous-ui-balatro-hover-tuning-v3";
const listeners = new Set<() => void>();

let currentTuning = loadStoredTuning();

function hasOwn<T extends object>(object: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function sanitizeTuning(value: Partial<BalatroHoverTuning>): BalatroHoverTuning {
  const next = { ...BALATRO_HOVER_TUNING_DEFAULTS };

  for (const rawKey of Object.keys(next)) {
    if (!hasOwn(next, rawKey)) continue;
    const valueAtKey = value[rawKey];
    if (typeof valueAtKey === "number" && Number.isFinite(valueAtKey)) {
      next[rawKey] = valueAtKey;
    }
  }

  return next;
}

function loadStoredTuning() {
  if (typeof window === "undefined") return BALATRO_HOVER_TUNING_DEFAULTS;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return BALATRO_HOVER_TUNING_DEFAULTS;
    return sanitizeTuning(JSON.parse(stored));
  } catch {
    return BALATRO_HOVER_TUNING_DEFAULTS;
  }
}

function persistTuning() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentTuning));
  } catch {
    // Ignore storage errors; tuning still works for this session.
  }
}

function notifyTuningListeners() {
  for (const listener of listeners) listener();
}

export function getBalatroHoverTuning() {
  return currentTuning;
}

export function setBalatroHoverTuning(update: Partial<BalatroHoverTuning>) {
  currentTuning = sanitizeTuning({ ...currentTuning, ...update });
  persistTuning();
  notifyTuningListeners();
}

export function resetBalatroHoverTuning() {
  currentTuning = BALATRO_HOVER_TUNING_DEFAULTS;
  persistTuning();
  notifyTuningListeners();
}

export function subscribeBalatroHoverTuning(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
