import { useEffect, useRef } from "react";
import type { GameAction, Seat } from "@luminous/engine";

/** Accept the full mulligan bonus once while the engine waits for this seat. */
export function AutoMulliganDraw({
  seat,
  owed,
  onAction,
}: {
  seat: Seat;
  owed: number;
  onAction: (action: GameAction) => void;
}) {
  const sentSeatRef = useRef<Seat | null>(null);
  useEffect(() => {
    // StrictMode and online snapshots may rerun the effect before the phase advances.
    if (sentSeatRef.current === seat) return;
    sentSeatRef.current = seat;
    onAction({ type: "setupDrawExtra", seat, count: owed });
  }, [seat, owed, onAction]);
  return null;
}
