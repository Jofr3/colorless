import type { CardBackTone, PlayerId } from "../types";

const PIPS = [
  ["2 / 2"],
  ["1 / 1", "3 / 3"],
  ["1 / 1", "2 / 2", "3 / 3"],
  ["1 / 1", "1 / 3", "3 / 1", "3 / 3"],
  ["1 / 1", "1 / 3", "2 / 2", "3 / 1", "3 / 3"],
  ["1 / 1", "1 / 3", "2 / 1", "2 / 3", "3 / 1", "3 / 3"],
];

export function MulliganDie({
  owner,
  tone,
  count,
}: {
  owner: PlayerId;
  tone: CardBackTone;
  count: number;
}) {
  const pips = PIPS[count - 1];
  return (
    <span
      role="img"
      aria-label={`${owner === "you" ? "Your" : "Opponent's"} mulligan bonus cards: ${count}`}
      className="mulligan-die"
      data-tone={tone}
      data-mulligan-count={count}
    >
      {pips ? (
        pips.map((position) => (
          <span
            key={position}
            className="mulligan-die__pip"
            style={{ gridArea: position }}
            aria-hidden="true"
          />
        ))
      ) : (
        <span className="mulligan-die__number" aria-hidden="true">
          {count}
        </span>
      )}
    </span>
  );
}
