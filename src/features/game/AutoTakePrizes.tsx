import { useEffect, useRef } from "react";
import type { GameAction, Seat } from "@luminous/engine";

/** Collect the end of the live prize row once per decision. */
export function AutoTakePrizes({
  seat,
  count,
  remaining,
  onAction,
}: {
  seat: Seat;
  count: number;
  remaining: number;
  onAction: (action: GameAction) => void;
}) {
  const sentRef = useRef<string | null>(null);
  useEffect(() => {
    const decision = `${seat}:${remaining}:${count}`;
    // StrictMode and repeated server snapshots must not send duplicate actions.
    if (sentRef.current === decision) return;
    sentRef.current = decision;
    onAction({
      type: "takePrizes",
      seat,
      prizeIndices: Array.from({ length: count }, (_, index) => remaining - count + index),
    });
  }, [seat, count, remaining, onAction]);
  return null;
}
