import type { CSSProperties } from "react";
import "./tabletopDice.css";

/** The same six-sided cube for tabletop rolls and stationary damage counters. */
export function DieCube({ value, rolling = false }: { value: number; rolling?: boolean }) {
  const orientation = DIE_ORIENTATIONS[value - 1];
  return (
    <div className="tabletop-die-view" aria-hidden="true">
      <div
        className="tabletop-die-cube"
        style={
          rolling
            ? undefined
            : ({
                "--dice-end-x": `${orientation?.x ?? 0}deg`,
                "--dice-end-z": `${orientation?.z ?? 0}deg`,
                animation: "none",
              } as CSSProperties)
        }
      >
        {DIE_FACES.map(({ value: faceValue, side, pips }) => (
          <div
            className={`tabletop-die-face tabletop-die-face-${side}`}
            key={side}
            data-face={faceValue}
          >
            <svg className="tabletop-die-pips" viewBox="0 0 100 100" aria-hidden="true">
              {pips.map(([row, column]) => (
                <circle
                  className="tabletop-die-pip"
                  key={`${row}:${column}`}
                  cx={column * 25}
                  cy={row * 25}
                  r={7}
                />
              ))}
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}

// Opposite sides total seven. Rotations put the chosen numbered face on TOP.
export const DIE_ORIENTATIONS = [
  { x: 0, z: 0 },
  { x: 90, z: 0 },
  { x: 0, z: -90 },
  { x: 0, z: 90 },
  { x: -90, z: 0 },
  { x: 180, z: 0 },
];
const DIE_FACES = [
  { value: 1, side: "top", pips: [[2, 2]] },
  {
    value: 2,
    side: "front",
    pips: [
      [1, 1],
      [3, 3],
    ],
  },
  {
    value: 3,
    side: "right",
    pips: [
      [1, 1],
      [2, 2],
      [3, 3],
    ],
  },
  {
    value: 4,
    side: "left",
    pips: [
      [1, 1],
      [1, 3],
      [3, 1],
      [3, 3],
    ],
  },
  {
    value: 5,
    side: "back",
    pips: [
      [1, 1],
      [1, 3],
      [2, 2],
      [3, 1],
      [3, 3],
    ],
  },
  {
    value: 6,
    side: "bottom",
    pips: [
      [1, 1],
      [1, 3],
      [2, 1],
      [2, 3],
      [3, 1],
      [3, 3],
    ],
  },
] as const;
