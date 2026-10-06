import { CardImage } from "../../components/CardImage";
import { CheckIcon } from "../../components/icons";
import { useTiltJuice } from "../../components/useTiltJuice";
import { cardImageUrl } from "../../lib/api";
import { FOCUS_RING_INSET } from "../../lib/glass";

export function cardChoiceGridClass(count: number): string {
  const columns =
    count <= 1
      ? "grid-cols-1"
      : count === 2
        ? "grid-cols-2"
        : count === 3
          ? "grid-cols-2 sm:grid-cols-3"
          : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4";
  // Leave room for the combined hover tilt and selection bounce inside the scroller.
  return `mt-3 grid min-h-0 gap-4 overflow-x-hidden overflow-y-auto overscroll-contain p-5 ${columns}`;
}

export function cardChoiceDialogClass(count: number): string {
  const width =
    count <= 1
      ? "w-[min(20rem,calc(100vw-2rem))]"
      : count === 2
        ? "w-[min(30rem,calc(100vw-2rem))]"
        : count === 3
          ? "w-[min(42rem,calc(100vw-2rem))]"
          : "w-[min(54rem,calc(100vw-2rem))]";
  return `flex max-h-[88svh] flex-col [&>h2]:shrink-0 [&>output]:shrink-0 [&>div]:shrink-0 ${width}`;
}

/** One physical card per choice: duplicate printings remain separately selectable. */
export function CardChoice({
  name,
  cardId,
  hasImage,
  selected,
  refused,
  onSelect,
}: {
  name: string;
  cardId: string;
  hasImage: boolean;
  selected: boolean;
  refused: boolean;
  onSelect: () => void;
}) {
  const { tiltRef, juiceLayerRef, juiceStyle, tiltStyle, handlers } =
    useTiltJuice<HTMLButtonElement>({
      idle: true,
      disabled: refused,
      pulse: selected ? 1 : null,
    });

  return (
    <li className="relative min-w-0 hover:z-10 focus-within:z-10">
      <div ref={juiceLayerRef} style={juiceStyle}>
        <button
          ref={tiltRef}
          type="button"
          {...handlers}
          style={tiltStyle}
          aria-label={name}
          aria-pressed={selected}
          aria-disabled={refused || undefined}
          onClick={() => {
            if (!refused) onSelect();
          }}
          className={`relative block w-full rounded-xl text-left ${FOCUS_RING_INSET} ${
            refused ? "cursor-not-allowed opacity-45" : "cursor-pointer"
          }`}
        >
          <span
            className={`relative block aspect-[2.5/3.5] overflow-hidden rounded-xl shadow-lg ring-2 ${
              selected ? "ring-accent" : "ring-white/10"
            }`}
          >
            <CardImage
              fill
              imageUrl={hasImage ? cardImageUrl(cardId, "high") : undefined}
              alt={name}
              className="h-full w-full object-cover"
            />
            {selected && (
              <span
                aria-hidden
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-zinc-950 shadow-lg"
              >
                <CheckIcon className="h-4 w-4" />
              </span>
            )}
          </span>
        </button>
      </div>
    </li>
  );
}
