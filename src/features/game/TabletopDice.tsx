import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { DieCube, DIE_ORIENTATIONS } from "./DieCube";
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
                    <DieCube value={value} rolling />
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
