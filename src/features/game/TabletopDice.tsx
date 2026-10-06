import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { CoinFlipBatch } from "./coinFlips";
import "./tabletopDice.css";

const TOSS_MS = 1000;
const RESULT_MS = 1000;

/** Key by batch.id so consecutive, identical results still get a fresh toss. */
export function TabletopDice({
  batch,
  onComplete,
}: {
  batch: CoinFlipBatch;
  onComplete: () => void;
}) {
  const tableRef = useRef<HTMLDivElement>(null);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [landed, setLanded] = useState(reducedMotion);

  useLayoutEffect(() => {
    const layer = tableRef.current;
    const board = layer?.closest(".playmat-wrapper");
    const deck = board?.querySelector('[data-card-pile="deck"][data-card-owner="you"]');
    const active = board?.querySelector('[data-card-zone="active"][data-card-owner="opponent"]');
    if (!layer || !board || !deck || !active) return;
    const measure = () => {
      const table = board.getBoundingClientRect();
      const start = deck.getBoundingClientRect();
      const opponent = active.getBoundingClientRect();
      if (table.width === 0 || start.width === 0) return;
      // Roll from the near deck's lower edge into the open lane beside the far Active.
      const x = (opponent.right + start.left) / 2 - table.left;
      const y = opponent.top + opponent.height / 2 - table.top;
      layer.style.setProperty("--dice-land-x", `${x}px`);
      layer.style.setProperty("--dice-land-y", `${y}px`);
      layer.style.setProperty(
        "--dice-throw-x",
        `${start.left + start.width / 2 - table.left - x}px`,
      );
      layer.style.setProperty("--dice-throw-y", `${start.bottom - table.top - y}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    observer.observe(deck);
    observer.observe(active);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const toss = reducedMotion ? 0 : TOSS_MS;
    const reveal = setTimeout(() => setLanded(true), toss);
    const finish = setTimeout(onComplete, toss + RESULT_MS);
    return () => {
      clearTimeout(reveal);
      clearTimeout(finish);
    };
  }, [reducedMotion, onComplete]);

  const revealed = landed || reducedMotion;

  return (
    <div
      ref={tableRef}
      className="tabletop-dice"
      data-landed={revealed}
      style={{ "--dice-toss-duration": `${TOSS_MS}ms` } as CSSProperties}
    >
      <div className="tabletop-dice-landing">
        <div className="tabletop-dice-group">
          {batch.flips.map((flip, index) => {
            // The cosmetic pip count preserves the engine's existing 50/50 result.
            const value = 2 * ((batch.id + index) % 3) + (flip.result === "heads" ? 2 : 1);
            const orientation = DIE_ORIENTATIONS[value - 1];
            return (
              <div
                className="tabletop-die"
                key={index}
                style={
                  {
                    "--dice-end-x": `${1080 + (orientation?.x ?? 0)}deg`,
                    "--dice-end-z": `${720 + (orientation?.z ?? 0)}deg`,
                    "--dice-throw-offset": `${(index % 3) * 22}px`,
                  } as CSSProperties
                }
                data-seat={flip.seat}
                data-value={value}
                data-result={flip.result}
              >
                <div className="tabletop-die-travel" aria-hidden="true">
                  <div className="tabletop-die-shadow" />
                  <div className="tabletop-die-hop">
                    <div className="tabletop-die-view">
                      <div className="tabletop-die-cube">
                        {DIE_FACES.map(({ value: faceValue, side, pips }) => (
                          <div
                            className={`tabletop-die-face tabletop-die-face-${side}`}
                            key={side}
                            data-face={faceValue}
                          >
                            {pips.map((position) => (
                              <span
                                className="tabletop-die-pip"
                                key={position}
                                style={{ gridArea: position }}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <output className="tabletop-die-label" aria-live="polite" aria-atomic="true">
                  {revealed ? (flip.result === "heads" ? "Heads" : "Tails") : ""}
                </output>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Opposite sides total seven. Rotations put the chosen numbered face on TOP.
const DIE_ORIENTATIONS = [
  { x: 0, z: 0 },
  { x: 90, z: 0 },
  { x: 0, z: -90 },
  { x: 0, z: 90 },
  { x: -90, z: 0 },
  { x: 180, z: 0 },
];
const DIE_FACES = [
  { value: 1, side: "top", pips: ["2 / 2"] },
  { value: 2, side: "front", pips: ["1 / 1", "3 / 3"] },
  { value: 3, side: "right", pips: ["1 / 1", "2 / 2", "3 / 3"] },
  { value: 4, side: "left", pips: ["1 / 1", "1 / 3", "3 / 1", "3 / 3"] },
  { value: 5, side: "back", pips: ["1 / 1", "1 / 3", "2 / 2", "3 / 1", "3 / 3"] },
  { value: 6, side: "bottom", pips: ["1 / 1", "1 / 3", "2 / 1", "2 / 3", "3 / 1", "3 / 3"] },
];
