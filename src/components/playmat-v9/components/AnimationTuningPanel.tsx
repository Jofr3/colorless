// Side panel exposing every BalatroHoverTuning slider. Subscribes to the
// shared tuning store so external changes (e.g. a different panel
// instance, or a future keybinding) keep this view in sync.

import { useEffect, useState } from "react";
import {
  BALATRO_HOVER_TUNING_DEFAULTS,
  getBalatroHoverTuning,
  resetBalatroHoverTuning,
  setBalatroHoverTuning,
  subscribeBalatroHoverTuning,
  type BalatroHoverTuning,
} from "../../tcg/balatroTuning";

type TuningSliderKey = keyof BalatroHoverTuning;

interface TuningSliderConfig {
  key: TuningSliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

const TUNING_SLIDERS: TuningSliderConfig[] = [
  { key: "hoverZoom", label: "Hover zoom", min: 0, max: 0.14, step: 0.005 },
  { key: "juiceDuration", label: "Juice duration", min: 0.08, max: 1.2, step: 0.01 },
  { key: "juiceScaleAmount", label: "Juice scale", min: 0, max: 0.08, step: 0.001 },
  { key: "juiceRotationAmount", label: "Juice rotation", min: 0, max: 0.05, step: 0.001 },
  { key: "scaleEase", label: "Scale spring ease", min: 5, max: 160, step: 1 },
  { key: "rotationEase", label: "Rotation spring ease", min: 20, max: 360, step: 1 },
  { key: "bendBase", label: "Perspective bend", min: 0, max: 0.1, step: 0.001 },
  { key: "bendCenterBoost", label: "Center bend boost", min: 0, max: 1, step: 0.01 },
  { key: "bendCenterRadius", label: "Center boost radius", min: 0, max: 0.8, step: 0.01 },
  { key: "minPerspectiveW", label: "Perspective clamp", min: 0.05, max: 0.8, step: 0.01 },
  { key: "pressZoom", label: "Press/drag zoom", min: 0, max: 0.3, step: 0.005 },
  { key: "dragScaleEase", label: "Drag scale ease", min: 5, max: 160, step: 1 },
  { key: "dragXyEase", label: "Drag XY ease", min: 5, max: 160, step: 1 },
  { key: "dragSway", label: "Drag sway", min: 0, max: 0.06, step: 0.001 },
  { key: "releaseXyEase", label: "Release XY ease", min: 5, max: 160, step: 1 },
  { key: "releaseScaleEase", label: "Release scale ease", min: 5, max: 160, step: 1 },
  { key: "releaseRotationEase", label: "Release rotation ease", min: 20, max: 360, step: 1 },
  { key: "releaseXyAccel", label: "Release XY accel", min: 5, max: 120, step: 1 },
  { key: "releaseRotationFromXVelocity", label: "Release sway", min: 0, max: 0.06, step: 0.001 },
];

function formatSliderValue(value: number, step: number) {
  if (step >= 1) return value.toFixed(0);
  if (step >= 0.01) return value.toFixed(2);
  return value.toFixed(3);
}

export function AnimationTuningPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tuning, setTuningState] = useState(getBalatroHoverTuning);

  useEffect(() => {
    return subscribeBalatroHoverTuning(() => setTuningState(getBalatroHoverTuning()));
  }, []);

  if (!open) return null;

  function updateSlider(key: TuningSliderKey, value: number) {
    setBalatroHoverTuning({ [key]: value } as Partial<BalatroHoverTuning>);
  }

  return (
    <div
      className="absolute w-[340px] max-h-[calc(100vh-110px)] overflow-y-auto rounded-2xl border border-white/10 bg-[#10121b]/90 p-4 text-white shadow-[0_18px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl"
      style={{ right: 16, bottom: 64, zIndex: 1000 }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/65">Animation tuning</div>
          <p className="mt-1 text-xs leading-4 text-white/45">Hover a card while dragging sliders. Values are saved locally.</p>
        </div>
        <button
          type="button"
          aria-label="Close animation tuning"
          onClick={onClose}
          className="rounded-full px-2 py-1 text-sm text-white/55 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
        >
          ×
        </button>
      </div>

      <div className="space-y-3">
        {TUNING_SLIDERS.map((slider) => {
          const value = tuning[slider.key];
          const defaultValue = BALATRO_HOVER_TUNING_DEFAULTS[slider.key];
          return (
            <label key={slider.key} className="block rounded-xl bg-white/[0.035] p-3 ring-1 ring-inset ring-white/7">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-white/75">{slider.label}</span>
                <span className="font-mono text-white/55">{formatSliderValue(value, slider.step)}</span>
              </div>
              <input
                type="range"
                aria-label={slider.label}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={value}
                onChange={(event) => updateSlider(slider.key, Number(event.currentTarget.value))}
                className="w-full accent-sky-300"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-white/35">
                <span>{formatSliderValue(slider.min, slider.step)}</span>
                <span>default {formatSliderValue(defaultValue, slider.step)}</span>
                <span>{formatSliderValue(slider.max, slider.step)}</span>
              </div>
            </label>
          );
        })}
      </div>

      <button
        type="button"
        onClick={resetBalatroHoverTuning}
        className="mt-4 w-full rounded-xl bg-white/[0.06] px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-white/70 ring-1 ring-inset ring-white/10 transition hover:bg-white/[0.10] hover:text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
      >
        Reset to tuned defaults
      </button>
    </div>
  );
}
